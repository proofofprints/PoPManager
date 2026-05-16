use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter};

use crate::cached_state::CachedFarmState;
use crate::commands::alerts::{self, AlertEvent, BoardSnapshot, MinerSnapshot, MobileMinerSnapshot};
use crate::commands::history::{self, CoinSnapshot, FarmSnapshot};
use crate::commands::miner::{self, MinerInfo};
use crate::commands::mobile_miner::MobileMinersState;
use crate::commands::pool_profiles::PoolProfile;
use crate::commands::storage::SavedMiner;
use crate::popminer_device::PopMinerDevicesState;

const ASIC_POLL_INTERVAL_SECS: u64 = 45;
const MOBILE_ALERT_INTERVAL_SECS: u64 = 10;
const SNAPSHOT_INTERVAL_SECS: u64 = 60;
// Delay first ASIC poll so the app finishes booting before we hammer the network.
const INITIAL_ASIC_DELAY_SECS: u64 = 5;
// Snapshot needs at least one ASIC poll cycle to have completed.
const INITIAL_SNAPSHOT_DELAY_SECS: u64 = 60;

/// Spawn all background polling tasks. Called once from the Tauri setup hook.
pub fn spawn_all(
    app: AppHandle,
    cache: Arc<CachedFarmState>,
    mobile_state: Arc<MobileMinersState>,
    popminer_state: Arc<PopMinerDevicesState>,
) {
    // Task 1: ASIC poller (45s + force-poll Notify)
    {
        let app = app.clone();
        let cache = Arc::clone(&cache);
        tauri::async_runtime::spawn(async move {
            asic_poll_loop(app, cache).await;
        });
    }

    // Task 2: Mobile alert evaluation (10s)
    {
        let app = app.clone();
        let mobile_state = Arc::clone(&mobile_state);
        tauri::async_runtime::spawn(async move {
            mobile_alert_loop(app, mobile_state).await;
        });
    }

    // Task 3: Farm snapshot builder (60s)
    {
        let app = app.clone();
        let cache = Arc::clone(&cache);
        let mobile_state = Arc::clone(&mobile_state);
        let _popminer_state = Arc::clone(&popminer_state);
        tauri::async_runtime::spawn(async move {
            snapshot_loop(app, cache, mobile_state).await;
        });
    }

    log::info!("Background poller: all tasks spawned");
}

// ─── ASIC poller ────────────────────────────────────────────────────────────

async fn asic_poll_loop(app: AppHandle, cache: Arc<CachedFarmState>) {
    log::info!("Background poller: ASIC task starting (initial delay {}s)", INITIAL_ASIC_DELAY_SECS);
    tokio::time::sleep(Duration::from_secs(INITIAL_ASIC_DELAY_SECS)).await;

    let force_poll = Arc::clone(&cache.force_poll);

    loop {
        let cycle_start = std::time::Instant::now();
        run_asic_poll_cycle(&app, &cache).await;
        let elapsed = cycle_start.elapsed();
        log::debug!("Background poller: ASIC cycle took {:?}", elapsed);

        // Wait for either the regular interval or a force-poll signal.
        let wait = Duration::from_secs(ASIC_POLL_INTERVAL_SECS).saturating_sub(elapsed);
        tokio::select! {
            _ = tokio::time::sleep(wait) => {},
            _ = force_poll.notified() => {
                log::info!("Background poller: ASIC poll triggered by force_poll");
            }
        }
    }
}

