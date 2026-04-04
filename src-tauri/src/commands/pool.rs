use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct PoolSlot {
    pub no: u32,
    pub addr: String,
    pub user: String,
    pub pass: String,
}

/// Configure mining pools on a miner.
/// Stub: will POST to the Iceriver API once endpoint is confirmed.
#[command]
pub async fn configure_pool(ip: String, pools: Vec<PoolSlot>) -> Result<(), String> {
    for p in &pools {
        log::info!("Configuring pool slot {} on {}: {} / {}", p.no, ip, p.addr, p.user);
    }
    Ok(())
}
