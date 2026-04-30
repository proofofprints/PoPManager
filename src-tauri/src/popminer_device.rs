use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::Emitter;

const POPMINER_SERVICE: &str = "_popminer._tcp.local.";

/// Identity from GET /api/info (fetched once on discovery)
/// Note: ESP32 API sends snake_case JSON, so NO rename_all here.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PopMinerInfo {
    #[serde(default)]
    pub fw: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub mac: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub sdk: String,
    #[serde(default)]
    pub heap: u64,
    #[serde(default)]
    pub uptime_s: u64,
}

/// Live stats from GET /api/stats (polled every 5s)
/// Note: ESP32 API sends snake_case JSON, so NO rename_all here.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PopMinerStats {
    #[serde(default)]
    pub fw: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub mining: bool,
    #[serde(default)]
    pub pool_connected: bool,
    #[serde(default)]
    pub authorized: bool,
    #[serde(default)]
    pub hashrate: f64,
    #[serde(default)]
    pub difficulty: f64,
    #[serde(default)]
    pub submitted: u64,
    #[serde(default)]
    pub accepted: u64,
    #[serde(default)]
    pub rejected: u64,
    #[serde(default)]
    pub blocks: u64,
    #[serde(default)]
    pub jobs: u64,
    #[serde(default)]
    pub total_hashes: f64,
    #[serde(default)]
    pub pool: String,
    #[serde(default)]
    pub uptime_s: u64,
}

/// Combined device state (sent to frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopMinerDevice {
    pub mac: String,
    pub name: String,
    pub model: String,
    pub hostname: String,
    pub ip: String,
    pub fw: String,
    pub sdk: String,
    pub mining: bool,
    pub pool_connected: bool,
    pub authorized: bool,
    pub hashrate: f64,
    pub difficulty: f64,
    pub submitted: u64,
    pub accepted: u64,
    pub rejected: u64,
    pub blocks: u64,
    pub jobs: u64,
    pub total_hashes: f64,
    pub pool: String,
    pub uptime_s: u64,
    pub heap: u64,
    pub online: bool,
    pub consecutive_failures: u32,
}

pub struct PopMinerDevicesState {
    /// Devices the user has explicitly added (persisted to disk)
    pub saved: Mutex<HashMap<String, PopMinerDevice>>,
    /// Devices discovered via mDNS but not yet added (ephemeral)
    pub discovered: Mutex<HashMap<String, PopMinerDevice>>,
}

// ─── Persistence ─────────────────────────────────────────────────────────────

fn popminer_devices_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("popminer_devices.json")
}

/// Minimal struct for persistence — only identity fields, no live stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedDeviceEntry {
    pub mac: String,
    pub name: String,
    pub model: String,
    pub hostname: String,
    pub ip: String,
    pub fw: String,
}

