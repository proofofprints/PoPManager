use tokio::net::TcpStream;
use tokio::io::{AsyncWriteExt, AsyncReadExt};
use super::miner::{MinerInfo, BoardInfo, PoolInfo, HashrateHistory, HealthState};

async fn tcp_command(ip: &str, command: &str) -> Result<String, String> {
    let addr = format!("{}:4028", ip);
    log::debug!("Whatsminer TCP connect to {}", addr);
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| format!("Connection timeout to {}", addr))?
    .map_err(|e| format!("Connection failed to {}: {}", addr, e))?;

    let (mut reader, mut writer) = stream.into_split();
    writer
        .write_all(command.as_bytes())
        .await
        .map_err(|e| format!("Write failed: {}", e))?;
    writer.shutdown().await.ok();

    let mut response = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        reader.read_to_end(&mut response),
    )
    .await
    .map_err(|_| "Read timeout".to_string())?
    .map_err(|e| format!("Read failed: {}", e))?;

    // Strip null bytes (safety — Whatsminer usually doesn't have them)
    let response: Vec<u8> = response.into_iter().filter(|b| *b != 0).collect();
    String::from_utf8(response).map_err(|e| format!("Invalid UTF-8: {}", e))
}

async fn send_whatsminer_cmd(ip: &str, cmd: &str) -> Result<serde_json::Value, String> {
    let command = format!("{{\"cmd\":\"{}\"}}\n", cmd);
    let raw = tcp_command(ip, &command).await?;
    log::debug!("Whatsminer {} response from {}: {}", cmd, ip, &raw[..raw.len().min(200)]);
    serde_json::from_str(&raw).map_err(|e| format!("JSON parse error for {}: {}", cmd, e))
}

pub async fn fetch_whatsminer_info(ip: &str) -> Result<MinerInfo, String> {
    log::info!("Fetching Whatsminer info from {}", ip);

    // summary
    let summary_resp = send_whatsminer_cmd(ip, "summary").await
        .map_err(|e| format!("summary failed: {}", e))?;
    let summary = summary_resp
        .get("SUMMARY")
        .and_then(|v| v.get(0))
        .ok_or("No SUMMARY in response")?;

    // MHS 5s is in MH/s — divide by 1000 to get GH/s
    let mhs_rt = summary.get("MHS 5s").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let mhs_av = summary.get("MHS av").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let rt_hashrate = mhs_rt / 1000.0;
    let avg_hashrate = mhs_av / 1000.0;
    let accepted_total = summary.get("Accepted").and_then(|v| v.as_u64()).unwrap_or(0);
    let rejected_total = summary.get("Rejected").and_then(|v| v.as_u64()).unwrap_or(0);
    let hw_errors = summary.get("Hardware Errors").and_then(|v| v.as_u64()).unwrap_or(0);
    let elapsed_secs = summary.get("Elapsed").and_then(|v| v.as_u64()).unwrap_or(0);

    log::info!("Whatsminer {}: rt={:.1} GH/s avg={:.1} GH/s accepted={}", ip, rt_hashrate, avg_hashrate, accepted_total);

    // edevs — per-board info
    let edevs_resp = send_whatsminer_cmd(ip, "edevs").await.ok();
    let boards: Vec<BoardInfo> = if let Some(ref resp) = edevs_resp {
        resp.get("DEVS")
            .and_then(|v| v.as_array())
            .map(|devs| {
                devs.iter().enumerate().map(|(i, dev)| {
                    let temp = dev.get("Temperature")
                        .or_else(|| dev.get("Chip Temp Avg"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let board_mhs = dev.get("MHS 5s").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let board_gh = board_mhs / 1000.0;
                    let chips = dev.get("Num chips")
                        .or_else(|| dev.get("num chips"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    BoardInfo {
                        no: i as u32,
                        chip_num: chips,
                        freq: 0.0,
                        rt_pow: format!("{:.1}G", board_gh),
                        rt_pow_value: board_gh,
                        in_tmp: temp,
                        out_tmp: temp,
                        state: true,
                    }
                }).collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    // pools
    let pools_resp = send_whatsminer_cmd(ip, "pools").await.ok();
    let pools: Vec<PoolInfo> = if let Some(ref resp) = pools_resp {
        resp.get("POOLS")
            .and_then(|v| v.as_array())
            .map(|pool_list| {
                pool_list.iter().enumerate().map(|(i, p)| {
                    let url = p.get("URL").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let user = p.get("User").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let status = p.get("Status").and_then(|v| v.as_str()).unwrap_or("");
                    let connected = status == "Alive";
                    let acc = p.get("Accepted").and_then(|v| v.as_u64()).unwrap_or(0);
                    let rej = p.get("Rejected").and_then(|v| v.as_u64()).unwrap_or(0);
                    PoolInfo {
                        no: i as u32,
                        addr: url,
                        user,
                        pass: String::new(),
                        connect: connected,
                        diff: String::new(),
                        accepted: acc,
                        rejected: rej,
                        state: if connected { 1 } else { 0 },
                    }
                }).collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    // get_version — model name
    let version_resp = send_whatsminer_cmd(ip, "get_version").await.ok();
    let model = version_resp.as_ref()
        .and_then(|r| r.get("Msg"))
        .and_then(|m| m.get("miner_type"))
        .and_then(|v| v.as_str())
        .unwrap_or("Whatsminer")
        .to_string();
    let firmware = version_resp.as_ref()
        .and_then(|r| r.get("Msg"))
        .and_then(|m| m.get("fw_ver"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    log::info!("Whatsminer model detected: {} at {}", model, ip);

    // Runtime string from elapsed seconds
    let dd = elapsed_secs / 86400;
    let hh = (elapsed_secs % 86400) / 3600;
    let mm = (elapsed_secs % 3600) / 60;
    let ss = elapsed_secs % 60;
    let runtime_str = format!("{:02}:{:02}:{:02}:{:02}", dd, hh, mm, ss);

    let now = chrono::Utc::now().to_rfc3339();

    // Estimate default wattage from model
    let default_wattage = estimate_whatsminer_wattage(&model);

    // Suppress unused variable warnings
    let _ = accepted_total;
    let _ = rejected_total;

    Ok(MinerInfo {
        ip: ip.to_string(),
        hostname: String::new(),
        mac: String::new(),
        model,
        status: "online".to_string(),
        firmware,
        software: String::new(),
        online: true,
        rt_hashrate,
        avg_hashrate,
        hashrate_unit: "G".to_string(),
        runtime: runtime_str,
        runtime_secs: elapsed_secs,
        fans: vec![],
        boards,
        pools,
        hashrate_history: vec![],
        health: HealthState {
            power: true,
            network: true,
            fan: true,
            temp: true,
        },
        last_seen: now,
        default_wattage,
        manufacturer: "whatsminer".to_string(),
        hw_errors,
    })
}

fn estimate_whatsminer_wattage(model: &str) -> f64 {
    let m = model.to_lowercase();
    if m.contains("m66") { 5500.0 }
    else if m.contains("m60") { 3420.0 }
    else if m.contains("m56") { 5550.0 }
    else if m.contains("m50") { 3276.0 }
    else if m.contains("m30") { 3400.0 }
    else { 3000.0 }
}
