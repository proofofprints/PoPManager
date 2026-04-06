use tokio::net::TcpStream;
use tokio::io::{AsyncWriteExt, AsyncReadExt};
use super::miner::{MinerInfo, BoardInfo, PoolInfo, HashrateHistory, HealthState};

async fn tcp_command(ip: &str, command: &str) -> Result<String, String> {
    let addr = format!("{}:4028", ip);
    log::debug!("Antminer TCP connect to {}", addr);
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

    // Strip null bytes — CGMiner terminates with \x00
    let response: Vec<u8> = response.into_iter().filter(|b| *b != 0).collect();
    String::from_utf8(response).map_err(|e| format!("Invalid UTF-8: {}", e))
}

async fn send_cgminer_cmd(ip: &str, command: &str) -> Result<serde_json::Value, String> {
    let cmd_str = format!("{{\"command\":\"{}\"}}\n", command);
    let raw = tcp_command(ip, &cmd_str).await?;
    log::debug!("Antminer {} response from {}: {}", command, ip, &raw[..raw.len().min(200)]);
    serde_json::from_str(&raw).map_err(|e| format!("JSON parse error for {}: {}", command, e))
}

pub async fn fetch_antminer_info(ip: &str) -> Result<MinerInfo, String> {
    log::info!("Fetching Antminer info from {}", ip);

    // summary
    let summary_resp = send_cgminer_cmd(ip, "summary").await
        .map_err(|e| format!("summary failed: {}", e))?;
    let summary = summary_resp
        .get("SUMMARY")
        .and_then(|v| v.get(0))
        .ok_or("No SUMMARY in response")?;

    // Antminer reports hashrate in GH/s already (despite "MHS" field name)
    let rt_hashrate = summary.get("MHS 5s").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let avg_hashrate = summary.get("MHS av").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let accepted_total = summary.get("Accepted").and_then(|v| v.as_u64()).unwrap_or(0);
    let rejected_total = summary.get("Rejected").and_then(|v| v.as_u64()).unwrap_or(0);
    let hw_errors = summary.get("Hardware Errors").and_then(|v| v.as_u64()).unwrap_or(0);
    let elapsed_secs = summary.get("Elapsed").and_then(|v| v.as_u64()).unwrap_or(0);

    log::info!("Antminer {}: rt={:.1} GH/s avg={:.1} GH/s accepted={}", ip, rt_hashrate, avg_hashrate, accepted_total);

    // stats — board temps, fans, chip counts
    let stats_resp = send_cgminer_cmd(ip, "stats").await.ok();
    let (boards, fans) = if let Some(ref resp) = stats_resp {
        let stats = resp.get("STATS").and_then(|v| v.get(0));
        if let Some(s) = stats {
            // Extract fans
            let mut fan_speeds = Vec::new();
            for i in 1..=8 {
                let key = format!("fan{}", i);
                if let Some(speed) = s.get(&key).and_then(|v| v.as_u64()) {
                    if speed > 0 {
                        fan_speeds.push(speed as u32);
                    }
                }
            }

            // Extract boards — look for temp2_N pattern (inlet) and temp_chip_N (chip)
            let mut board_list = Vec::new();
            for i in 1..=8 {
                let in_tmp_key = format!("temp2_{}", i);
                let chip_tmp_key = format!("temp_chip_{}", i);
                let acn_key = format!("chain_acn{}", i);

                if let Some(in_tmp) = s.get(&in_tmp_key).and_then(|v| v.as_f64()) {
                    if in_tmp > 0.0 {
                        let out_tmp = s.get(&chip_tmp_key).and_then(|v| v.as_f64()).unwrap_or(in_tmp);
                        let chips = s.get(&acn_key).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        board_list.push(BoardInfo {
                            no: (i - 1) as u32,
                            chip_num: chips,
                            freq: 0.0,
                            rt_pow: String::new(),
                            rt_pow_value: 0.0,
                            in_tmp,
                            out_tmp,
                            state: true,
                        });
                    }
                }
            }
            (board_list, fan_speeds)
        } else {
            (vec![], vec![])
        }
    } else {
        (vec![], vec![])
    };

    // pools
    let pools_resp = send_cgminer_cmd(ip, "pools").await.ok();
    let pools: Vec<PoolInfo> = if let Some(ref resp) = pools_resp {
        resp.get("POOLS")
            .and_then(|v| v.as_array())
            .map(|pool_list| {
                pool_list.iter().enumerate().map(|(i, p)| {
                    let url = p.get("URL").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let user = p.get("User").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let status = p.get("Status").and_then(|v| v.as_str()).unwrap_or("");
                    let stratum_active = p.get("Stratum Active").and_then(|v| v.as_bool()).unwrap_or(false);
                    let connected = status == "Alive" || stratum_active;
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

    // version — model name from Type field
    let version_resp = send_cgminer_cmd(ip, "version").await.ok();
    let model = version_resp.as_ref()
        .and_then(|r| r.get("VERSION"))
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("Type"))
        .and_then(|v| v.as_str())
        .unwrap_or("Antminer")
        .to_string();
    let fw_ver = version_resp.as_ref()
        .and_then(|r| r.get("VERSION"))
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("CGMiner"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    log::info!("Antminer model detected: {} at {}", model, ip);

    let dd = elapsed_secs / 86400;
    let hh = (elapsed_secs % 86400) / 3600;
    let mm = (elapsed_secs % 3600) / 60;
    let ss = elapsed_secs % 60;
    let runtime_str = format!("{:02}:{:02}:{:02}:{:02}", dd, hh, mm, ss);

    let now = chrono::Utc::now().to_rfc3339();
    let default_wattage = estimate_antminer_wattage(&model);

    // Suppress unused variable warnings
    let _ = accepted_total;
    let _ = rejected_total;

    Ok(MinerInfo {
        ip: ip.to_string(),
        hostname: String::new(),
        mac: String::new(),
        model,
        status: "online".to_string(),
        firmware: fw_ver,
        software: String::new(),
        online: true,
        rt_hashrate,
        avg_hashrate,
        hashrate_unit: "G".to_string(),
        runtime: runtime_str,
        runtime_secs: elapsed_secs,
        fans,
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
        manufacturer: "antminer".to_string(),
        hw_errors,
    })
}

fn estimate_antminer_wattage(model: &str) -> f64 {
    let m = model.to_lowercase();
    if m.contains("s21") && (m.contains("pro") || m.contains("hyd")) { 3510.0 }
    else if m.contains("s21") { 3500.0 }
    else if m.contains("s19") && m.contains("xp") { 3010.0 }
    else if m.contains("s19") && m.contains("pro") { 3250.0 }
    else if m.contains("s19") { 3250.0 }
    else if m.contains("s17") { 2520.0 }
    else { 3000.0 }
}
