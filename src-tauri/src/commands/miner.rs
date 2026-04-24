use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::command;

// ---- Raw Iceriver API response types ----

#[derive(Debug, Deserialize)]
struct IceriverResponse {
    error: i32,
    data: IceriverData,
    #[serde(default)]
    message: String,
}

#[derive(Debug, Deserialize)]
struct IceriverData {
    #[serde(default)]
    model: String,
    online: bool,
    #[serde(default)]
    firmver1: String,
    #[serde(default)]
    firmver2: String,
    #[serde(default)]
    softver1: String,
    #[serde(default)]
    softver2: String,
    #[serde(default)]
    firmtype: String,
    #[serde(default)]
    mac: String,
    #[serde(default)]
    ip: String,
    #[serde(default)]
    netmask: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    dhcp: bool,
    #[serde(default)]
    gateway: String,
    #[serde(default)]
    dns: String,
    #[serde(default)]
    rtpow: String,
    #[serde(default)]
    avgpow: String,
    #[serde(default)]
    reject: f64,
    #[serde(default)]
    runtime: String,
    #[serde(default)]
    unit: String,
    #[serde(default)]
    pows: HashMap<String, Vec<i32>>,
    #[serde(default)]
    pows_x: Vec<String>,
    #[serde(default)]
    powstate: bool,
    #[serde(default)]
    netstate: bool,
    #[serde(default)]
    fanstate: bool,
    #[serde(default)]
    tempstate: bool,
    #[serde(default)]
    fans: Vec<u32>,
    #[serde(default)]
    pools: Vec<IceriverPool>,
    #[serde(default)]
    boards: Vec<IceriverBoard>,
}

#[derive(Debug, Deserialize)]
struct IceriverPool {
    no: f64,
    #[serde(default)]
    addr: String,
    #[serde(default)]
    user: String,
    #[serde(default)]
    pass: String,
    #[serde(default)]
    connect: bool,
    #[serde(default)]
    diff: String,
    #[serde(default)]
    priority: f64,
    #[serde(default)]
    accepted: f64,
    #[serde(default)]
    rejected: f64,
    #[serde(default)]
    state: f64,
}

#[derive(Debug, Deserialize)]
struct IceriverBoard {
    no: f64,
    #[serde(default)]
    chipnum: f64,
    #[serde(default)]
    freq: f64,
    #[serde(default)]
    rtpow: String,
    #[serde(default)]
    intmp: f64,
    #[serde(default)]
    outtmp: f64,
    #[serde(default)]
    state: bool,
}

