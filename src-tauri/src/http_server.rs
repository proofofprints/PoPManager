use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;

use crate::commands::mobile_miner::{
    save_commands_to_disk, save_miners_to_disk, MobileCommand, MobileCommandsState, MobileMiner,
    MobileMinersState, MobileServerConfigState,
};

#[derive(Clone)]
pub struct AppState {
    pub miners: Arc<MobileMinersState>,
    pub config: Arc<MobileServerConfigState>,
    pub commands: Arc<MobileCommandsState>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody {
    device_id: String,
    name: Option<String>,
    device_model: Option<String>,
    os_version: Option<String>,
    app_version: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportBody {
    device_id: String,
    name: Option<String>,
    device_model: Option<String>,
    os_version: Option<String>,
    app_version: Option<String>,
    coin: Option<String>,
    manufacturer: Option<String>,
    model: Option<String>,
    pool: Option<String>,
    worker: Option<String>,
    hashrate: Option<f64>,
    accepted_shares: Option<u64>,
    rejected_shares: Option<u64>,
    difficulty: Option<f64>,
    runtime: Option<u64>,
    cpu_temp: Option<f64>,
    throttle_state: Option<String>,
    battery_level: Option<u32>,
    battery_charging: Option<bool>,
    threads: Option<u32>,
    status: Option<String>,
    error_message: Option<String>,
    timestamp: Option<i64>,
    #[serde(default)]
    ack_commands: Option<Vec<AckCommand>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AckCommand {
    id: String,
    status: String, // "applied" | "failed"
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueCommandBody {
    #[serde(rename = "type")]
    command_type: String,
    params: Option<serde_json::Value>,
}

async fn handle_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RegisterBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let device_id = body.device_id.clone();

    let (port, report_interval, stored_auth_code) = {
        let cfg = state.config.config.lock().unwrap();
        (
            cfg.port,
            cfg.report_interval_seconds,
            cfg.auth_code.clone(),
        )
    };

    let report_url = match local_ip_address::local_ip() {
        Ok(ip) => format!("http://{}:{}/api/miners/mobile/report", ip, port),
        Err(_) => format!("http://localhost:{}/api/miners/mobile/report", port),
    };

    let provided_api_key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let provided_auth_code = headers
        .get("x-auth-code")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Reconnection path: existing device presenting its existing per-device key.
    // No pairing code required, and the pairing code is NOT rotated.
    {
        let miners = state.miners.miners.lock().unwrap();
        if let Some(existing) = miners.get(&device_id) {
            if let Some(ref key) = provided_api_key {
                if key == &existing.api_key {
                    let api_key = existing.api_key.clone();
                    log::info!(
                        "Reconnection for mobile miner: {} ({})",
                        device_id,
                        existing.name
                    );
                    return Ok(Json(json!({
                        "ok": true,
                        "apiKey": api_key,
                        "reportUrl": report_url,
                        "reportIntervalSeconds": report_interval,
                    })));
                }
            }
        }
    }

    // Fresh pairing path: require a valid pairing code.
    match provided_auth_code.as_deref() {
        Some(code) if !stored_auth_code.is_empty() && code == stored_auth_code => {
            // valid — fall through
        }
        Some(_) => {
            log::warn!(
                "Invalid pairing code in registration attempt for device {}",
                device_id
            );
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({"ok": false, "error": "Invalid pairing code"})),
            ));
        }
        None => {
            log::warn!(
                "Missing pairing code in registration attempt for device {}",
                device_id
            );
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "ok": false,
                    "error": "Pairing code required. Get the current code from PoPManager's Mobile Miners screen."
                })),
            ));
        }
    }

    // Generate new per-device API key and create/replace the record.
    let api_key = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let name = body
        .name
        .unwrap_or_else(|| format!("Mobile Miner {}", &device_id[..8.min(device_id.len())]));

    let miner = MobileMiner {
        device_id: device_id.clone(),
        api_key: api_key.clone(),
        name,
        device_model: body.device_model.unwrap_or_default(),
        os_version: body.os_version.unwrap_or_default(),
        app_version: body.app_version.unwrap_or_default(),
        manufacturer: "PoPMiner".to_string(),
        model: "Mobile".to_string(),
        registered_at: now,
        last_report_timestamp: now,
        is_online: true,
        ..Default::default()
    };

    {
        let mut miners = state.miners.miners.lock().unwrap();
        miners.insert(device_id.clone(), miner);
        save_miners_to_disk(&miners);
    }

    // Rotate the pairing code so it can only be used once.
    let new_auth_code = crate::commands::mobile_miner::generate_auth_code();
    {
        let mut cfg = state.config.config.lock().unwrap();
        cfg.auth_code = new_auth_code;
        if let Err(e) = crate::commands::mobile_miner::save_config_to_disk(&cfg) {
            log::warn!("Failed to persist rotated pairing code: {}", e);
        }
    }

    log::info!(
        "New mobile miner registered: {} (API key issued, pairing code rotated)",
        device_id
    );

    Ok(Json(json!({
        "ok": true,
        "apiKey": api_key,
        "reportUrl": report_url,
        "reportIntervalSeconds": report_interval,
    })))
}

