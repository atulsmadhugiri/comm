use actix_web::{
  error::ErrorBadRequest,
  web::{self, Bytes},
  HttpResponse, Responder,
};
use comm_lib::{
  auth::UserIdentity,
  backup::LatestBackupIDResponse,
  blob::{client::BlobServiceClient, types::BlobInfo},
  http::multipart::{get_named_text_field, get_text_field},
  tools::Defer,
};
use std::convert::Infallible;
use tokio_stream::{wrappers::ReceiverStream, StreamExt};
use tracing::{info, instrument, trace, warn};

use crate::{
  database::{backup_item::BackupItem, DatabaseClient},
  error::BackupError,
};

#[instrument(skip_all, fields(backup_id))]
pub async fn upload(
  user: UserIdentity,
  blob_client: web::Data<BlobServiceClient>,
  db_client: web::Data<DatabaseClient>,
  mut multipart: actix_multipart::Multipart,
) -> actix_web::Result<HttpResponse> {
  let backup_id = get_named_text_field("backup_id", &mut multipart).await?;
  tracing::Span::current().record("backup_id", &backup_id);

  info!("Backup data upload started");

  let (user_keys_blob_info, user_keys_revoke) = forward_field_to_blob(
    &mut multipart,
    &blob_client,
    "user_keys_hash",
    "user_keys",
  )
  .await?;

  let (user_data_blob_info, user_data_revoke) = forward_field_to_blob(
    &mut multipart,
    &blob_client,
    "user_data_hash",
    "user_data",
  )
  .await?;

  let attachments_hashes: Vec<String> =
    match get_text_field(&mut multipart).await? {
      Some((name, attachments)) => {
        if name != "attachments" {
          warn!(
            name,
            "Malformed request: 'attachments' text field expected."
          );
          return Err(ErrorBadRequest("Bad request"));
        }

        attachments.lines().map(ToString::to_string).collect()
      }
      None => Vec::new(),
    };

  let mut attachments = Vec::new();
  let mut attachments_revokes = Vec::new();
  for attachment_hash in attachments_hashes {
    let (holder, revoke) =
      create_attachment_holder(&attachment_hash, &blob_client).await?;

    attachments.push(BlobInfo {
      blob_hash: attachment_hash,
      holder,
    });
    attachments_revokes.push(revoke);
  }

  let item = BackupItem::new(
    user.user_id.clone(),
    backup_id,
    user_keys_blob_info,
    user_data_blob_info,
    attachments,
  );

  db_client
    .put_backup_item(item)
    .await
    .map_err(BackupError::from)?;

  user_keys_revoke.cancel();
  user_data_revoke.cancel();
  for attachment_revoke in attachments_revokes {
    attachment_revoke.cancel();
  }

  for backup in db_client
    .remove_old_backups(&user.user_id)
    .await
    .map_err(BackupError::from)?
  {
    backup.revoke_holders(&blob_client).await;
  }

  Ok(HttpResponse::Ok().finish())
}

#[instrument(skip_all, fields(hash_field_name, data_field_name))]
async fn forward_field_to_blob<'revoke, 'blob: 'revoke>(
  multipart: &mut actix_multipart::Multipart,
  blob_client: &'blob web::Data<BlobServiceClient>,
  hash_field_name: &str,
  data_field_name: &str,
) -> actix_web::Result<(BlobInfo, Defer<'revoke>)> {
  trace!("Reading blob fields: {hash_field_name:?}, {data_field_name:?}");

  let blob_hash = get_named_text_field(hash_field_name, multipart).await?;

  let Some(mut field) = multipart.try_next().await? else {
    warn!("Malformed request: expected a field.");
    return Err(ErrorBadRequest("Bad request"))?;
  };
  if field.name() != data_field_name {
    warn!(
      hash_field_name,
      "Malformed request: '{data_field_name}' data field expected."
    );
    return Err(ErrorBadRequest("Bad request"))?;
  }

  let blob_info = BlobInfo {
    blob_hash,
    holder: uuid::Uuid::new_v4().to_string(),
  };

  // [`actix_multipart::Multipart`] isn't [`std::marker::Send`], and so we cannot pass it to the blob client directly.
  // Instead we have to forward it to a channel and create stream from the receiver.
  let (tx, rx) = tokio::sync::mpsc::channel(1);
  let receive_promise = async move {
    trace!("Receiving blob data");
    // [`actix_multipart::MultipartError`] isn't [`std::marker::Send`] so we return it here, and pass [`Infallible`]
    // as the error to the channel
    while let Some(chunk) = field.try_next().await? {
      if let Err(err) = tx.send(Result::<Bytes, Infallible>::Ok(chunk)).await {
        warn!("Error when sending data through a channel: '{err}'");
        // Error here means that the channel has been closed from the blob client side. We don't want to return an error
        // here, because `tokio::try_join!` only returns the first error it receives and we want to prioritize the backup
        // client error.
        break;
      }
    }
    trace!("Finished receiving blob data");
    Result::<(), actix_web::Error>::Ok(())
  };

  let data_stream = ReceiverStream::new(rx);
  let send_promise = async {
    blob_client
      .simple_put(&blob_info.blob_hash, &blob_info.holder, data_stream)
      .await
      .map_err(BackupError::from)?;

    Ok(())
  };

  tokio::try_join!(receive_promise, send_promise)?;

  let revoke_info = blob_info.clone();
  let revoke_holder = Defer::new(|| {
    blob_client
      .schedule_revoke_holder(revoke_info.blob_hash, revoke_info.holder)
  });

  Ok((blob_info, revoke_holder))
}