async fn run_asic_poll_cycle(app: &AppHandle, cache: &Arc<CachedFarmState>) {
    let saved = match crate::commands::storage::get_saved_miners() {
        Ok(v) => v,
        Err(e) => {
            log::warn!("ASIC poll: failed to load saved miners: {}", e);
            return;
        }
    };

    if saved.is_empty() {
        // Clear any stale cache entries from before the user removed miners,
        // then bump the timestamp so the UI shows "polled, nothing to do".
        cache.asic_miners.lock().unwrap().clear();
        *cache.last_asic_poll_ms.lock().unwrap() = Utc::now().timestamp_millis();
        let _ = app.emit("farm-state-updated", ());
        return;
    }

    log::debug!("ASIC poll: fetching {} miner(s)", saved.len());

    // Fan out HTTP polls. Each runs concurrently with its own per-IP timeout
    // (already configured inside fetch_*_info).
    let mut join_set = tokio::task::JoinSet::new();
    for s in &saved {
        let ip = s.ip.clone();
        let manufacturer = if s.manufacturer.is_empty() {
            None
        } else {
            Some(s.manufacturer.clone())
        };
        let s_clone = s.clone();
        join_set.spawn(async move {
            let res = miner::get_miner_status(ip.clone(), manufacturer).await;
            (s_clone, res)
        });
    }

    let mut data: Vec<MinerInfo> = Vec::with_capacity(saved.len());
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((s, Ok(info))) => {
                // Backfill manufacturer for legacy entries that lacked the
                // field — saves a full auto-detect (3 HTTP attempts) on every
                // future poll cycle for this miner.
                if s.manufacturer.is_empty() && !info.manufacturer.is_empty() {
                    match crate::commands::storage::update_miner_manufacturer(
                        &s.ip,
                        &info.manufacturer,
                    ) {
                        Ok(()) => log::info!(
                            "Backfilled manufacturer for {}: {}",
                            s.ip,
                            info.manufacturer
                        ),
                        Err(e) => log::warn!(
                            "Failed to backfill manufacturer for {}: {}",
                            s.ip,
                            e
                        ),
                    }
                }
                data.push(info);
            }
            Ok((s, Err(e))) => {
                log::debug!("ASIC poll: {} unreachable — {}", s.ip, e);
                data.push(offline_placeholder(&s));
            }
            Err(e) => {
                log::warn!("ASIC poll: task panicked: {}", e);
            }
        }
    }

    let online = data.iter().filter(|m| m.online).count();
    log::info!("ASIC poll cycle complete: {}/{} online", online, data.len());

    // Update cache
    {
        let mut slot = cache.asic_miners.lock().unwrap();
        *slot = data.clone();
    }
    *cache.last_asic_poll_ms.lock().unwrap() = Utc::now().timestamp_millis();

    // Record uptime + evaluate alerts.
    record_uptime(app, &data).await;
    evaluate_asic_alerts(app, &data, &saved).await;

    let _ = app.emit("farm-state-updated", ());
}

fn offline_placeholder(saved: &SavedMiner) -> MinerInfo {
    MinerInfo {
        ip: saved.ip.clone(),
        hostname: saved.label.clone(),
        mac: String::new(),
        model: "Unknown".to_string(),
        status: "offline".to_string(),
        firmware: String::new(),
        software: String::new(),
        online: false,
        rt_hashrate: 0.0,
        avg_hashrate: 0.0,
        hashrate_unit: "G".to_string(),
        runtime: "--".to_string(),
        runtime_secs: 0,
        fans: vec![],
        boards: vec![],
        pools: vec![],
        hashrate_history: vec![],
        health: crate::commands::miner::HealthState {
            power: false,
            network: false,
            fan: false,
            temp: false,
        },
        last_seen: Utc::now().to_rfc3339(),
        default_wattage: saved.wattage,
        manufacturer: saved.manufacturer.clone(),
        hw_errors: 0,
    }
}

async fn record_uptime(app: &AppHandle, miners: &[MinerInfo]) {
    for m in miners {
        if let Err(e) = crate::commands::uptime::record_uptime(
            app.clone(),
            m.ip.clone(),
            m.status == "online",
        )
        .await
        {
            log::debug!("record_uptime failed for {}: {}", m.ip, e);
        }
    }
}

async fn evaluate_asic_alerts(app: &AppHandle, miners: &[MinerInfo], saved: &[SavedMiner]) {
    let snapshots: Vec<MinerSnapshot> = miners
        .iter()
        .map(|m| MinerSnapshot {
            ip: m.ip.clone(),
            label: display_name(m, saved),
            online: m.online,
            rt_hashrate: m.rt_hashrate,
            boards: m
                .boards
                .iter()
                .map(|b| BoardSnapshot {
                    in_tmp: b.in_tmp,
                    out_tmp: b.out_tmp,
                })
                .collect(),
            accepted_shares: m.pools.iter().map(|p| p.accepted as f64).sum(),
        })
        .collect();

    match alerts::check_alerts(app.clone(), snapshots) {
        Ok(triggered) => dispatch_notifications(app, &triggered).await,
        Err(e) => log::warn!("ASIC alert eval failed: {}", e),
    }
}

fn display_name(m: &MinerInfo, saved: &[SavedMiner]) -> String {
    if let Some(s) = saved.iter().find(|s| s.ip == m.ip) {
        if !s.label.is_empty() && s.label != m.ip {
            return s.label.clone();
        }
    }
    if let Some(active) = m.pools.iter().find(|p| p.connect) {
        if let Some(dot) = active.user.rfind('.') {
            if dot < active.user.len() - 1 {
                return active.user[dot + 1..].to_string();
            }
        }
    }
    if !m.hostname.is_empty() {
        m.hostname.clone()
    } else {
        m.ip.clone()
    }
}

