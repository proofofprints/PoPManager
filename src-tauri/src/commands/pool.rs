use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct PoolConfig {
    pub url: String,
    pub user: String,
    pub password: String,
}

/// Configure the mining pool on a miner.
/// Stub: will POST to the Iceriver API once endpoint is confirmed.
#[command]
pub async fn configure_pool(
    ip: String,
    config: PoolConfig,
) -> Result<(), String> {
    // TODO: POST to Iceriver KS0 pool config endpoint
    // e.g., POST /user/userpanel?post=<n> with pool fields
    log::info!("Configuring pool on {}: {} / {}", ip, config.url, config.user);
    Ok(())
}
