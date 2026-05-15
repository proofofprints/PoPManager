use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoinSnapshot {
    pub hashrate: f64,
    pub miner_count: u32,
    pub daily_earnings_coins: f64,
    pub daily_earnings_fiat: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FarmSnapshot {
    pub timestamp: i64,
    pub total_hashrate: f64,
    pub online_count: u32,
    pub total_miners: u32,
    pub coin_data: HashMap<String, CoinSnapshot>,
}

const MAX_HISTORY_SECS: i64 = 30 * 24 * 3600;

fn history_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("history.json"))
}

fn load_history(app: &tauri::AppHandle) -> Result<Vec<FarmSnapshot>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read history: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|_| "Failed to parse history, resetting".to_string())
        .or(Ok(Vec::new()))
}

fn save_history(app: &tauri::AppHandle, snapshots: &[FarmSnapshot]) -> Result<(), String> {
    let path = history_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    let content = serde_json::to_string(snapshots)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write history: {}", e))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn add_farm_snapshot(app: tauri::AppHandle, snapshot: FarmSnapshot) -> Result<(), String> {
    // Serialize for cloud before moving into history vec
    let cloud_payload = serde_json::to_value(&snapshot).ok();

    let mut snapshots = load_history(&app)?;
    snapshots.push(snapshot);
    let before = snapshots.len();
    let cutoff = now_secs() - MAX_HISTORY_SECS;
    snapshots.retain(|s| s.timestamp > cutoff);
    let pruned = before - snapshots.len();
    if pruned > 0 {
        log::info!("Farm history: pruned {} snapshot(s) older than 30 days", pruned);
    }
    log::info!("Farm snapshot saved ({} total snapshots)", snapshots.len());
    save_history(&app, &snapshots)?;

    // Push to cloud sync if logged in
    match app.try_state::<Arc<crate::cloud::CloudState>>() {
        Some(cloud_state) => {
            let has_key = cloud_state.api_key.lock().unwrap().is_some();
            if has_key {
                if let Some(payload) = cloud_payload {
                    *cloud_state.latest_snapshot.lock().unwrap() = Some(payload.clone());
                    match crate::cloud::queue::enqueue("snapshot", &payload) {
                        Ok(()) => log::info!("Cloud: snapshot enqueued for sync"),
                        Err(e) => log::warn!("Cloud: failed to enqueue snapshot: {}", e),
                    }
                }
            } else {
                log::debug!("Cloud: snapshot skipped — no API key");
            }
        }
        None => {
            log::debug!("Cloud: snapshot skipped — CloudState not available");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_farm_history(app: tauri::AppHandle, hours: u32) -> Result<Vec<FarmSnapshot>, String> {
    let snapshots = load_history(&app)?;
    let cutoff = now_secs() - (hours as i64 * 3600);
    Ok(snapshots.into_iter().filter(|s| s.timestamp > cutoff).collect())
}

#[tauri::command]
pub async fn clear_farm_history(app: tauri::AppHandle) -> Result<(), String> {
    save_history(&app, &[])
}