// ---- Frontend-facing types ----

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PoolInfo {
    pub no: u32,
    pub addr: String,
    pub user: String,
    pub pass: String,
    pub connect: bool,
    pub diff: String,
    pub accepted: u64,
    pub rejected: u64,
    pub state: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub no: u32,
    pub chip_num: u32,
    pub freq: f64,
    pub rt_pow: String,
    pub rt_pow_value: f64,
    pub in_tmp: f64,
    pub out_tmp: f64,
    pub state: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HashrateHistory {
    pub board: String,
    pub values: Vec<u32>,
    pub labels: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HealthState {
    pub power: bool,
    pub network: bool,
    pub fan: bool,
    pub temp: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MinerInfo {
    pub ip: String,
    pub hostname: String,
    pub mac: String,
    pub model: String,
    pub status: String, // "online" | "offline"
    pub firmware: String,
    pub software: String,
    pub online: bool,
    pub rt_hashrate: f64,
    pub avg_hashrate: f64,
    pub hashrate_unit: String,
    pub runtime: String,
    pub runtime_secs: u64,
    pub fans: Vec<u32>,
    pub boards: Vec<BoardInfo>,
    pub pools: Vec<PoolInfo>,
    pub hashrate_history: Vec<HashrateHistory>,
    pub health: HealthState,
    pub last_seen: String,
    pub default_wattage: f64,
    #[serde(default)]
    pub manufacturer: String,
    #[serde(default)]
    pub hw_errors: u64,
}

// ---- Helpers ----

/// Parse hashrate string like "98G" or "21.07G" → f64
fn parse_hashrate(s: &str) -> f64 {
    s.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.')
        .parse::<f64>()
        .unwrap_or(0.0)
}

/// Parse runtime "DD:HH:MM:SS" → total seconds
fn parse_runtime(s: &str) -> u64 {
    let parts: Vec<&str> = s.split(':').collect();
    match parts.as_slice() {
        [dd, hh, mm, ss] => {
            let d = dd.parse::<u64>().unwrap_or(0);
            let h = hh.parse::<u64>().unwrap_or(0);
            let m = mm.parse::<u64>().unwrap_or(0);
            let s = ss.parse::<u64>().unwrap_or(0);
            d * 86400 + h * 3600 + m * 60 + s
        }
        _ => 0,
    }
}

/// Detect model and default wattage from softver and api_model strings
fn detect_model_and_wattage(softver: &str, api_model: &str) -> (String, f64) {
    let sv = softver.to_lowercase();
    let am = api_model.to_lowercase();

    // Check softver first
    let wattage_from_softver = if sv.contains("ks0ultra") || sv.contains("ks0 ultra") {
        Some(("Iceriver KS0 Ultra".to_string(), 100.0_f64))
    } else if sv.contains("ks0pro") || sv.contains("ks0 pro") {
        Some(("Iceriver KS0 Pro".to_string(), 100.0_f64))
    } else if sv.contains("ks0") {
        Some(("Iceriver KS0".to_string(), 65.0_f64))
    } else if sv.contains("ks3") {
        Some(("Iceriver KS3".to_string(), 3200.0_f64))
    } else if sv.contains("ks2") {
        Some(("Iceriver KS2".to_string(), 1200.0_f64))
    } else if sv.contains("ks1") {
        Some(("Iceriver KS1".to_string(), 600.0_f64))
    } else {
        None
    };

    if let Some(result) = wattage_from_softver {
        return result;
    }

    // Check softver for Bitcoin Antminer / Whatsminer patterns
    let wattage_from_bitcoin = if sv.contains("s21") && (sv.contains("pro") || sv.contains("hyd")) {
        Some(("Antminer S21 Pro".to_string(), 3510.0_f64))
    } else if sv.contains("s21") {
        Some(("Antminer S21".to_string(), 3500.0_f64))
    } else if sv.contains("s19") && sv.contains("xp") {
        Some(("Antminer S19 XP".to_string(), 3010.0_f64))
    } else if sv.contains("s19") && sv.contains("pro") {
        Some(("Antminer S19 Pro".to_string(), 3250.0_f64))
    } else if sv.contains("s19") {
        Some(("Antminer S19".to_string(), 3250.0_f64))
    } else if sv.contains("m66") {
        Some(("Whatsminer M66".to_string(), 5500.0_f64))
    } else if sv.contains("m60") {
        Some(("Whatsminer M60".to_string(), 3420.0_f64))
    } else if sv.contains("m56") {
        Some(("Whatsminer M56".to_string(), 5550.0_f64))
    } else if sv.contains("m50") {
        Some(("Whatsminer M50".to_string(), 3276.0_f64))
    } else {
        None
    };

    if let Some(result) = wattage_from_bitcoin {
        return result;
    }

    // Fall back to api_model
    if !api_model.is_empty() && api_model != "none" {
        let wattage = if am.contains("s21") && (am.contains("pro") || am.contains("hyd")) { 3510.0 }
            else if am.contains("s21") { 3500.0 }
            else if am.contains("s19") && am.contains("xp") { 3010.0 }
            else if am.contains("s19") && am.contains("pro") { 3250.0 }
            else if am.contains("s19") { 3250.0 }
            else if am.contains("m66") { 5500.0 }
            else if am.contains("m60") { 3420.0 }
            else if am.contains("m56") { 5550.0 }
            else if am.contains("m50") { 3276.0 }
            else if am.contains("ks3") { 3200.0 }
            else if am.contains("ks2") { 1200.0 }
            else if am.contains("ks1") { 600.0 }
            else if am.contains("ks0pro") || am.contains("ks0 pro") { 100.0 }
            else if am.contains("ks0") { 65.0 }
            else { 100.0 };
        return (api_model.to_string(), wattage);
    }

    ("Iceriver".to_string(), 100.0)
}

/// Fetch live status from an Iceriver miner at the given IP.
pub async fn fetch_iceriver_info(ip: String) -> Result<MinerInfo, String> {
    let url = format!("http://{}/user/userpanel?post=4", ip);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            log::warn!("Connection failed to {}: {}", ip, e);
            format!("Connection failed to {ip}: {e}")
        })?;

    let panel: IceriverResponse = resp
        .json()
        .await
        .map_err(|e| {
            log::warn!("Failed to parse response from {}: {}", ip, e);
            format!("Failed to parse response from {ip}: {e}")
        })?;

    if panel.error != 0 {
        log::error!("Miner API error {} from {}: {}", panel.error, ip, panel.message);
        return Err(format!("Miner API error {}: {}", panel.error, panel.message));
    }

    let d = panel.data;

    let rt_hashrate = parse_hashrate(&d.rtpow);
    let avg_hashrate = parse_hashrate(&d.avgpow);
    let runtime_secs = parse_runtime(&d.runtime);
    let (model, default_wattage) = detect_model_and_wattage(&d.softver1, &d.model);

    let boards = d
        .boards
        .into_iter()
        .map(|b| BoardInfo {
            no: b.no as u32,
            chip_num: b.chipnum as u32,
            freq: b.freq,
            rt_pow: b.rtpow.clone(),
            rt_pow_value: parse_hashrate(&b.rtpow),
            in_tmp: b.intmp,
            out_tmp: b.outtmp,
            state: b.state,
        })
        .collect::<Vec<_>>();

    let pools = d
        .pools
        .into_iter()
        .map(|p| PoolInfo {
            no: p.no as u32,
            addr: p.addr,
            user: p.user,
            pass: p.pass,
            connect: p.connect,
            diff: p.diff,
            accepted: p.accepted as u64,
            rejected: p.rejected as u64,
            state: p.state as u32,
        })
        .collect::<Vec<_>>();

    // Build hashrate history from pows map + labels
    let mut hashrate_history = Vec::new();
    let labels = d.pows_x.clone();
    let mut pows_sorted: Vec<(String, Vec<i32>)> = d.pows.into_iter().collect();
    pows_sorted.sort_by_key(|(k, _)| k.clone());
    for (board_name, raw_values) in pows_sorted {
        // Pair values with labels, filter out -1 sentinel values (unfilled
        // history slots from miners that haven't been running long enough),
        // and convert the remaining values to u32.
        let paired: Vec<(u32, String)> = raw_values
            .into_iter()
            .zip(labels.iter().cloned())
            .filter(|(v, _)| *v >= 0)
            .map(|(v, l)| (v as u32, l))
            .collect();
        let (clean_values, clean_labels): (Vec<u32>, Vec<String>) = paired.into_iter().unzip();
        hashrate_history.push(HashrateHistory {
            board: board_name,
            values: clean_values,
            labels: clean_labels,
        });
    }

    let status = if d.online { "online" } else { "offline" }.to_string();
    let now = chrono::Utc::now().to_rfc3339();

    log::info!("Fetched miner {} — model={} rt={:.1}{} avg={:.1}{}", ip, model, rt_hashrate, d.unit, avg_hashrate, d.unit);

    Ok(MinerInfo {
        ip: d.ip.clone(),
        hostname: d.host,
        mac: d.mac,
        model,
        status,
        firmware: format!("{} / {}", d.firmver1, d.firmver2),
        software: format!("{} / {}", d.softver1, d.softver2),
        online: d.online,
        rt_hashrate,
        avg_hashrate,
        hashrate_unit: d.unit,
        runtime: d.runtime,
        runtime_secs,
        fans: d.fans,
        boards,
        pools,
        hashrate_history,
        health: HealthState {
            power: d.powstate,
            network: d.netstate,
            fan: d.fanstate,
            temp: d.tempstate,
        },
        last_seen: now,
        default_wattage,
        manufacturer: "iceriver".to_string(),
        hw_errors: 0,
    })
}

/// Tauri command: fetch status for a single miner by IP.
/// If manufacturer is None or "unknown", auto-detects by trying each protocol in sequence.
#[command]
pub async fn get_miner_status(ip: String, manufacturer: Option<String>) -> Result<MinerInfo, String> {
    let mfr = manufacturer.as_deref().unwrap_or("unknown");
    match mfr {
        "iceriver" => fetch_iceriver_info(ip).await,
        "whatsminer" => super::whatsminer::fetch_whatsminer_info(&ip).await,
        "antminer" => super::antminer::fetch_antminer_info(&ip).await,
        _ => {
            // Auto-detect: try each in sequence
            log::info!("Auto-detecting manufacturer for {}", ip);
            if let Ok(info) = fetch_iceriver_info(ip.clone()).await {
                return Ok(info);
            }
            if let Ok(info) = super::whatsminer::fetch_whatsminer_info(&ip).await {
                return Ok(info);
            }
            if let Ok(info) = super::antminer::fetch_antminer_info(&ip).await {
                return Ok(info);
            }
            Err(format!("Could not connect to miner at {}", ip))
        }
    }
}
