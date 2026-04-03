use serde::{Deserialize, Serialize};
use tauri::command;

use super::miner::{fetch_miner_info, MinerInfo};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub found: Vec<MinerInfo>,
    pub scanned_range: String,
    pub duration: u64,
}

/// Scan the given CIDR range for Iceriver miners.
/// Probes each host on port 80, then calls the userpanel API.
#[command]
pub async fn scan_network(cidr: String) -> Result<ScanResult, String> {
    use ipnetwork::IpNetwork;
    use std::time::Instant;

    let start = Instant::now();

    let network: IpNetwork = cidr.parse().map_err(|e| format!("Invalid CIDR: {e}"))?;

    let mut handles = vec![];

    for ip in network.iter() {
        let ip_str = ip.to_string();
        handles.push(tokio::spawn(async move {
            fetch_miner_info(ip_str).await.ok()
        }));
    }

    let mut found = vec![];
    for handle in handles {
        if let Ok(Some(info)) = handle.await {
            found.push(info);
        }
    }

    let duration = start.elapsed().as_millis() as u64;

    Ok(ScanResult {
        found,
        scanned_range: cidr,
        duration,
    })
}