pub fn load_saved_devices() -> HashMap<String, PopMinerDevice> {
    let path = popminer_devices_path();
    if !path.exists() {
        return HashMap::new();
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    let entries: Vec<SavedDeviceEntry> =
        serde_json::from_str(&content).unwrap_or_default();
    let mut map = HashMap::new();
    for e in entries {
        let device = PopMinerDevice {
            mac: e.mac.clone(),
            name: e.name,
            model: e.model,
            hostname: e.hostname,
            ip: e.ip,
            fw: e.fw,
            sdk: String::new(),
            mining: false,
            pool_connected: false,
            authorized: false,
            hashrate: 0.0,
            difficulty: 0.0,
            submitted: 0,
            accepted: 0,
            rejected: 0,
            blocks: 0,
            jobs: 0,
            total_hashes: 0.0,
            pool: String::new(),
            uptime_s: 0,
            heap: 0,
            online: false,
            consecutive_failures: 0,
        };
        map.insert(e.mac, device);
    }
    map
}

fn save_devices_to_disk(devices: &HashMap<String, PopMinerDevice>) {
    let path = popminer_devices_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let entries: Vec<SavedDeviceEntry> = devices
        .values()
        .map(|d| SavedDeviceEntry {
            mac: d.mac.clone(),
            name: d.name.clone(),
            model: d.model.clone(),
            hostname: d.hostname.clone(),
            ip: d.ip.clone(),
            fw: d.fw.clone(),
        })
        .collect();
    match serde_json::to_string_pretty(&entries) {
        Ok(content) => {
            if let Err(e) = fs::write(&path, content) {
                log::warn!("Failed to write popminer_devices.json: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize popminer devices: {}", e),
    }
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_popminer_devices(
    state: tauri::State<Arc<PopMinerDevicesState>>,
) -> Vec<PopMinerDevice> {
    let saved = state.saved.lock().unwrap();
    let mut result: Vec<PopMinerDevice> = saved.values().cloned().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

#[tauri::command]
pub fn get_discovered_popminer_devices(
    state: tauri::State<Arc<PopMinerDevicesState>>,
) -> Vec<PopMinerDevice> {
    let saved = state.saved.lock().unwrap();
    let discovered = state.discovered.lock().unwrap();
    discovered
        .values()
        .filter(|d| !saved.contains_key(&d.mac))
        .cloned()
        .collect()
}

#[tauri::command]
pub fn add_popminer_device(
    mac: String,
    state: tauri::State<Arc<PopMinerDevicesState>>,
) -> Result<Vec<PopMinerDevice>, String> {
    let discovered = state.discovered.lock().unwrap();
    let device = discovered
        .get(&mac)
        .cloned()
        .ok_or_else(|| format!("Device {} not found in discovered list", mac))?;
    drop(discovered);

    let mut saved = state.saved.lock().unwrap();
    saved.insert(mac.clone(), device);
    save_devices_to_disk(&saved);
    log::info!("PoPMiner: added device {} to saved list", mac);

    let mut result: Vec<PopMinerDevice> = saved.values().cloned().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

#[tauri::command]
pub fn remove_popminer_device(
    mac: String,
    state: tauri::State<Arc<PopMinerDevicesState>>,
) -> Result<Vec<PopMinerDevice>, String> {
    let mut saved = state.saved.lock().unwrap();
    saved.remove(&mac);
    save_devices_to_disk(&saved);
    log::info!("PoPMiner: removed device {} from saved list", mac);

    let mut result: Vec<PopMinerDevice> = saved.values().cloned().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

// ─── Discovery ───────────────────────────────────────────────────────────────

pub async fn start_popminer_discovery(
    app_handle: tauri::AppHandle,
    devices_state: Arc<PopMinerDevicesState>,
) {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            log::error!(
                "PoPMiner discovery: failed to create mDNS daemon: {}",
                e
            );
            return;
        }
    };

    let receiver = match daemon.browse(POPMINER_SERVICE) {
        Ok(r) => r,
        Err(e) => {
            log::error!(
                "PoPMiner discovery: failed to browse {}: {}",
                POPMINER_SERVICE,
                e
            );
            return;
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .expect("failed to build HTTP client");

    log::info!(
        "PoPMiner discovery: browsing for {} devices",
        POPMINER_SERVICE
    );

    // Track active polling tasks so we don't spawn duplicates.
    let polling_tasks: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // The flume receiver supports recv_async() which yields to the tokio
    // runtime instead of blocking the thread.
    loop {
        match receiver.recv_async().await {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let ip = info
                    .get_addresses()
                    .iter()
                    .find(|a| matches!(a, IpAddr::V4(_)))
                    .map(|a| a.to_string())
                    .unwrap_or_default();

                if ip.is_empty() {
                    log::warn!(
                        "PoPMiner discovery: resolved service with no IPv4 address"
                    );
                    continue;
                }

                let port = info.get_port();
                let hostname = info.get_hostname().trim_end_matches('.').to_string();
                let txt_name = info
                    .get_property_val_str("name")
                    .unwrap_or("PoPMiner")
                    .to_string();
                let txt_model = info
                    .get_property_val_str("model")
                    .unwrap_or("unknown")
                    .to_string();
                let txt_fw = info
                    .get_property_val_str("fw")
                    .unwrap_or("unknown")
                    .to_string();

                log::info!(
                    "PoPMiner discovery: found {} ({}) at {}:{}",
                    txt_name,
                    hostname,
                    ip,
                    port
                );

                // Fetch /api/info once
                let info_url = format!("http://{}:{}/api/info", ip, port);
                let device_info = match client.get(&info_url).send().await {
                    Ok(resp) => resp.json::<PopMinerInfo>().await.unwrap_or_default(),
                    Err(e) => {
                        log::warn!(
                            "PoPMiner discovery: failed to fetch info from {}: {}",
                            ip,
                            e
                        );
                        PopMinerInfo {
                            name: txt_name.clone(),
                            model: txt_model.clone(),
                            fw: txt_fw.clone(),
                            ip: ip.clone(),
                            host: hostname.clone(),
                            ..Default::default()
                        }
                    }
                };

                let mac = if device_info.mac.is_empty() {
                    // Fall back to hostname as key if no MAC
                    hostname.clone()
                } else {
                    device_info.mac.clone()
                };

                let device = PopMinerDevice {
                    mac: mac.clone(),
                    name: if device_info.name.is_empty() {
                        txt_name
                    } else {
                        device_info.name
                    },
                    model: if device_info.model.is_empty() {
                        txt_model
                    } else {
                        device_info.model
                    },
                    hostname: hostname.trim_end_matches(".local").to_string(),
                    ip: if device_info.ip.is_empty() {
                        ip.clone()
                    } else {
                        device_info.ip
                    },
                    fw: if device_info.fw.is_empty() {
                        txt_fw
                    } else {
                        device_info.fw
                    },
                    sdk: device_info.sdk,
                    mining: false,
                    pool_connected: false,
                    authorized: false,
                    hashrate: 0.0,
                    difficulty: 0.0,
                    submitted: 0,
                    accepted: 0,
                    rejected: 0,
                    blocks: 0,
                    jobs: 0,
                    total_hashes: 0.0,
                    pool: String::new(),
                    uptime_s: device_info.uptime_s,
                    heap: device_info.heap,
                    online: true,
                    consecutive_failures: 0,
                };

                // Insert into discovered map (always)
                {
                    let mut discovered = devices_state.discovered.lock().unwrap();
                    discovered.insert(mac.clone(), device.clone());
                }

                // If device is already in saved map, update its identity/online fields
                {
                    let mut saved = devices_state.saved.lock().unwrap();
                    if let Some(saved_dev) = saved.get_mut(&mac) {
                        saved_dev.name = device.name.clone();
                        saved_dev.model = device.model.clone();
                        saved_dev.hostname = device.hostname.clone();
                        saved_dev.ip = device.ip.clone();
                        saved_dev.fw = device.fw.clone();
                        saved_dev.sdk = device.sdk.clone();
                        saved_dev.online = true;
                        saved_dev.consecutive_failures = 0;
                        let updated = saved_dev.clone();
                        drop(saved);
                        let _ = app_handle.emit("popminer-device-stats", &updated);
                    }
                }

                // Spawn polling task if not already running
                let already_polling = {
                    let tasks = polling_tasks.lock().unwrap();
                    tasks.contains_key(&mac)
                };

                if !already_polling {
                    let poll_client = client.clone();
                    let poll_state = Arc::clone(&devices_state);
                    let poll_app = app_handle.clone();
                    let poll_mac = mac.clone();
                    let poll_ip = ip.clone();
                    let poll_port = port;
                    let poll_tasks_ref = Arc::clone(&polling_tasks);

                    let handle = tokio::spawn(async move {
                        let stats_url =
                            format!("http://{}:{}/api/stats", poll_ip, poll_port);
                        loop {
                            tokio::time::sleep(tokio::time::Duration::from_secs(5))
                                .await;

                            match poll_client.get(&stats_url).send().await {
                                Ok(resp) => {
                                    if let Ok(stats) =
                                        resp.json::<PopMinerStats>().await
                                    {
                                        // Update discovered map
                                        {
                                            let mut discovered =
                                                poll_state.discovered.lock().unwrap();
                                            if let Some(device) =
                                                discovered.get_mut(&poll_mac)
                                            {
                                                apply_stats(device, &stats);
                                            }
                                        }

                                        // Update saved map and emit event
                                        let mut saved =
                                            poll_state.saved.lock().unwrap();
                                        if let Some(device) =
                                            saved.get_mut(&poll_mac)
                                        {
                                            apply_stats(device, &stats);
                                            let updated = device.clone();
                                            drop(saved);
                                            let _ = poll_app.emit(
                                                "popminer-device-stats",
                                                &updated,
                                            );
                                        }
                                    }
                                }
                                Err(_) => {
                                    // Update failure count in discovered map
                                    {
                                        let mut discovered =
                                            poll_state.discovered.lock().unwrap();
                                        if let Some(device) =
                                            discovered.get_mut(&poll_mac)
                                        {
                                            device.consecutive_failures += 1;
                                            if device.consecutive_failures >= 3 {
                                                device.online = false;
                                            }
                                            if device.consecutive_failures >= 6 {
                                                discovered.remove(&poll_mac);
                                            }
                                        }
                                    }

                                    // Update failure count in saved map
                                    let mut saved =
                                        poll_state.saved.lock().unwrap();
                                    if let Some(device) =
                                        saved.get_mut(&poll_mac)
                                    {
                                        device.consecutive_failures += 1;
                                        let failures = device.consecutive_failures;

                                        if failures == 3 {
                                            device.online = false;
                                            let updated = device.clone();
                                            drop(saved);
                                            log::info!(
                                                "PoPMiner: {} marked offline after 3 failures",
                                                poll_mac
                                            );
                                            let _ = poll_app.emit(
                                                "popminer-device-stats",
                                                &updated,
                                            );
                                        } else if failures >= 6 {
                                            // Don't remove saved devices — keep them as offline.
                                            // Only remove the polling task.
                                            drop(saved);
                                            log::info!(
                                                "PoPMiner: {} stopping poll after {} consecutive failures (device stays saved)",
                                                poll_mac,
                                                failures
                                            );
                                            let mut tasks =
                                                poll_tasks_ref.lock().unwrap();
                                            tasks.remove(&poll_mac);
                                            return;
                                        }
                                    } else {
                                        // Device not in saved — check if discovered was cleaned
                                        let discovered =
                                            poll_state.discovered.lock().unwrap();
                                        if !discovered.contains_key(&poll_mac) {
                                            drop(discovered);
                                            let mut tasks =
                                                poll_tasks_ref.lock().unwrap();
                                            tasks.remove(&poll_mac);
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    });

                    let mut tasks = polling_tasks.lock().unwrap();
                    tasks.insert(mac, handle);
                }
            }
            Ok(ServiceEvent::ServiceRemoved(_, fullname)) => {
                log::info!(
                    "PoPMiner discovery: service removed: {}",
                    fullname
                );
                // Don't immediately remove — let the polling failure counter handle it
            }
            Ok(_) => {
                // SearchStarted, ServiceFound, SearchStopped — ignore
            }
            Err(e) => {
                log::warn!("PoPMiner discovery: recv error: {}", e);
                break;
            }
        }
    }
}

/// Apply stats from a poll response to a device.
fn apply_stats(device: &mut PopMinerDevice, stats: &PopMinerStats) {
    device.mining = stats.mining;
    device.pool_connected = stats.pool_connected;
    device.authorized = stats.authorized;
    device.hashrate = stats.hashrate;
    device.difficulty = stats.difficulty;
    device.submitted = stats.submitted;
    device.accepted = stats.accepted;
    device.rejected = stats.rejected;
    device.blocks = stats.blocks;
    device.jobs = stats.jobs;
    device.total_hashes = stats.total_hashes;
    device.pool = stats.pool.clone();
    device.uptime_s = stats.uptime_s;
    device.online = true;
    device.consecutive_failures = 0;
}
