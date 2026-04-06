use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UptimeRecord {
    #[serde(default)]
    ip: String,
    #[serde(default)]
    timestamp: i64,
    #[serde(default)]
    online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UptimeStats {
    #[serde(default)]
    pub total_polls: u32,
    #[serde(default)]
    pub online_polls: u32,
    #[serde(default)]
    pub uptime_percent: f64,
    #[serde(default)]
    pub last_downtime: Option<i64>,
    #[serde(default)]
    pub current_streak_minutes: u32,
    #[serde(default)]
    pub is_online: bool,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn uptime_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("uptime.json"))
}

fn load_records(app: &tauri::AppHandle) -> Result<Vec<UptimeRecord>, String> {
    let path = uptime_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read uptime data: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|_| "Failed to parse uptime data, resetting".to_string())
        .or(Ok(Vec::new()))
}

fn save_records(app: &tauri::AppHandle, records: &[UptimeRecord]) -> Result<(), String> {
    let path = uptime_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    let content = serde_json::to_string(records)
        .map_err(|e| format!("Failed to serialize uptime data: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write uptime data: {}", e))
}

fn prune_old_records(records: &mut Vec<UptimeRecord>) {
    let before = records.len();
    let cutoff = now_secs() - 30 * 24 * 3600; // 30 days
    records.retain(|r| r.timestamp > cutoff);
    let pruned = before - records.len();
    if pruned > 0 {
        log::info!("Pruned {} old uptime record(s) (>30 days)", pruned);
    }
}

fn compute_stats(records: &[UptimeRecord], ip: &str, hours: u32) -> UptimeStats {
    let cutoff = now_secs() - (hours as i64 * 3600);
    let filtered: Vec<&UptimeRecord> = records
        .iter()
        .filter(|r| r.ip == ip && r.timestamp > cutoff)
        .collect();

    let total_polls = filtered.len() as u32;
    let online_polls = filtered.iter().filter(|r| r.online).count() as u32;
    let uptime_percent = if total_polls == 0 {
        100.0
    } else {
        (online_polls as f64 / total_polls as f64) * 100.0
    };

    let last_downtime = filtered
        .iter()
        .filter(|r| !r.online)
        .map(|r| r.timestamp)
        .max();

    // Sort by timestamp desc to find streak
    let mut sorted: Vec<&&UptimeRecord> = filtered.iter().collect();
    sorted.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let current_streak_minutes = if sorted.is_empty() {
        0
    } else {
        let latest_online = sorted[0].online;
        let streak_count = sorted.iter().take_while(|r| r.online == latest_online).count();
        // 45s poll interval = 0.75 minutes per poll
        (streak_count as f64 * 0.75) as u32
    };

    let is_online = sorted.first().map(|r| r.online).unwrap_or(false);

    UptimeStats {
        total_polls,
        online_polls,
        uptime_percent,
        last_downtime,
        current_streak_minutes,
        is_online,
    }
}

#[tauri::command]
pub async fn record_uptime(app: tauri::AppHandle, ip: String, online: bool) -> Result<(), String> {
    let mut records = load_records(&app)?;
    records.push(UptimeRecord {
        ip,
        timestamp: now_secs(),
        online,
    });
    prune_old_records(&mut records);
    save_records(&app, &records)
}

#[tauri::command]
pub async fn get_uptime_stats(
    app: tauri::AppHandle,
    ip: String,
    hours: u32,
) -> Result<UptimeStats, String> {
    let records = load_records(&app)?;
    Ok(compute_stats(&records, &ip, hours))
}

#[tauri::command]
pub async fn get_all_uptime_stats(
    app: tauri::AppHandle,
    hours: u32,
) -> Result<HashMap<String, UptimeStats>, String> {
    let records = load_records(&app)?;
    let cutoff = now_secs() - (hours as i64 * 3600);
    let ips: std::collections::HashSet<String> = records
        .iter()
        .filter(|r| r.timestamp > cutoff)
        .map(|r| r.ip.clone())
        .collect();
    let mut result = HashMap::new();
    for ip in ips {
        result.insert(ip.clone(), compute_stats(&records, &ip, hours));
    }
    Ok(result)
}

#[tauri::command]
pub async fn clear_uptime_data(app: tauri::AppHandle) -> Result<(), String> {
    save_records(&app, &[])
}
