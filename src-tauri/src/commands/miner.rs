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
    pows: HashMap<String, Vec<u32>>,
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

/// Detect model from softver string
fn detect_model(softver: &str, api_model: &str) -> String {
    let sv = softver.to_lowercase();
    if sv.contains("ks0ultra") {
        "Iceriver KS0 Ultra".to_string()
    } else if sv.contains("ks0pro") {
        "Iceriver KS0 Pro".to_string()
    } else if sv.contains("ks0") {
        "Iceriver KS0".to_string()
    } else if !api_model.is_empty() && api_model != "none" {
        api_model.to_string()
    } else {
        "Iceriver".to_string()
    }
}

/// Fetch live status from an Iceriver miner at the given IP.
pub async fn fetch_miner_info(ip: String) -> Result<MinerInfo, String> {
    let url = format!("http://{}/user/userpanel?post=4", ip);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Connection failed to {ip}: {e}"))?;

    let panel: IceriverResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response from {ip}: {e}"))?;

    if panel.error != 0 {
        return Err(format!("Miner API error {}: {}", panel.error, panel.message));
    }

    let d = panel.data;

    let rt_hashrate = parse_hashrate(&d.rtpow);
    let avg_hashrate = parse_hashrate(&d.avgpow);
    let runtime_secs = parse_runtime(&d.runtime);
    let model = detect_model(&d.softver1, &d.model);

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
    let mut pows_sorted: Vec<(String, Vec<u32>)> = d.pows.into_iter().collect();
    pows_sorted.sort_by_key(|(k, _)| k.clone());
    for (board_name, values) in pows_sorted {
        hashrate_history.push(HashrateHistory {
            board: board_name,
            values,
            labels: labels.clone(),
        });
    }

    let status = if d.online { "online" } else { "offline" }.to_string();
    let now = chrono::Utc::now().to_rfc3339();

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
    })
}

/// Tauri command: fetch status for a single miner by IP.
#[command]
pub async fn get_miner_status(ip: String) -> Result<MinerInfo, String> {
    fetch_miner_info(ip).await
}
