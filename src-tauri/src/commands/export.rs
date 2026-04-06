use tauri::Manager;

fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn csv_row(fields: &[&str]) -> String {
    fields.iter().map(|f| csv_field(f)).collect::<Vec<_>>().join(",")
}

fn storage_path(name: &str) -> std::path::PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from("."))
    });
    base.join("PoPManager").join(name)
}

fn app_data_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join(name))
}

#[tauri::command]
pub async fn export_miners_csv(app: tauri::AppHandle) -> Result<String, String> {
    // Load saved miners
    let miners_path = storage_path("miners.json");
    let miners: Vec<serde_json::Value> = if miners_path.exists() {
        let content = std::fs::read_to_string(&miners_path)
            .map_err(|e| format!("Failed to read miners: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    // Load uptime records for 24h stats
    let uptime_path = app_data_path(&app, "uptime.json")?;
    let uptime_records: Vec<serde_json::Value> = if uptime_path.exists() {
        let content = std::fs::read_to_string(&uptime_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let cutoff_24h = now_secs - 24 * 3600;

    let mut rows = vec![csv_row(&[
        "Name", "IP", "Model", "Manufacturer", "Coin", "Status",
        "Hashrate (GH/s)", "Avg Temp (C)", "Pool", "Uptime 24h (%)", "Wattage (W)",
    ])];

    for miner in &miners {
        let ip = miner["ip"].as_str().unwrap_or("");
        let label = miner["label"].as_str().unwrap_or(ip);
        let coin_id = miner["coin_id"].as_str().unwrap_or("unknown");
        let wattage = miner["wattage"].as_f64().unwrap_or(100.0);

        // Calculate 24h uptime from records
        let ip_records: Vec<_> = uptime_records.iter()
            .filter(|r| {
                r["ip"].as_str() == Some(ip) &&
                r["timestamp"].as_i64().unwrap_or(0) > cutoff_24h
            })
            .collect();
        let total = ip_records.len() as f64;
        let online = ip_records.iter().filter(|r| r["online"].as_bool().unwrap_or(false)).count() as f64;
        let uptime_pct = if total > 0.0 { (online / total * 100.0).round() } else { 100.0 };

        rows.push(csv_row(&[
            label,
            ip,
            "",   // Model — not stored in saved miners
            "",   // Manufacturer
            coin_id,
            "",   // Status (live data not available at export time)
            "",   // Hashrate
            "",   // Avg Temp
            "",   // Pool
            &format!("{:.1}", uptime_pct),
            &format!("{:.0}", wattage),
        ]));
    }

    Ok(rows.join("\r\n"))
}

#[tauri::command]
pub async fn export_alert_history_csv(app: tauri::AppHandle) -> Result<String, String> {
    // Alert history is stored in old-style path via dirs::data_local_dir
    let history_path = storage_path("alert_history.json");

    // Try app data dir as well (some systems may use that)
    let history_path = if history_path.exists() {
        history_path
    } else {
        app_data_path(&app, "alert_history.json")?
    };

    let events: Vec<serde_json::Value> = if history_path.exists() {
        let content = std::fs::read_to_string(&history_path)
            .map_err(|e| format!("Failed to read alert history: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    let mut rows = vec![csv_row(&[
        "Timestamp", "Miner IP", "Miner Name", "Rule", "Message", "Acknowledged",
    ])];

    for event in &events {
        let timestamp = event["timestamp"].as_str().unwrap_or("");
        let miner_ip = event["minerIp"].as_str().unwrap_or("");
        let miner_label = event["minerLabel"].as_str().unwrap_or("");
        let rule_name = event["ruleName"].as_str().unwrap_or("");
        let message = event["message"].as_str().unwrap_or("");
        let acknowledged = if event["acknowledged"].as_bool().unwrap_or(false) { "Yes" } else { "No" };

        rows.push(csv_row(&[timestamp, miner_ip, miner_label, rule_name, message, acknowledged]));
    }

    Ok(rows.join("\r\n"))
}

#[tauri::command]
pub async fn export_profitability_csv(app: tauri::AppHandle, currency: String) -> Result<String, String> {
    // Load saved miners grouped by coin
    let miners_path = storage_path("miners.json");
    let miners: Vec<serde_json::Value> = if miners_path.exists() {
        let content = std::fs::read_to_string(&miners_path)
            .map_err(|e| format!("Failed to read miners: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    // Group by coin_id
    let mut coin_groups: std::collections::HashMap<String, Vec<&serde_json::Value>> = std::collections::HashMap::new();
    for miner in &miners {
        let coin_id = miner["coin_id"].as_str().unwrap_or("unknown").to_string();
        coin_groups.entry(coin_id).or_default().push(miner);
    }

    let mut rows = vec![csv_row(&[
        "Coin", "Miners", "Total Hashrate (GH/s)",
        &format!("Daily Gross ({})", currency.to_uppercase()),
        &format!("Daily Power Cost ({})", currency.to_uppercase()),
        &format!("Daily Net ({})", currency.to_uppercase()),
        &format!("Monthly Net ({})", currency.to_uppercase()),
    ])];

    for (coin_id, group) in &coin_groups {
        let miner_count = group.len();
        // Wattage sum for power estimate
        let total_wattage: f64 = group.iter().map(|m| m["wattage"].as_f64().unwrap_or(100.0)).sum();
        let daily_power_kwh = total_wattage / 1000.0 * 24.0;

        rows.push(csv_row(&[
            coin_id,
            &miner_count.to_string(),
            "",   // Hashrate not available without live data
            "",   // Daily gross not available without live price
            &format!("{:.3}", daily_power_kwh),
            "",
            "",
        ]));
    }

    // Suppress unused variable warning
    let _ = app;

    Ok(rows.join("\r\n"))
}

#[tauri::command]
pub async fn export_farm_history_csv(app: tauri::AppHandle, hours: u32) -> Result<String, String> {
    let history_path = app_data_path(&app, "history.json")?;

    let snapshots: Vec<serde_json::Value> = if history_path.exists() {
        let content = std::fs::read_to_string(&history_path)
            .map_err(|e| format!("Failed to read farm history: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let cutoff = now_secs - (hours as i64 * 3600);

    let mut rows = vec![csv_row(&[
        "Timestamp", "Total Hashrate (GH/s)", "Online Miners", "Total Miners",
    ])];

    for snapshot in &snapshots {
        let ts = snapshot["timestamp"].as_i64().unwrap_or(0);
        if ts <= cutoff {
            continue;
        }
        let dt = chrono::DateTime::from_timestamp(ts, 0)
            .map(|d| d.format("%Y-%m-%d %H:%M:%S UTC").to_string())
            .unwrap_or_else(|| ts.to_string());
        let hashrate = snapshot["totalHashrate"].as_f64().unwrap_or(0.0);
        let online = snapshot["onlineCount"].as_u64().unwrap_or(0);
        let total = snapshot["totalMiners"].as_u64().unwrap_or(0);

        rows.push(csv_row(&[
            &dt,
            &format!("{:.2}", hashrate),
            &online.to_string(),
            &total.to_string(),
        ]));
    }

    Ok(rows.join("\r\n"))
}
