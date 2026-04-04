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

/// Return the local machine's /24 subnet in CIDR notation (e.g. "192.168.1.0/24").
#[command]
pub fn get_local_subnet() -> Result<String, String> {
    use local_ip_address::local_ip;
    let ip = local_ip().map_err(|e| e.to_string())?;
    match ip {
        std::net::IpAddr::V4(v4) => {
            let o = v4.octets();
            Ok(format!("{}.{}.{}.0/24", o[0], o[1], o[2]))
        }
        std::net::IpAddr::V6(_) => {
            Err("IPv6 not supported for subnet detection".to_string())
        }
    }
}
