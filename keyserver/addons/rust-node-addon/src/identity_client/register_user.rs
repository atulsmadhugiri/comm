use super::*;

use tracing::{debug, warn};

#[napi]
#[instrument(skip_all)]
pub async fn register_user(
  username: String,
  password: String,
  signed_identity_keys_blob: SignedIdentityKeysBlob,
  content_prekey: String,
  content_prekey_signature: String,
  notif_prekey: String,
  notif_prekey_signature: String,
  content_one_time_keys: Vec<String>,
  notif_one_time_keys: Vec<String>,
) -> Result<UserLoginInfo> {
  debug!("Attempting to register user: {}", username);

  // Set up the gRPC client that will be used to talk to the Identity service
  let mut identity_client = get_identity_client().await?;

  // Start OPAQUE registration and send initial registration request
  let mut opaque_registration = comm_opaque2::client::Registration::new();
  let opaque_registration_request = opaque_registration
    .start(&password)
    .map_err(|_| Error::from_status(Status::GenericFailure))?;
  let device_key_upload = DeviceKeyUpload {
    device_key_info: Some(IdentityKeyInfo {
      payload: signed_identity_keys_blob.payload,
      payload_signature: signed_identity_keys_blob.signature,
      social_proof: None,
    }),
    content_upload: Some(Prekey {
      prekey: content_prekey,
      prekey_signature: content_prekey_signature,
    }),
    notif_upload: Some(Prekey {
      prekey: notif_prekey,
      prekey_signature: notif_prekey_signature,
    }),
    one_time_content_prekeys: content_one_time_keys,
    one_time_notif_prekeys: notif_one_time_keys,
    device_type: DeviceType::Keyserver.into(),
  };
  let registration_start_request = Request::new(RegistrationStartRequest {
    opaque_registration_request,
    username,
    device_key_upload: Some(device_key_upload),
  });

  // Finish OPAQUE registration and send final registration request
  let response = identity_client
    .register_password_user_start(registration_start_request)
    .await
    .map_err(handle_grpc_error)?;
  debug!("Received registration start response");

  // We need to get the load balancer cookie from from the response and send it
  // in the subsequent request to ensure it is routed to the same identity
  // service instance as the first request
  let cookie = response
    .metadata()
    .get(RESPONSE_METADATA_COOKIE_KEY)
    .cloned();

  let registration_start_response = response.into_inner();

  let opaque_registration_upload = opaque_registration
    .finish(
      &password,
      &registration_start_response.opaque_registration_response,
    )
    .map_err(|_| Error::from_status(Status::GenericFailure))?;

  let mut registration_finish_request =
    Request::new(RegistrationFinishRequest {
      session_id: registration_start_response.session_id,
      opaque_registration_upload,
    });

  // Cookie won't be available in local dev environments
  if let Some(cookie_metadata) = cookie {
    registration_finish_request
      .metadata_mut()
      .insert(REQUEST_METADATA_COOKIE_KEY, cookie_metadata);
  }

  let registration_response = identity_client
    .register_password_user_finish(registration_finish_request)
    .await
    .map_err(handle_grpc_error)?
    .into_inner();

  let user_info = UserLoginInfo {
    user_id: registration_response.user_id,
    access_token: registration_response.access_token,
  };

  Ok(user_info)
}
