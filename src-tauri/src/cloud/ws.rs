use std::sync::Arc;

use futures_util::{Sink, SinkExt, StreamExt};
use tauri::Emitter;
use tokio_tungstenite::tungstenite::Message;

use super::{command_exec, CloudState, CloudSyncStatus};

// See note in cloud/client.rs — the API host is cloud-api.overbuildlabs.com,
// NOT cloud.overbuildlabs.com (which serves the React portal). Old
// cloud-api.proofofprints.com still resolves to the same backend via
// Caddy aliases until the proofofprints.com domain is fully retired.
const WS_URL_BASE: &str = "wss://cloud-api.overbuildlabs.com/api/v1/ws";
const PING_INTERVAL_SECS: u64 = 30;

/// Backoff schedule: 5s → 10s → 30s → 60s (cap)
fn backoff_secs(attempt: u32) -> u64 {
    match attempt {
        0 => 5,
        1 => 10,
        2 => 30,
        _ => 60,
    }
}

/// Persistent WebSocket client that receives commands from PoPCloud and sends acks.
///
/// Auto-reconnects with exponential backoff. No-ops when the user is not logged in.
pub async fn start_ws_client(
    cloud_state: Arc<CloudState>,
    app_handle: tauri::AppHandle,
) {
    log::info!("Cloud: WebSocket client started");
    let mut reconnect_attempts: u32 = 0;

    loop {
        // Wait for API key
        let api_key = loop {
            let key = cloud_state.api_key.lock().unwrap().clone();
            if let Some(k) = key {
                break k;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        };

        let ws_url = format!("{}?apiKey={}", WS_URL_BASE, api_key);
        *cloud_state.status.lock().unwrap() = CloudSyncStatus::Connecting;
        log::info!("Cloud WS: connecting...");

        match tokio_tungstenite::connect_async(&ws_url).await {
            Ok((ws_stream, _response)) => {
                reconnect_attempts = 0;
                *cloud_state.status.lock().unwrap() = CloudSyncStatus::Connected;
                log::info!("Cloud WS: connected");

                let (mut write, mut read) = ws_stream.split();

                // Ping/keepalive interval
                let mut ping_interval =
                    tokio::time::interval(tokio::time::Duration::from_secs(PING_INTERVAL_SECS));
                ping_interval.tick().await; // consume the immediate first tick

                loop {
                    tokio::select! {
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    handle_message(&text, &cloud_state, &app_handle, &mut write).await;
                                }
                                Some(Ok(Message::Ping(data))) => {
                                    if let Err(e) = write.send(Message::Pong(data)).await {
                                        log::warn!("Cloud WS: failed to send pong: {}", e);
                                        break;
                                    }
                                }
                                Some(Ok(Message::Close(_))) => {
                                    log::info!("Cloud WS: server closed connection");
                                    break;
                                }
                                Some(Err(e)) => {
                                    log::warn!("Cloud WS: read error: {}", e);
                                    break;
                                }
                                None => {
                                    log::info!("Cloud WS: stream ended");
                                    break;
                                }
                                _ => {} // Binary, Pong, Frame — ignore
                            }
                        }
                        _ = ping_interval.tick() => {
                            if let Err(e) = write.send(Message::Ping(vec![].into())).await {
                                log::warn!("Cloud WS: failed to send ping: {}", e);
                                break;
                            }
                        }
                    }

                    // Check if user logged out
                    if cloud_state.api_key.lock().unwrap().is_none() {
                        log::info!("Cloud WS: user logged out, closing connection");
                        let _ = write.send(Message::Close(None)).await;
                        break;
                    }
                }
            }
            Err(e) => {
                log::warn!("Cloud WS: connection failed: {}", e);
            }
        }

        // Check if user logged out before reconnecting
        if cloud_state.api_key.lock().unwrap().is_none() {
            *cloud_state.status.lock().unwrap() = CloudSyncStatus::Disconnected;
            log::info!("Cloud WS: no API key, entering idle wait");
            continue;
        }

        // Reconnect with backoff
        let delay = backoff_secs(reconnect_attempts);
        reconnect_attempts = reconnect_attempts.saturating_add(1);
        *cloud_state.status.lock().unwrap() = CloudSyncStatus::Connecting;
        log::info!("Cloud WS: reconnecting in {}s (attempt {})", delay, reconnect_attempts);
        tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
    }
}

