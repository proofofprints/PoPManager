use std::sync::Arc;

use super::{client, queue, CloudState, CloudSyncStatus};

/// Background sync loop that pushes snapshots and drains the offline queue.
///
/// Runs on a 60-second ticker. When the user is not logged in (no API key),
/// it sleeps and checks again. All operations are non-blocking.
pub async fn start_sync_loop(
    cloud_state: Arc<CloudState>,
    _app_handle: tauri::AppHandle,
) {
    log::info!("Cloud: sync loop started");
    let mut cycle: u64 = 0;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

        // Check if logged in
        let api_key = {
            let guard = cloud_state.api_key.lock().unwrap();
            match guard.clone() {
                Some(k) => k,
                None => {
                    log::debug!("Cloud sync: no API key, skipping cycle");
                    continue;
                }
            }
        };

        cycle += 1;
        log::info!("Cloud sync: cycle {} — checking for data to push", cycle);

        // --- 1. Push latest snapshot if available ---
        let snapshot = {
            cloud_state.latest_snapshot.lock().unwrap().take()
        };

        if let Some(payload) = snapshot {
            log::info!("Cloud sync: pushing snapshot to cloud");
            match client::push_snapshot(&api_key, &payload).await {
                Ok(()) => {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    *cloud_state.last_sync.lock().unwrap() = Some(now_ms);
                    *cloud_state.status.lock().unwrap() = CloudSyncStatus::Connected;
                    log::info!("Cloud sync: snapshot pushed successfully");
                }
                Err(e) => {
                    log::warn!("Cloud sync: snapshot push failed, queueing — {}", e);
                    if let Err(qe) = queue::enqueue("snapshot", &payload) {
                        log::warn!("Cloud sync: failed to enqueue snapshot: {}", qe);
                    }
                    // Check for auth errors
                    if e.contains("(401)") || e.contains("(403)") {
                        *cloud_state.status.lock().unwrap() = CloudSyncStatus::AuthRequired;
                    }
                }
            }
        }

        // --- 2. Push latest miners state if available ---
        let miners = {
            cloud_state.latest_miners.lock().unwrap().take()
        };

        if let Some(payload) = miners {
            log::info!("Cloud sync: pushing miner state to cloud");
            match client::push_miners(&api_key, &payload).await {
                Ok(()) => {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    *cloud_state.last_sync.lock().unwrap() = Some(now_ms);
                    *cloud_state.status.lock().unwrap() = CloudSyncStatus::Connected;
                    log::info!("Cloud sync: miner state pushed successfully");
                }
                Err(e) => {
                    log::warn!("Cloud sync: miner push failed, queueing — {}", e);
                    if let Err(qe) = queue::enqueue("miners", &payload) {
                        log::warn!("Cloud sync: failed to enqueue miners: {}", qe);
                    }
                    if e.contains("(401)") || e.contains("(403)") {
                        *cloud_state.status.lock().unwrap() = CloudSyncStatus::AuthRequired;
                    }
                }
            }
        }

        // --- 3. Drain offline queue ---
        match queue::peek(10) {
            Ok(items) => {
                for item in items {
                    let result = match item.kind.as_str() {
                        "snapshot" => {
                            let payload: serde_json::Value =
                                serde_json::from_str(&item.payload_json).unwrap_or_default();
                            client::push_snapshot(&api_key, &payload).await
                        }
                        "alert" => {
                            let payload: serde_json::Value =
                                serde_json::from_str(&item.payload_json).unwrap_or_default();
                            client::push_alert(&api_key, &payload).await
                        }
                        "miners" => {
                            let payload: serde_json::Value =
                                serde_json::from_str(&item.payload_json).unwrap_or_default();
                            client::push_miners(&api_key, &payload).await
                        }
                        other => {
                            log::warn!("Cloud sync: unknown queue item kind '{}'", other);
                            // Remove unknown items
                            let _ = queue::remove(item.id);
                            continue;
                        }
                    };

                    match result {
                        Ok(()) => {
                            let _ = queue::remove(item.id);
                            log::debug!("Cloud sync: drained queue item {} ({})", item.id, item.kind);
                        }
                        Err(e) => {
                            // Classify error
                            if e.contains("(401)") || e.contains("(403)") {
                                *cloud_state.status.lock().unwrap() = CloudSyncStatus::AuthRequired;
                                log::warn!("Cloud sync: auth error, stopping drain — {}", e);
                                break;
                            }
                            // Transient or permanent — mark failed
                            let _ = queue::mark_failed(item.id, &e);
                            log::debug!(
                                "Cloud sync: queue item {} failed (attempt {}): {}",
                                item.id,
                                item.attempts + 1,
                                e
                            );
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Cloud sync: failed to peek queue: {}", e);
            }
        }

        // --- 4. Update queue size ---
        if let Ok(count) = queue::count() {
            *cloud_state.queue_size.lock().unwrap() = count;
        }

        // --- 5. Periodic prune (every ~100 cycles ≈ 100 minutes) ---
        if cycle % 100 == 0 {
            if let Err(e) = queue::prune() {
                log::warn!("Cloud sync: prune failed: {}", e);
            }
        }
    }
}