#[instrument(skip_all)]
async fn create_attachment_holder<'revoke, 'blob: 'revoke>(
  attachment: &str,
  blob_client: &'blob web::Data<BlobServiceClient>,
) -> Result<(String, Defer<'revoke>), BackupError> {
  let holder = uuid::Uuid::new_v4().to_string();

  if !blob_client
    .assign_holder(attachment, &holder)
    .await
    .map_err(BackupError::from)?
  {
    warn!("Blob attachment with hash {attachment:?} doesn't exist");
  }

  let revoke_hash = attachment.to_string();
  let revoke_holder = holder.clone();
  let revoke_holder = Defer::new(|| {
    blob_client.schedule_revoke_holder(revoke_hash, revoke_holder)
  });

  Ok((holder, revoke_holder))
}

#[instrument(skip_all, fields(backup_id = %path))]
pub async fn download_user_keys(
  user: UserIdentity,
  path: web::Path<String>,
  blob_client: web::Data<BlobServiceClient>,
  db_client: web::Data<DatabaseClient>,
) -> actix_web::Result<HttpResponse> {
  info!("Download user keys request");
  let backup_id = path.into_inner();
  download_user_blob(
    |item| &item.user_keys,
    &user.user_id,
    &backup_id,
    blob_client,
    db_client,
  )
  .await
}

#[instrument(skip_all, fields(backup_id = %path))]
pub async fn download_user_data(
  user: UserIdentity,
  path: web::Path<String>,
  blob_client: web::Data<BlobServiceClient>,
  db_client: web::Data<DatabaseClient>,
) -> actix_web::Result<HttpResponse> {
  info!("Download user data request");
  let backup_id = path.into_inner();
  download_user_blob(
    |item| &item.user_data,
    &user.user_id,
    &backup_id,
    blob_client,
    db_client,
  )
  .await
}

pub async fn download_user_blob(
  data_extractor: impl FnOnce(&BackupItem) -> &BlobInfo,
  user_id: &str,
  backup_id: &str,
  blob_client: web::Data<BlobServiceClient>,
  db_client: web::Data<DatabaseClient>,
) -> actix_web::Result<HttpResponse> {
  let backup_item = db_client
    .find_backup_item(user_id, backup_id)
    .await
    .map_err(BackupError::from)?
    .ok_or(BackupError::NoBackup)?;

  let stream = blob_client
    .get(&data_extractor(&backup_item).blob_hash)
    .await
    .map_err(BackupError::from)?;

  Ok(
    HttpResponse::Ok()
      .content_type("application/octet-stream")
      .streaming(stream),
  )
}

#[instrument(skip_all, fields(username = %path))]
pub async fn get_latest_backup_id(
  path: web::Path<String>,
  db_client: web::Data<DatabaseClient>,
) -> actix_web::Result<impl Responder> {
  let username = path.into_inner();
  // Treat username as user_id in the initial version
  let user_id = username;

  let Some(backup_item) = db_client
    .find_last_backup_item(&user_id)
    .await
    .map_err(BackupError::from)?
  else {
    return Err(BackupError::NoBackup.into());
  };

  let response = LatestBackupIDResponse {
    backup_id: backup_item.backup_id,
  };

  Ok(web::Json(response))
}

#[instrument(skip_all, fields(username = %path))]
pub async fn download_latest_backup_keys(
  path: web::Path<String>,
  db_client: web::Data<DatabaseClient>,
  blob_client: web::Data<BlobServiceClient>,
) -> actix_web::Result<HttpResponse> {
  let username = path.into_inner();
  // Treat username as user_id in the initial version
  let user_id = username;

  let Some(backup_item) = db_client
    .find_last_backup_item(&user_id)
    .await
    .map_err(BackupError::from)?
  else {
    return Err(BackupError::NoBackup.into());
  };

  let stream = blob_client
    .get(&backup_item.user_keys.blob_hash)
    .await
    .map_err(BackupError::from)?;

  Ok(
    HttpResponse::Ok()
      .content_type("application/octet-stream")
      .streaming(stream),
  )
}