// ─── Mobile alert task ──────────────────────────────────────────────────────

async fn mobile_alert_loop(app: AppHandle, mobile_state: Arc<MobileMinersState>) {
    log::info!("Background poller: mobile alert task starting");
    let mut ticker = tokio::time::interval(Duration::from_secs(MOBILE_ALERT_INTERVAL_SECS));
    // First tick fires immediately; skip it to avoid running before app is fully up.
    ticker.tick().await;

    loop {
        ticker.tick().await;

        let miners: Vec<MobileMinerSnapshot> = {
            let map = mobile_state.miners.lock().unwrap();
            map.values()
                .map(|m| MobileMinerSnapshot {
                    device_id: m.device_id.clone(),
                    name: m.name.clone(),
                    is_online: m.is_online,
                    battery_level: m.battery_level as f64,
                    battery_charging: m.battery_charging,
                    cpu_temp: m.cpu_temp,
                    throttle_state: m.throttle_state.clone(),
                })
                .collect()
        };

        if miners.is_empty() {
            // No mobile miners → ASIC's 45s emit + snapshot's 60s emit cover
            // any UI staleness. Skip emit to avoid forcing Dashboard re-renders
            // every 10s on installations that have no mobile miners (common).
            continue;
        }

        match alerts::check_mobile_alerts(app.clone(), miners) {
            Ok(triggered) => dispatch_notifications(&app, &triggered).await,
            Err(e) => log::warn!("Mobile alert eval failed: {}", e),
        }

        // Tick the UI on the mobile cadence so MobileMinerList sees fresh
        // data without running its own setInterval.
        let _ = app.emit("farm-state-updated", ());
    }
}

// ─── Snapshot task ──────────────────────────────────────────────────────────

async fn snapshot_loop(
    app: AppHandle,
    cache: Arc<CachedFarmState>,
    mobile_state: Arc<MobileMinersState>,
) {
    log::info!(
        "Background poller: snapshot task starting (initial delay {}s)",
        INITIAL_SNAPSHOT_DELAY_SECS
    );
    tokio::time::sleep(Duration::from_secs(INITIAL_SNAPSHOT_DELAY_SECS)).await;

    // Use sleep-after-work rather than tokio::time::interval — interval's first
    // tick resolves immediately, which would cause two snapshots in rapid
    // succession on startup before settling into the 60s cadence.
    loop {
        build_and_persist_snapshot(&app, &cache, &mobile_state).await;
        tokio::time::sleep(Duration::from_secs(SNAPSHOT_INTERVAL_SECS)).await;
    }
}

async fn build_and_persist_snapshot(
    app: &AppHandle,
    cache: &Arc<CachedFarmState>,
    mobile_state: &Arc<MobileMinersState>,
) {
    let asic = cache.asic_miners.lock().unwrap().clone();
    let saved_miners = crate::commands::storage::get_saved_miners().unwrap_or_default();
    let pool_profiles =
        crate::commands::pool_profiles::get_saved_pools().unwrap_or_default();

    let mobile_miners: Vec<_> = {
        let map = mobile_state.miners.lock().unwrap();
        map.values().cloned().collect()
    };

    // Aggregate by coin: ASIC hashrate in its native unit, mobile in H/s (kept
    // separate because the unit differs). The existing schema stores hashrate
    // as f64 in the unit reported by ASIC miners (typically GH/s); we keep
    // that contract and convert mobile H/s → GH/s for the coin totals.
    let mut coin_data: HashMap<String, CoinSnapshot> = HashMap::new();

    let mut total_hashrate = 0.0f64;
    let mut online_count = 0u32;

    for m in &asic {
        if !m.online {
            continue;
        }
        online_count += 1;
        total_hashrate += m.rt_hashrate;

        let active_pool_addr = m
            .pools
            .iter()
            .find(|p| p.connect || p.state == 1)
            .map(|p| p.addr.as_str());
        let saved = saved_miners.iter().find(|s| s.ip == m.ip);
        let coin_id = resolve_coin_id(active_pool_addr, &pool_profiles, saved.map(|s| s.coin_id.as_str()));

        let entry = coin_data.entry(coin_id).or_insert(CoinSnapshot {
            hashrate: 0.0,
            miner_count: 0,
            daily_earnings_coins: 0.0,
            daily_earnings_fiat: 0.0,
        });
        entry.hashrate += m.rt_hashrate;
        entry.miner_count += 1;
    }

    // Mobile: convert H/s → GH/s before merging into the per-coin total to
    // match the ASIC unit. This mirrors the Dashboard's existing behavior
    // (`mobileHashrateHs / 1e9`).
    for mm in &mobile_miners {
        if !mm.is_online {
            continue;
        }
        let coin_id = ticker_to_coin_id(&mm.coin);
        let entry = coin_data.entry(coin_id).or_insert(CoinSnapshot {
            hashrate: 0.0,
            miner_count: 0,
            daily_earnings_coins: 0.0,
            daily_earnings_fiat: 0.0,
        });
        entry.hashrate += mm.hashrate_hs / 1e9;
        entry.miner_count += 1;
        // Note: mobile miners don't add to total_hashrate (kept in ASIC unit
        // for the top-line chart, again matching existing Dashboard logic).
    }

    let total_miners = asic.len() as u32;

    let snapshot = FarmSnapshot {
        timestamp: Utc::now().timestamp(),
        total_hashrate,
        online_count,
        total_miners,
        coin_data,
    };

    // Persist to history.json + push to cloud queue (existing wiring).
    if let Err(e) = history::add_farm_snapshot(app.clone(), snapshot.clone()).await {
        log::warn!("Snapshot persist failed: {}", e);
    }

    {
        let mut slot = cache.farm_snapshot.lock().unwrap();
        *slot = Some(snapshot);
    }
    *cache.last_snapshot_ms.lock().unwrap() = Utc::now().timestamp_millis();

    let _ = app.emit("farm-state-updated", ());
}