async fn handle_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ReportBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let device_id = body.device_id.clone();

    let (require_api_key, report_interval) = {
        let cfg = state.config.config.lock().unwrap();
        (cfg.require_api_key, cfg.report_interval_seconds)
    };

    let mut miners = state.miners.miners.lock().unwrap();

    let miner = match miners.get_mut(&device_id) {
        Some(m) => m,
        None => {
            log::warn!("Report from unregistered device: {}", device_id);
            return Err((
                StatusCode::NOT_FOUND,
                Json(
                    json!({"ok": false, "error": "Device not registered. Please re-register."}),
                ),
            ));
        }
    };

    // Verify API key
    if require_api_key {
        let provided_key = headers.get("x-api-key").and_then(|v| v.to_str().ok());
        match provided_key {
            Some(key) if key == miner.api_key => {}
            _ => {
                log::warn!("Invalid API key in report from device {}", device_id);
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"ok": false, "error": "Invalid API key"})),
                ));
            }
        }
    }

    // Update miner stats
    let now = chrono::Utc::now().timestamp_millis();
    if let Some(n) = body.name {
        miner.name = n;
    }
    if let Some(v) = body.device_model {
        miner.device_model = v;
    }
    if let Some(v) = body.os_version {
        miner.os_version = v;
    }
    if let Some(v) = body.app_version {
        miner.app_version = v;
    }
    if let Some(v) = body.coin {
        miner.coin = v;
    }
    if let Some(v) = body.manufacturer {
        miner.manufacturer = v;
    }
    if let Some(v) = body.model {
        miner.model = v;
    }
    if let Some(v) = body.pool {
        miner.pool = v;
    }
    if let Some(v) = body.worker {
        miner.worker = v;
    }
    if let Some(v) = body.hashrate {
        miner.hashrate_hs = v;
    }
    if let Some(v) = body.accepted_shares {
        miner.accepted_shares = v;
    }
    if let Some(v) = body.rejected_shares {
        miner.rejected_shares = v;
    }
    if let Some(v) = body.difficulty {
        miner.difficulty = v;
    }
    if let Some(v) = body.runtime {
        miner.runtime_seconds = v;
    }
    if let Some(v) = body.cpu_temp {
        miner.cpu_temp = v;
    }
    if let Some(v) = body.throttle_state {
        miner.throttle_state = v;
    }
    if let Some(v) = body.battery_level {
        miner.battery_level = v;
    }
    if let Some(v) = body.battery_charging {
        miner.battery_charging = v;
    }
    if let Some(v) = body.threads {
        miner.threads = v;
    }
    if let Some(v) = body.status {
        miner.status = v;
    }
    miner.error_message = body.error_message;
    miner.last_report_timestamp = body.timestamp.unwrap_or(now);
    miner.is_online = true;

    log::debug!(
        "Report received from mobile miner: {} ({:.0} H/s)",
        device_id,
        miner.hashrate_hs
    );

    save_miners_to_disk(&miners);
    drop(miners);

    // Process acknowledgements from device for previously queued commands.
    if let Some(acks) = body.ack_commands {
        let mut commands = state.commands.commands.lock().unwrap();
        if let Some(device_commands) = commands.get_mut(&device_id) {
            let now = chrono::Utc::now().timestamp_millis();
            for ack in acks {
                if let Some(cmd) = device_commands.iter_mut().find(|c| c.id == ack.id) {
                    cmd.status = ack.status.clone();
                    cmd.acked_at = Some(now);
                    cmd.error = ack.error;
                    log::info!(
                        "Command {} for device {} acked: {}",
                        ack.id,
                        device_id,
                        ack.status
                    );
                }
            }
            save_commands_to_disk(&commands);
        }
    }

    // Build the list of pending commands to send back to the device.
    let pending_commands: Vec<serde_json::Value> = {
        let commands = state.commands.commands.lock().unwrap();
        commands
            .get(&device_id)
            .map(|cmds| {
                cmds.iter()
                    .filter(|c| c.status == "pending")
                    .map(|c| {
                        let mut obj = json!({
                            "id": c.id,
                            "type": c.command_type,
                        });
                        if !c.params.is_null() {
                            obj["params"] = c.params.clone();
                        }
                        obj
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    Ok(Json(json!({
        "ok": true,
        "nextReportIn": report_interval,
        "commands": pending_commands,
    })))
}

async fn handle_health() -> Json<Value> {
    Json(json!({"ok": true, "version": "0.1.0"}))
}

async fn handle_list_miners(State(state): State<AppState>) -> Json<Vec<MobileMiner>> {
    log::debug!("GET /api/miners/mobile requested");
    let miners = state.miners.miners.lock().unwrap();
    let mut result: Vec<MobileMiner> = miners.values().cloned().collect();
    result.sort_by(|a, b| b.last_report_timestamp.cmp(&a.last_report_timestamp));
    Json(result)
}

async fn handle_queue_command(
    State(state): State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
    headers: HeaderMap,
    Json(body): Json<QueueCommandBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Verify API key matches the device's stored key.
    let provided_key = headers.get("x-api-key").and_then(|v| v.to_str().ok());
    {
        let miners = state.miners.miners.lock().unwrap();
        let miner = match miners.get(&device_id) {
            Some(m) => m,
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(json!({"ok": false, "error": "Device not registered"})),
                ));
            }
        };
        if provided_key != Some(miner.api_key.as_str()) {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({"ok": false, "error": "Invalid API key"})),
            ));
        }
    }

    let valid_types = ["set_config", "set_threads", "start", "stop", "restart"];
    if !valid_types.contains(&body.command_type.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "Invalid command type"})),
        ));
    }

    let cmd = MobileCommand {
        id: uuid::Uuid::new_v4().to_string(),
        device_id: device_id.clone(),
        command_type: body.command_type,
        params: body.params.unwrap_or(serde_json::Value::Null),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "pending".to_string(),
        acked_at: None,
        error: None,
    };

    let cmd_id = cmd.id.clone();
    let mut commands = state.commands.commands.lock().unwrap();
    let device_commands = commands.entry(device_id.clone()).or_insert_with(Vec::new);
    if device_commands.len() >= 100 {
        if let Some(pos) = device_commands.iter().position(|c| c.status != "pending") {
            device_commands.remove(pos);
        } else {
            device_commands.remove(0);
        }
    }
    device_commands.push(cmd);
    save_commands_to_disk(&commands);

    log::info!(
        "Queued mobile command {} via HTTP for device {}",
        cmd_id,
        device_id
    );

    Ok(Json(json!({"id": cmd_id, "status": "queued"})))
}

