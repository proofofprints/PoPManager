use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MobileMiner {
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub device_model: String,
    #[serde(default)]
    pub os_version: String,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub coin: String,
    #[serde(default = "default_manufacturer")]
    pub manufacturer: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub pool: String,
    #[serde(default)]
    pub worker: String,
    #[serde(default)]
    pub hashrate_hs: f64,
    #[serde(default)]
    pub accepted_shares: u64,
    #[serde(default)]
    pub rejected_shares: u64,
    #[serde(default)]
    pub difficulty: f64,
    #[serde(default)]
    pub runtime_seconds: u64,
    #[serde(default)]
    pub cpu_temp: f64,
    #[serde(default = "default_throttle_state")]
    pub throttle_state: String,
    #[serde(default)]
    pub battery_level: u32,
    #[serde(default)]
    pub battery_charging: bool,
    #[serde(default)]
    pub threads: u32,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub last_report_timestamp: i64,
    #[serde(default)]
    pub registered_at: i64,
    #[serde(default)]
    pub is_online: bool,
}

fn default_manufacturer() -> String {
    "KASMobileMiner".to_string()
}
fn default_model() -> String {
    "Mobile".to_string()
}
fn default_throttle_state() -> String {
    "normal".to_string()
}
fn default_status() -> String {
    "stopped".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MobileServerConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_require_api_key")]
    pub require_api_key: bool,
    #[serde(default = "default_report_interval")]
    pub report_interval_seconds: u32,
    #[serde(default)]
    pub auth_code: String,
}

fn default_enabled() -> bool {
    false
}
fn default_port() -> u16 {
    8787
}
fn default_require_api_key() -> bool {
    true
}
fn default_report_interval() -> u32 {
    30
}

impl Default for MobileServerConfig {
    fn default() -> Self {
        MobileServerConfig {
            enabled: false,
            port: 8787,
            require_api_key: true,
            report_interval_seconds: 30,
            auth_code: String::new(),
        }
    }
}

// ─── Pairing Code ─────────────────────────────────────────────────────────────

/// Generate a random 6-digit pairing code using UUID v4 as an entropy source.
/// UUID v4 is RFC 4122 random (122 bits of entropy), so the first 4 bytes are
/// cryptographically random — not derived from a timestamp.
pub fn generate_auth_code() -> String {
    let uuid = uuid::Uuid::new_v4();
    let bytes = uuid.as_bytes();
    let num = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{:06}", num)
}

// ─── State ────────────────────────────────────────────────────────────────────

pub struct MobileMinersState {
    pub miners: Mutex<HashMap<String, MobileMiner>>,
}

impl MobileMinersState {
    pub fn new() -> Self {
        MobileMinersState {
            miners: Mutex::new(HashMap::new()),
        }
    }
}

pub struct MobileServerConfigState {
    pub config: Mutex<MobileServerConfig>,
}

impl MobileServerConfigState {
    pub fn new() -> Self {
        MobileServerConfigState {
            config: Mutex::new(MobileServerConfig::default()),
        }
    }
}

// ─── Mobile Commands ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MobileCommand {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(rename = "type")]
    pub command_type: String, // set_config | set_threads | start | stop | restart
    #[serde(default)]
    pub params: serde_json::Value, // JSON object, null for start/stop/restart
    #[serde(default)]
    pub created_at: i64, // unix ms
    #[serde(default = "default_command_status")]
    pub status: String, // pending | applied | failed
    #[serde(default)]
    pub acked_at: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
}

fn default_command_status() -> String {
    "pending".to_string()
}

pub struct MobileCommandsState {
    pub commands: Mutex<HashMap<String, Vec<MobileCommand>>>, // keyed by deviceId
}

impl MobileCommandsState {
    pub fn new() -> Self {
        MobileCommandsState {
            commands: Mutex::new(HashMap::new()),
        }
    }
}

// ─── File Paths ───────────────────────────────────────────────────────────────