// ─── Helpers shared across tasks ────────────────────────────────────────────

/// Send desktop notifications and emails for any alerts that fired this cycle.
async fn dispatch_notifications(app: &AppHandle, triggered: &[AlertEvent]) {
    if triggered.is_empty() {
        return;
    }

    for event in triggered {
        if event.notify_desktop {
            if let Err(e) = crate::commands::notifications::send_desktop_notification(
                app.clone(),
                format!("Alert: {}", event.rule_name),
                format!("{}: {}", event.miner_label, event.message),
            ) {
                log::warn!("Desktop notification failed: {}", e);
            }
        }

        if event.notify_email {
            let subject = format!("PoPManager Alert: {}", event.rule_name);
            let body = format!(
                "Miner: {} ({})\n\n{}\n\nTime: {}",
                event.miner_label, event.miner_ip, event.message, event.timestamp
            );
            if let Err(e) = crate::commands::email::send_alert_email(subject, body).await {
                log::debug!("Alert email failed (SMTP may not be configured): {}", e);
            }
        }
    }

    let _ = app.emit("alerts-updated", ());
}

/// Port of `src/utils/coinLookup.ts::getMinerCoinId`. Matches the active
/// pool address against saved pool profiles' pool1addr (by hostname). Falls
/// back to the saved miner's coin_id, treating "other" (legacy default) as
/// "kaspa".
fn resolve_coin_id(
    miner_pool_addr: Option<&str>,
    profiles: &[PoolProfile],
    saved_coin_id: Option<&str>,
) -> String {
    if let Some(addr) = miner_pool_addr {
        let miner_host = extract_hostname(addr);
        if !miner_host.is_empty() {
            for p in profiles {
                let profile_host = extract_hostname(&p.pool1addr);
                if !profile_host.is_empty() && profile_host == miner_host {
                    if !p.coin_id.is_empty() {
                        return p.coin_id.clone();
                    }
                }
            }
        }
    }
    let fallback = saved_coin_id.unwrap_or("other");
    if fallback == "other" {
        "kaspa".to_string()
    } else {
        fallback.to_string()
    }
}

fn extract_hostname(addr: &str) -> String {
    if addr.is_empty() {
        return String::new();
    }
    // Strip protocol prefix
    let s = if let Some(idx) = addr.find("://") {
        &addr[idx + 3..]
    } else {
        addr
    };
    // Strip port and path
    let s = s.split('/').next().unwrap_or(s);
    let s = s.split(':').next().unwrap_or(s);
    s.to_string()
}

fn ticker_to_coin_id(ticker: &str) -> String {
    if ticker.is_empty() {
        return "kaspa".to_string();
    }
    match ticker.to_uppercase().as_str() {
        "KAS" => "kaspa".to_string(),
        "BTC" => "bitcoin".to_string(),
        other => other.to_lowercase(),
    }
}