pub fn build_router(
    miners: Arc<MobileMinersState>,
    config: Arc<MobileServerConfigState>,
    commands: Arc<MobileCommandsState>,
) -> Router {
    use tower_http::cors::{Any, CorsLayer};

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState {
        miners,
        config,
        commands,
    };

    Router::new()
        .route("/api/miners/mobile", get(handle_list_miners))
        .route("/api/miners/mobile/register", post(handle_register))
        .route("/api/miners/mobile/report", post(handle_report))
        .route("/api/miners/mobile/health", get(handle_health))
        .route(
            "/api/miners/mobile/:device_id/command",
            post(handle_queue_command),
        )
        .with_state(state)
        .layer(cors)
}

pub async fn start_server(
    port: u16,
    miners: Arc<MobileMinersState>,
    config: Arc<MobileServerConfigState>,
    commands: Arc<MobileCommandsState>,
) {
    let router = build_router(miners, config, commands);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    log::info!("Mobile miner HTTP server starting on port {}", port);

    let server_url = match local_ip_address::local_ip() {
        Ok(ip) => format!("http://{}:{}", ip, port),
        Err(_) => format!("http://localhost:{}", port),
    };
    log::info!("Mobile miner server URL: {}", server_url);

    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            if let Err(e) = axum::serve(listener, router).await {
                log::warn!("Mobile miner HTTP server error: {}", e);
            }
        }
        Err(e) => {
            log::warn!(
                "Failed to bind mobile miner server on port {}: {}",
                port,
                e
            );
        }
    }
}
