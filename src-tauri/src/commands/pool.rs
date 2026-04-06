use serde::{Deserialize, Serialize};
use tauri::command;

// ---- Kept for backwards compat (no-op stub) ----

#[derive(Debug, Serialize, Deserialize)]
pub struct PoolSlot {
    pub no: u32,
    pub addr: String,
    pub user: String,
    pub pass: String,
}

#[command]
pub async fn configure_pool(ip: String, pools: Vec<PoolSlot>) -> Result<(), String> {
    for p in &pools {
        log::info!("configure_pool slot {} on {}: {}", p.no, ip, p.addr);
    }
    Ok(())
}

// ---- Real pool push implementation ----

/// Pool configuration payload matching Iceriver /user/machineconfig POST fields.
#[derive(Debug, Serialize, Deserialize)]
pub struct PoolConfig {
    pub pool1address: String,
    pub pool1miner: String,
    pub pool1pwd: String,
    pub pool2address: String,
    pub pool2miner: String,
    pub pool2pwd: String,
    pub pool3address: String,
    pub pool3miner: String,
    pub pool3pwd: String,
}

/// Minimal response struct for reading fan settings.
#[derive(Debug, Deserialize, Default)]
struct FanSettingsResponse {
    #[serde(default)]
    data: FanSettingsData,
}

#[derive(Debug, Deserialize, Default)]
struct FanSettingsData {
    #[serde(default)]
    fanratio: Option<u32>,
    #[serde(default)]
    fanmode: Option<String>,
}

/// The form body sent to /user/machineconfig.
#[derive(Debug, Serialize)]
struct MachineConfigForm<'a> {
    pool1address: &'a str,
    pool1miner: &'a str,
    pool1pwd: &'a str,
    pool2address: &'a str,
    pool2miner: &'a str,
    pool2pwd: &'a str,
    pool3address: &'a str,
    pool3miner: &'a str,
    pool3pwd: &'a str,
    fanratio: u32,
    fanmode: &'a str,
    post: &'a str,
}

/// Push pool configuration to a single Iceriver miner.
///
/// Steps:
/// 1. GET /user/userpanel?post=4 to read current fan settings (preserves them).
/// 2. POST /user/machineconfig with pool + fan settings.
///    The miner restarts its mining process, so a 65-second timeout is used.
#[command]
pub async fn set_miner_pools(ip: String, pools: PoolConfig) -> Result<String, String> {
    // Step 1: fetch current fan settings with a short timeout.
    let probe_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    log::info!("Pushing pool config to {}", ip);
    let fan_url = format!("http://{}/user/userpanel?post=4", ip);
    let fan_data: FanSettingsData = match probe_client.get(&fan_url).send().await {
        Ok(resp) => match resp.json::<FanSettingsResponse>().await {
            Ok(r) => r.data,
            Err(_) => FanSettingsData::default(),
        },
        Err(_) => FanSettingsData::default(),
    };

    let fan_ratio = fan_data.fanratio.unwrap_or(50);
    let fan_mode = fan_data.fanmode.unwrap_or_else(|| "normal".to_string());

    // Step 2: POST pool config with 65-second timeout.
    let post_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(65))
        .build()
        .map_err(|e| e.to_string())?;

    let config_url = format!("http://{}/user/machineconfig", ip);
    let form = MachineConfigForm {
        pool1address: &pools.pool1address,
        pool1miner: &pools.pool1miner,
        pool1pwd: &pools.pool1pwd,
        pool2address: &pools.pool2address,
        pool2miner: &pools.pool2miner,
        pool2pwd: &pools.pool2pwd,
        pool3address: &pools.pool3address,
        pool3miner: &pools.pool3miner,
        pool3pwd: &pools.pool3pwd,
        fanratio: fan_ratio,
        fanmode: &fan_mode,
        post: "2",
    };

    let resp = post_client
        .post(&config_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Failed to apply pool config to {ip}: {e}"))?;

    if resp.status().is_success() {
        log::info!("Pool config applied to {} (pool1={})", ip, pools.pool1address);
        Ok(format!("Pool config applied to {ip}"))
    } else {
        log::error!("Pool config push to {} failed: HTTP {}", ip, resp.status().as_u16());
        Err(format!(
            "Miner at {ip} returned HTTP {}",
            resp.status().as_u16()
        ))
    }
}