pub fn miners_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("mobile_miners.json")
}

pub fn config_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("mobile_server_config.json")
}

pub fn commands_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("mobile_miner_commands.json")
}

// ─── I/O helpers ──────────────────────────────────────────────────────────────

pub fn load_miners_from_disk() -> HashMap<String, MobileMiner> {
    let path = miners_path();
    if !path.exists() {
        return HashMap::new();
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_miners_to_disk(miners: &HashMap<String, MobileMiner>) {
    let path = miners_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(miners) {
        Ok(content) => {
            if let Err(e) = fs::write(&path, content) {
                log::warn!("Failed to write mobile_miners.json: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize mobile miners: {}", e),
    }
}

pub fn load_config_from_disk() -> MobileServerConfig {
    let path = config_path();
    let mut config = if !path.exists() {
        MobileServerConfig::default()
    } else {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    };
    // Auto-generate pairing code if missing (fresh install or upgrade from older version)
    if config.auth_code.is_empty() {
        config.auth_code = generate_auth_code();
        if let Err(e) = save_config_to_disk(&config) {
            log::warn!("Failed to persist newly-generated pairing code: {}", e);
        } else {
            log::info!("Generated new mobile pairing code");
        }
    }
    config
}

pub fn save_config_to_disk(config: &MobileServerConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_commands_from_disk() -> HashMap<String, Vec<MobileCommand>> {
    let path = commands_path();
    if !path.exists() {
        return HashMap::new();
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_commands_to_disk(commands: &HashMap<String, Vec<MobileCommand>>) {
    let path = commands_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(commands) {
        Ok(content) => {
            if let Err(e) = fs::write(&path, content) {
                log::warn!("Failed to write mobile_miner_commands.json: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize mobile commands: {}", e),
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_mobile_miners(
    state: tauri::State<Arc<MobileMinersState>>,
) -> Vec<MobileMiner> {
    let miners = state.miners.lock().unwrap();
    let mut result: Vec<MobileMiner> = miners.values().cloned().collect();
    result.sort_by(|a, b| b.last_report_timestamp.cmp(&a.last_report_timestamp));
    result
}

#[tauri::command]
pub fn remove_mobile_miner(
    device_id: String,
    state: tauri::State<Arc<MobileMinersState>>,
) -> Result<(), String> {
    let mut miners = state.miners.lock().unwrap();
    miners.remove(&device_id);
    save_miners_to_disk(&miners);
    log::info!("Removed mobile miner: {}", device_id);
    Ok(())
}

#[tauri::command]
pub fn update_mobile_miner_name(
    device_id: String,
    name: String,
    state: tauri::State<Arc<MobileMinersState>>,
) -> Result<(), String> {
    let mut miners = state.miners.lock().unwrap();
    if let Some(miner) = miners.get_mut(&device_id) {
        miner.name = name.clone();
        save_miners_to_disk(&miners);
        log::info!("Renamed mobile miner {} to '{}'", device_id, name);
        Ok(())
    } else {
        Err(format!("Mobile miner not found: {}", device_id))
    }
}

#[tauri::command]
pub fn get_mobile_server_config(
    state: tauri::State<Arc<MobileServerConfigState>>,
) -> MobileServerConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_mobile_server_config(
    config: MobileServerConfig,
    config_state: tauri::State<Arc<MobileServerConfigState>>,
) -> Result<(), String> {
    let mut final_config = config;
    // Preserve existing auth_code — clients don't (and shouldn't) send it here
    {
        let existing = config_state.config.lock().unwrap();
        if !existing.auth_code.is_empty() {
            final_config.auth_code = existing.auth_code.clone();
        }
    }
    // Defensive: if still empty, generate one
    if final_config.auth_code.is_empty() {
        final_config.auth_code = generate_auth_code();
    }
    save_config_to_disk(&final_config)?;
    let mut state = config_state.config.lock().unwrap();
    *state = final_config;
    log::info!("Mobile server config saved");
    Ok(())
}

#[tauri::command]
pub fn get_mobile_auth_code(
    config_state: tauri::State<Arc<MobileServerConfigState>>,
) -> String {
    config_state.config.lock().unwrap().auth_code.clone()
}

#[tauri::command]
pub fn regenerate_mobile_auth_code(
    config_state: tauri::State<Arc<MobileServerConfigState>>,
) -> Result<String, String> {
    let new_code = generate_auth_code();
    {
        let mut cfg = config_state.config.lock().unwrap();
        cfg.auth_code = new_code.clone();
        save_config_to_disk(&cfg)?;
    }
    log::info!("Mobile pairing code manually regenerated");
    Ok(new_code)
}

#[tauri::command]
pub fn get_mobile_server_url(
    config_state: tauri::State<Arc<MobileServerConfigState>>,
) -> String {
    let config = config_state.config.lock().unwrap();
    let port = config.port;
    match local_ip_address::local_ip() {
        Ok(ip) => format!("http://{}:{}", ip, port),
        Err(_) => format!("http://localhost:{}", port),
    }
}

#[tauri::command]
pub async fn restart_mobile_server() -> Result<(), String> {
    log::info!("restart_mobile_server called — restart the app to apply port changes");
    Ok(())
}

// ─── Mobile Command Tauri Commands ────────────────────────────────────────────

#[tauri::command]
pub fn queue_mobile_command(
    device_id: String,
    command_type: String,
    params: Option<serde_json::Value>,
    state: tauri::State<Arc<MobileCommandsState>>,
) -> Result<MobileCommand, String> {
    let valid_types = ["set_config", "set_threads", "start", "stop", "restart"];
    if !valid_types.contains(&command_type.as_str()) {
        return Err(format!("Invalid command type: {}", command_type));
    }

    let cmd = MobileCommand {
        id: uuid::Uuid::new_v4().to_string(),
        device_id: device_id.clone(),
        command_type,
        params: params.unwrap_or(serde_json::Value::Null),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "pending".to_string(),
        acked_at: None,
        error: None,
    };

    let mut commands = state.commands.lock().unwrap();
    let device_commands = commands.entry(device_id.clone()).or_insert_with(Vec::new);

    // Cap at 100 per device — drop oldest non-pending if over.
    if device_commands.len() >= 100 {
        if let Some(pos) = device_commands.iter().position(|c| c.status != "pending") {
            device_commands.remove(pos);
        } else {
            device_commands.remove(0);
        }
    }

    device_commands.push(cmd.clone());
    save_commands_to_disk(&commands);

    log::info!(
        "Queued mobile command {} ({}) for device {}",
        cmd.id,
        cmd.command_type,
        device_id
    );
    Ok(cmd)
}

#[tauri::command]
pub fn get_mobile_commands(
    device_id: String,
    state: tauri::State<Arc<MobileCommandsState>>,
) -> Vec<MobileCommand> {
    let commands = state.commands.lock().unwrap();
    let mut device_commands = commands.get(&device_id).cloned().unwrap_or_default();
    device_commands.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    device_commands
}

#[tauri::command]
pub fn clear_mobile_command_history(
    device_id: String,
    state: tauri::State<Arc<MobileCommandsState>>,
) -> Result<(), String> {
    let mut commands = state.commands.lock().unwrap();
    if let Some(device_commands) = commands.get_mut(&device_id) {
        device_commands.retain(|c| c.status == "pending");
    }
    save_commands_to_disk(&commands);
    Ok(())
}

#[tauri::command]
pub fn cancel_mobile_command(
    device_id: String,
    command_id: String,
    state: tauri::State<Arc<MobileCommandsState>>,
) -> Result<(), String> {
    let mut commands = state.commands.lock().unwrap();
    if let Some(device_commands) = commands.get_mut(&device_id) {
        device_commands.retain(|c| !(c.id == command_id && c.status == "pending"));
    }
    save_commands_to_disk(&commands);
    Ok(())
}
