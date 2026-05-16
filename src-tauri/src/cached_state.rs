use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::Notify;

use crate::commands::history::FarmSnapshot;
use crate::commands::miner::MinerInfo;
use crate::commands::mobile_miner::{MobileMiner, MobileMinersState};
use crate::popminer_device::{PopMinerDevice, PopMinerDevicesState};

/// Always-on cache populated by the background poller. The frontend reads
/// from here on mount and listens for `farm-state-updated` events to stay
/// in sync. Frontend pages no longer poll directly.
pub struct CachedFarmState {
    pub asic_miners: Mutex<Vec<MinerInfo>>,
    pub farm_snapshot: Mutex<Option<FarmSnapshot>>,
    pub last_asic_poll_ms: Mutex<i64>,
    pub last_snapshot_ms: Mutex<i64>,
    /// Signals the ASIC poll task to run immediately (e.g. user pressed Refresh).
    pub force_poll: Arc<Notify>,
}

impl CachedFarmState {
    pub fn new() -> Self {
        CachedFarmState {
            asic_miners: Mutex::new(Vec::new()),
            farm_snapshot: Mutex::new(None),
            last_asic_poll_ms: Mutex::new(0),
            last_snapshot_ms: Mutex::new(0),
            force_poll: Arc::new(Notify::new()),
        }
    }
}

/// Convenience bundle returned by `get_cached_farm_state` so the Dashboard
/// can hydrate everything in a single round-trip on mount.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CachedFarmStateResponse {
    pub asic_miners: Vec<MinerInfo>,
    pub mobile_miners: Vec<MobileMiner>,
    pub popminer_devices: Vec<PopMinerDevice>,
    pub farm_snapshot: Option<FarmSnapshot>,
    pub last_asic_poll_ms: i64,
    pub last_snapshot_ms: i64,
}

#[tauri::command]
pub fn get_cached_asic_miners(
    state: tauri::State<Arc<CachedFarmState>>,
) -> Vec<MinerInfo> {
    state.asic_miners.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_cached_farm_state(
    cache: tauri::State<Arc<CachedFarmState>>,
    mobile: tauri::State<Arc<MobileMinersState>>,
    popminer: tauri::State<Arc<PopMinerDevicesState>>,
) -> CachedFarmStateResponse {
    let asic_miners = cache.asic_miners.lock().unwrap().clone();
    let farm_snapshot = cache.farm_snapshot.lock().unwrap().clone();
    let last_asic_poll_ms = *cache.last_asic_poll_ms.lock().unwrap();
    let last_snapshot_ms = *cache.last_snapshot_ms.lock().unwrap();

    let mobile_miners: Vec<MobileMiner> = {
        let map = mobile.miners.lock().unwrap();
        let mut v: Vec<MobileMiner> = map.values().cloned().collect();
        v.sort_by(|a, b| b.last_report_timestamp.cmp(&a.last_report_timestamp));
        v
    };

    let popminer_devices: Vec<PopMinerDevice> = {
        let saved = popminer.saved.lock().unwrap();
        let mut v: Vec<PopMinerDevice> = saved.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    };

    CachedFarmStateResponse {
        asic_miners,
        mobile_miners,
        popminer_devices,
        farm_snapshot,
        last_asic_poll_ms,
        last_snapshot_ms,
    }
}

#[tauri::command]
pub fn get_last_poll_time(
    state: tauri::State<Arc<CachedFarmState>>,
) -> i64 {
    *state.last_asic_poll_ms.lock().unwrap()
}

/// Signal the ASIC poller to run immediately. Returns once the notification
/// is sent — the actual poll happens asynchronously and emits
/// `farm-state-updated` when it completes.
#[tauri::command]
pub fn force_poll_asic(
    state: tauri::State<Arc<CachedFarmState>>,
) -> Result<(), String> {
    state.force_poll.notify_one();
    Ok(())
}

/// Refresh a single miner without waiting for the full farm cycle. Used by
/// the MinerDetail page. Updates the cache entry for this IP in place and
/// emits `farm-state-updated`.
#[tauri::command]
pub async fn force_poll_single_miner(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<CachedFarmState>>,
    ip: String,
    manufacturer: Option<String>,
) -> Result<MinerInfo, String> {
    // If the caller passed nothing (or an empty string), we'll auto-detect
    // inside get_miner_status. Capture whether we auto-detected so we can
    // backfill the saved manufacturer for future cycles.
    let auto_detected = manufacturer
        .as_deref()
        .map(|s| s.is_empty())
        .unwrap_or(true);

    let info = crate::commands::miner::get_miner_status(ip.clone(), manufacturer).await?;

    if auto_detected && !info.manufacturer.is_empty() {
        if let Err(e) = crate::commands::storage::update_miner_manufacturer(&ip, &info.manufacturer)
        {
            log::warn!("Failed to backfill manufacturer for {}: {}", ip, e);
        }
    }

    {
        let mut miners = state.asic_miners.lock().unwrap();
        if let Some(slot) = miners.iter_mut().find(|m| m.ip == ip) {
            *slot = info.clone();
        } else {
            miners.push(info.clone());
        }
    }

    let _ = app.emit("farm-state-updated", ());
    Ok(info)
}
