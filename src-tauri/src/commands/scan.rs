use serde::{Deserialize, Serialize};
use tauri::command;

use super::miner::{fetch_iceriver_info, MinerInfo};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub found: Vec<MinerInfo>,
    pub scanned_range: String,
    pub duration: u64,
}

async fn probe_ip(ip_str: String) -> Option<MinerInfo> {
    use tokio::net::TcpStream;

    // 1. Try IceRiver (HTTP port 80)
    if let Ok(info) = fetch_iceriver_info(ip_str.clone()).await {
        log::info!("Scan: {} → iceriver ({})", ip_str, info.model);
        return Some(info);
    }

    // 2. Try TCP port 4028
    let addr = format!("{}:4028", ip_str);
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        TcpStream::connect(&addr),
    )
    .await;

    let Ok(Ok(_stream)) = stream else {
        return None; // Port not open
    };

    // Port 4028 is open — drop connection and re-probe with protocol commands
    drop(_stream);

    // Try Antminer first (CGMiner "command" key)
    if let Ok(info) = super::antminer::fetch_antminer_info(&ip_str).await {
        log::info!("Scan: {} → antminer ({})", ip_str, info.model);
        return Some(info);
    }

    // Try Whatsminer ("cmd" key)
    if let Ok(info) = super::whatsminer::fetch_whatsminer_info(&ip_str).await {
        log::info!("Scan: {} → whatsminer ({})", ip_str, info.model);
        return Some(info);
    }

    log::warn!("Scan: {} → port 4028 open but could not identify manufacturer", ip_str);
    None
}

/// Scan the given CIDR range for ASIC miners (IceRiver, Whatsminer, Antminer).
#[command]
pub async fn scan_network(cidr: String) -> Result<ScanResult, String> {
    use ipnetwork::IpNetwork;
    use std::time::Instant;

    let start = Instant::now();
    let network: IpNetwork = cidr.parse().map_err(|e| format!("Invalid CIDR: {e}"))?;

    let mut handles = vec![];
    for ip in network.iter() {
        let ip_str = ip.to_string();
        handles.push(tokio::spawn(async move { probe_ip(ip_str).await }));
    }

    let mut found = vec![];
    for handle in handles {
        if let Ok(Some(info)) = handle.await {
            found.push(info);
        }
    }

    let duration = start.elapsed().as_millis() as u64;
    log::info!("Scan complete: found {} miner(s) in {}ms", found.len(), duration);

    Ok(ScanResult {
        found,
        scanned_range: cidr,
        duration,
    })
}

/// Return the local machine's /24 subnet in CIDR notation.
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
