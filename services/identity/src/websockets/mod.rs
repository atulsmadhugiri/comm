use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;

use elastic::client::responses::SearchResponse as ElasticSearchResponse;
use futures::lock::Mutex;
use futures_util::{SinkExt, StreamExt};
use hyper::{Body, Request, Response, StatusCode};
use hyper_tungstenite::tungstenite::Message;
use hyper_tungstenite::HyperWebsocket;
use identity_search_messages::{
  ConnectionInitializationResponse, ConnectionInitializationStatus, Heartbeat,
  IdentitySearchFailure, IdentitySearchMethod, IdentitySearchResponse,
  IdentitySearchResult, IdentitySearchUser, MessagesToServer,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tracing::{debug, error, info};

mod auth;
mod send;

use crate::config::CONFIG;
use crate::constants::{
  IDENTITY_SEARCH_INDEX, IDENTITY_SEARCH_RESULT_SIZE,
  IDENTITY_SERVICE_WEBSOCKET_ADDR, SOCKET_HEARTBEAT_TIMEOUT,
};
use send::{send_message, WebsocketSink};
pub mod errors;

#[derive(Serialize, Deserialize)]
struct Query {
  size: u32,
  query: Prefix,
}

#[derive(Serialize, Deserialize)]
struct Prefix {
  prefix: Username,
}

#[derive(Serialize, Deserialize)]
struct Username {
  username: String,
}

struct WebsocketService {
  addr: SocketAddr,
}

impl hyper::service::Service<Request<Body>> for WebsocketService {
  type Response = Response<Body>;
  type Error = errors::BoxedError;
  type Future =
    Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

  fn poll_ready(
    &mut self,
    _: &mut std::task::Context<'_>,
  ) -> std::task::Poll<Result<(), Self::Error>> {
    std::task::Poll::Ready(Ok(()))
  }

  fn call(&mut self, mut req: Request<Body>) -> Self::Future {
    let addr = self.addr;

    let future = async move {
      tracing::debug!(
        "Incoming HTTP request on WebSocket port: {} {}",
        req.method(),
        req.uri().path()
      );
      if hyper_tungstenite::is_upgrade_request(&req) {
        let (response, websocket) = hyper_tungstenite::upgrade(&mut req, None)?;

        tokio::spawn(async move {
          accept_connection(websocket, addr).await;
        });

        return Ok(response);
      }

      debug!(
        "Incoming HTTP request on WebSocket port: {} {}",
        req.method(),
        req.uri().path()
      );

      let response = match req.uri().path() {
        "/health" => Response::new(Body::from("OK")),
        _ => Response::builder()
          .status(StatusCode::NOT_FOUND)
          .body(Body::from("Not found"))?,
      };
      Ok(response)
    };
    Box::pin(future)
  }
}

pub async fn run_server() -> Result<(), errors::BoxedError> {
  let addr: SocketAddr = IDENTITY_SERVICE_WEBSOCKET_ADDR.parse()?;
  let listener = TcpListener::bind(&addr).await.expect("Failed to bind");

  info!("Listening to WebSocket traffic on {}", addr);

  let mut http = hyper::server::conn::Http::new();
  http.http1_only(true);
  http.http1_keep_alive(true);

  while let Ok((stream, addr)) = listener.accept().await {
    let connection = http
      .serve_connection(stream, WebsocketService { addr })
      .with_upgrades();

    tokio::spawn(async move {
      if let Err(err) = connection.await {
        error!("Error serving HTTP/WebSocket connection: {:?}", err);
      }
    });
  }

  Ok(())
}

async fn send_search_request<T: Serialize>(
  url: &str,
  json_body: T,
) -> Result<reqwest::Response, reqwest::Error> {
  let client = reqwest::Client::new();

  client
    .post(url)
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .json(&json_body)
    .send()
    .await
}

async fn close_connection(outgoing: WebsocketSink) {
  if let Err(e) = outgoing.lock().await.close().await {
    error!("Error closing connection: {}", e);
  }
}

async fn handle_prefix_search(
  request_id: &str,
  prefix_request: identity_search_messages::IdentitySearchPrefix,
) -> Result<IdentitySearchResult, errors::WebsocketError> {
  let prefix_query = Query {
    size: IDENTITY_SEARCH_RESULT_SIZE,
    query: Prefix {
      prefix: Username {
        username: prefix_request.prefix.trim().to_string(),
      },
    },
  };

  let opensearch_url = format!(
    "https://{}/{}/_search/",
    &CONFIG.opensearch_endpoint, IDENTITY_SEARCH_INDEX
  );

  let search_response = send_search_request(&opensearch_url, prefix_query)
    .await?
    .json::<ElasticSearchResponse<IdentitySearchUser>>()
    .await?;

  let usernames: Vec<IdentitySearchUser> =
    search_response.into_documents().collect();

  let search_result = IdentitySearchResult {
    id: request_id.to_string(),
    hits: usernames,
  };

  Ok(search_result)
}

async fn handle_websocket_frame(
  text: String,
  outgoing: WebsocketSink,
) -> Result<(), errors::WebsocketError> {
  let Ok(serialized_message) = serde_json::from_str::<MessagesToServer>(&text)
  else {
    return Err(errors::WebsocketError::SerializationError);
  };

  match serialized_message {
    MessagesToServer::Heartbeat(Heartbeat {}) => {
      debug!("Received heartbeat");
      Ok(())
    }
    MessagesToServer::IdentitySearchQuery(search_query) => {
      let handler_result = match search_query.search_method {
        IdentitySearchMethod::IdentitySearchPrefix(prefix_query) => {
          handle_prefix_search(&search_query.id, prefix_query).await
        }
      };

      let search_response = match handler_result {
        Ok(search_result) => IdentitySearchResponse::Success(search_result),
        Err(e) => IdentitySearchResponse::Error(IdentitySearchFailure {
          id: search_query.id,
          error: e.to_string(),
        }),
      };

      let serialized_message = serde_json::to_string(&search_response)?;

      send_message(Message::Text(serialized_message), outgoing.clone()).await;

      Ok(())
    }
    _ => Err(errors::WebsocketError::InvalidMessage),
  }
}

async fn accept_connection(hyper_ws: HyperWebsocket, addr: SocketAddr) {
  debug!("Incoming WebSocket connection from {}", addr);

  let ws_stream = match hyper_ws.await {
    Ok(stream) => stream,
    Err(e) => {
      error!("WebSocket handshake error: {}", e);
      return;
    }
  };

  let (outgoing, mut incoming) = ws_stream.split();

  let outgoing = Arc::new(Mutex::new(outgoing));

  if let Some(Ok(auth_message)) = incoming.next().await {
    match auth_message {
      Message::Text(text) => {
        if let Err(auth_error) = auth::handle_auth_message(&text).await {
          let error_response = ConnectionInitializationResponse {
            status: ConnectionInitializationStatus::Error(
              auth_error.to_string(),
            ),
          };
          let serialized_response = serde_json::to_string(&error_response)
            .expect("Error serializing auth error response");

          send_message(Message::Text(serialized_response), outgoing.clone())
            .await;

          close_connection(outgoing).await;
          return;
        } else {
          let success_response = ConnectionInitializationResponse {
            status: ConnectionInitializationStatus::Success,
          };
          let serialized_response = serde_json::to_string(&success_response)
            .expect("Error serializing auth success response");

          send_message(Message::Text(serialized_response), outgoing.clone())
            .await;
        }
      }
      _ => {
        error!("Invalid authentication message from {}", addr);
        close_connection(outgoing).await;
        return;
      }
    }
  } else {
    error!("No authentication message from {}", addr);
    close_connection(outgoing).await;
    return;
  }

  let mut ping_timeout = Box::pin(tokio::time::sleep(SOCKET_HEARTBEAT_TIMEOUT));
  let mut got_heartbeat_response = true;

  loop {
    tokio::select! {
      client_message = incoming.next() => {
        let message: Message = match client_message {
          Some(Ok(msg)) => msg,
          _ => {
            debug!("Connection to {} closed remotely.", addr);
            break;
          }
        };

        match message {
          Message::Close(_) => {
            debug!("Connection to {} closed.", addr);
            break;
          }
         Message::Pong(_) => {
            debug!("Received Pong message from {}", addr);
          }
          Message::Ping(msg) => {
            debug!("Received Ping message from {}", addr);
            send_message(Message::Pong(msg), outgoing.clone()).await;
          }
          Message::Text(text) => {
            got_heartbeat_response = true;
            ping_timeout = Box::pin(tokio::time::sleep(SOCKET_HEARTBEAT_TIMEOUT));

            if let Err(e) = handle_websocket_frame(text, outgoing.clone()).await {
              error!("Error handling WebSocket frame: {}", e);
              continue;
            };
          }
          _ => {
            error!("Client sent invalid message type");
            break;
          }
        }
      }
      _ = &mut ping_timeout => {
        if !got_heartbeat_response {
          error!("Connection to {} died.", addr);
          break;
        }
        let serialized = serde_json::to_string(&Heartbeat {}).unwrap();
        send_message(Message::text(serialized), outgoing.clone()).await;

        got_heartbeat_response = false;
        ping_timeout = Box::pin(tokio::time::sleep(SOCKET_HEARTBEAT_TIMEOUT));
      }
      else => {
        debug!("Unhealthy connection for: {}", addr);
        break;
      }
    }
  }

  info!("unregistering connection to: {}", addr);
  close_connection(outgoing).await;
}
