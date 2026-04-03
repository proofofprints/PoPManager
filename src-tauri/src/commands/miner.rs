use serde::{Deserialize, Serialize};
use tauri::command;

// ---- Iceriver KS0 API response types ----

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PoolInfo {
    pub url: String,
    pub user: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HashrateBoard {
    pub id: u32,
    pub hashrate: f64,    // GH/s
    pub temperature: f64, // Celsius
    pub fan_speed: u32,   // RPM
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MinerInfo {
    pub ip: String,
    pub hostname: String,
    pub model: String,
    pub status: String, // "online" | "offline" | "warning" | "unknown"
    pub total_hashrate: f64, // GH/s
    pub boards: Vec<HashrateBoard>,
    pub pools: Vec<PoolInfo>,
    pub uptime: u64,       // seconds
    pub last_seen: String, // ISO timestamp
}

/// Raw Iceriver KS0 /user/userpanel?post=4 response shape.
/// Fields are mapped from the actual firmware JSON.
#[derive(Debug, Deserialize)]
struct IceriverPanelResponse {
    #[serde(default)]
    pub runtime: Option<u64>,
    #[serde(default)]
    pub hashboards: Option<Vec<IceriverBoard>>,
    #[serde(default)]
    pub pools: Option<Vec<IceriverPool>>,
}

#[derive(Debug, Deserialize)]
struct IceriverBoard {
    #[serde(rename = "index", default)]
    pub index: u32,
    #[serde(rename = "hashrate", default)]
    pub hashrate: f64,
    #[serde(rename = "temperature", default)]
    pub temperature: f64,
    #[serde(rename = "fanspeed", default)]
    pub fanspeed: u32,
}

#[derive(Debug, Deserialize)]
struct IceriverPool {
    #[serde(rename = "url", default)]
    pub url: String,
    #[serde(rename = "user", default)]
    pub user: String,
    #[serde(rename = "status", default)]
    pub status: String,
}

/// Fetch live status from an Iceriver miner at the given IP.
/// Uses the custom HTTP API on port 80: GET /user/userpanel?post=4
/// Timeout is short so the scanner doesn't block too long per host.
pub async fn fetch_miner_info(ip: String) -> Result<MinerInfo, String> {
    let url = format!("http://{}/user/userpanel?post=4", ip);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Connection failed to {ip}: {e}"))?;

    let panel: IceriverPanelResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response from {ip}: {e}"))?;

    let boards = panel
        .hashboards
        .unwrap_or_default()
        .into_iter()
        .map(|b| HashrateBoard {
            id: b.index,
            hashrate: b.hashrate,
            temperature: b.temperature,
            fan_speed: b.fanspeed,
        })
        .collect::<Vec<_>>();

    let total_hashrate = boards.iter().map(|b| b.hashrate).sum();

    let pools = panel
        .pools
        .unwrap_or_default()
        .into_iter()
        .map(|p| PoolInfo {
            url: p.url,
            user: p.user,
            status: p.status,
        })
        .collect::<Vec<_>>();

    let now = chrono::Utc::now().to_rfc3339();

    Ok(MinerInfo {
        ip: ip.clone(),
        hostname: ip, // Iceriver API doesn't always expose hostname
        model: "Iceriver KS0".to_string(),
        status: "online".to_string(),
        total_hashrate,
        boards,
        pools,
        uptime: panel.runtime.unwrap_or(0),
        last_seen: now,
    })
}

/// Tauri command: fetch status for a single miner by IP.
/// Call at 30-60 second intervals to avoid firmware memory leak.
#[command]
pub async fn get_miner_status(ip: String) -> Result<MinerInfo, String> {
    fetch_miner_info(ip).await
}