/// Parse an incoming WebSocket message and dispatch commands.
async fn handle_message<S>(
    text: &str,
    cloud_state: &Arc<CloudState>,
    app_handle: &tauri::AppHandle,
    write: &mut S,
) where
    S: Sink<Message> + SinkExt<Message> + Unpin,
    <S as Sink<Message>>::Error: std::fmt::Display,
{
    let msg: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("Cloud WS: failed to parse message: {} — {}", e, text);
            return;
        }
    };

    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "command" => {
            let data = match msg.get("data") {
                Some(d) => d,
                None => {
                    log::warn!("Cloud WS: command message missing 'data' field");
                    return;
                }
            };

            let cmd: command_exec::CloudCommand = match serde_json::from_value(data.clone()) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("Cloud WS: failed to parse command: {}", e);
                    return;
                }
            };

            log::info!(
                "Cloud WS: received command {} ({} → {}:{})",
                cmd.id,
                cmd.command_type,
                cmd.target_type,
                cmd.target_id
            );

            let result = command_exec::execute_command(&cmd, app_handle).await;

            // Send ack
            let ack = serde_json::json!({
                "type": "command-ack",
                "data": {
                    "id": cmd.id,
                    "status": result.status,
                    "error": result.error,
                }
            });

            if let Err(e) = write
                .send(Message::Text(serde_json::to_string(&ack).unwrap_or_default().into()))
                .await
            {
                log::warn!("Cloud WS: failed to send command ack: {}", e);
            }
        }
        "alert-read" => {
            let data = match msg.get("data") {
                Some(d) => d,
                None => {
                    log::warn!("Cloud WS: alert-read message missing 'data' field");
                    return;
                }
            };
            if !instance_matches(cloud_state, data) {
                log::debug!("Cloud WS: alert-read for a different instance, ignoring");
                return;
            }
            let rule_name = data.get("ruleName").and_then(|v| v.as_str()).unwrap_or("");
            let miner_id = data.get("minerId").and_then(|v| v.as_str()).unwrap_or("");
            let timestamp = data.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");

            match crate::commands::alerts::mark_alert_read(rule_name, miner_id, timestamp) {
                Ok(true) => {
                    log::info!(
                        "Cloud WS: alert marked read remotely (rule='{}', miner='{}')",
                        rule_name,
                        miner_id
                    );
                    let _ = app_handle.emit("alerts-updated", ());
                }
                Ok(false) => log::debug!(
                    "Cloud WS: alert-read had no local match (rule='{}', miner='{}', ts='{}')",
                    rule_name,
                    miner_id,
                    timestamp
                ),
                Err(e) => log::warn!("Cloud WS: failed to mark alert read: {}", e),
            }
        }
        "alerts-read-all" => {
            let data = msg.get("data").cloned().unwrap_or(serde_json::Value::Null);
            if !instance_matches(cloud_state, &data) {
                log::debug!("Cloud WS: alerts-read-all for a different instance, ignoring");
                return;
            }
            match crate::commands::alerts::mark_all_alerts_read() {
                Ok(true) => {
                    log::info!("Cloud WS: all alerts marked read remotely");
                    let _ = app_handle.emit("alerts-updated", ());
                }
                Ok(false) => log::debug!("Cloud WS: alerts-read-all — nothing to update"),
                Err(e) => log::warn!("Cloud WS: failed to mark all alerts read: {}", e),
            }
        }
        "ping" => {
            // Server-level ping (application layer), respond with pong
            let pong = serde_json::json!({ "type": "pong" });
            let _ = write
                .send(Message::Text(serde_json::to_string(&pong).unwrap_or_default().into()))
                .await;
        }
        other => {
            log::debug!("Cloud WS: ignoring message type '{}'", other);
        }
    }
}

/// Whether a payload's `instanceId` refers to this instance. Lenient: if the
/// payload omits it or we don't yet know our own instance id, we don't block
/// (the socket is already scoped to this instance by its apiKey). We only
/// reject when both are known and differ.
fn instance_matches(cloud_state: &Arc<CloudState>, data: &serde_json::Value) -> bool {
    let incoming = data.get("instanceId").and_then(|v| v.as_str());
    let ours = cloud_state.instance_id.lock().unwrap().clone();
    match (incoming, ours) {
        (Some(a), Some(b)) => a == b,
        _ => true,
    }
}
