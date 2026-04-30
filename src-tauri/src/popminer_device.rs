use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::Emitter;

const POPMINER_SERVICE: &str = "_popminer._tcp.local.";

/// Identity from GET /api/info (fetched once on discovery)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize)]
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
    pub devices: Mutex<HashMap<String, PopMinerDevice>>,
}

impl PopMinerDevicesState {
    pub fn new() -> Self {
        Self {
            devices: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub fn get_popminer_devices(
    state: tauri::State<Arc<PopMinerDevicesState>>,
) -> Vec<PopMinerDevice> {
    let devices = state.devices.lock().unwrap();
    let mut result: Vec<PopMinerDevice> = devices.values().cloned().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

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

                // Insert into state
                {
                    let mut devices = devices_state.devices.lock().unwrap();
                    devices.insert(mac.clone(), device.clone());
                }

                // Emit discovery event
                let _ = app_handle.emit("popminer-device-discovered", &device);

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
                                        let mut devices =
                                            poll_state.devices.lock().unwrap();
                                        if let Some(device) =
                                            devices.get_mut(&poll_mac)
                                        {
                                            device.mining = stats.mining;
                                            device.pool_connected =
                                                stats.pool_connected;
                                            device.authorized = stats.authorized;
                                            device.hashrate = stats.hashrate;
                                            device.difficulty = stats.difficulty;
                                            device.submitted = stats.submitted;
                                            device.accepted = stats.accepted;
                                            device.rejected = stats.rejected;
                                            device.blocks = stats.blocks;
                                            device.jobs = stats.jobs;
                                            device.total_hashes = stats.total_hashes;
                                            device.pool = stats.pool;
                                            device.uptime_s = stats.uptime_s;
                                            device.online = true;
                                            device.consecutive_failures = 0;
                                            let updated = device.clone();
                                            drop(devices);
                                            let _ = poll_app.emit(
                                                "popminer-device-stats",
                                                &updated,
                                            );
                                        }
                                    }
                                }
                                Err(_) => {
                                    let mut devices =
                                        poll_state.devices.lock().unwrap();
                                    if let Some(device) =
                                        devices.get_mut(&poll_mac)
                                    {
                                        device.consecutive_failures += 1;
                                        let failures = device.consecutive_failures;

                                        if failures >= 6 {
                                            let mac_clone = poll_mac.clone();
                                            devices.remove(&poll_mac);
                                            drop(devices);
                                            log::info!(
                                                "PoPMiner: {} removed after {} consecutive failures",
                                                mac_clone,
                                                failures
                                            );
                                            let _ = poll_app.emit(
                                                "popminer-device-lost",
                                                serde_json::json!({ "mac": mac_clone }),
                                            );
                                            // Remove self from polling tasks and exit
                                            let mut tasks =
                                                poll_tasks_ref.lock().unwrap();
                                            tasks.remove(&mac_clone);
                                            return;
                                        } else if failures == 3 {
                                            device.online = false;
                                            let updated = device.clone();
                                            drop(devices);
                                            log::info!(
                                                "PoPMiner: {} marked offline after 3 failures",
                                                poll_mac
                                            );
                                            let _ = poll_app.emit(
                                                "popminer-device-stats",
                                                &updated,
                                            );
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
