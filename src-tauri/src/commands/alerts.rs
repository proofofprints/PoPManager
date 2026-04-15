use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RuleType {
    HashrateDrop,
    TempAbove,
    MinerOffline,
    NoShares,
    // Mobile-specific rule types
    MobileBatteryLow,
    MobileCpuTempAbove,
    MobileThrottle,
    MobileOffline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRule {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub rule_type: RuleType,
    pub threshold: f64,
    pub applies_to: Vec<String>,
    pub notify_desktop: bool,
    pub notify_email: bool,
    pub cooldown_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvent {
    pub id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub miner_ip: String,
    pub miner_label: String,
    pub message: String,
    pub timestamp: String,
    pub acknowledged: bool,
    pub notify_desktop: bool,
    pub notify_email: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerSnapshot {
    pub ip: String,
    pub label: String,
    pub online: bool,
    pub rt_hashrate: f64,
    pub boards: Vec<BoardSnapshot>,
    #[serde(default)]
    pub accepted_shares: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub in_tmp: f64,
    pub out_tmp: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMinerSnapshot {
    pub device_id: String,
    pub name: String,
    pub is_online: bool,
    #[serde(default)]
    pub battery_level: f64,
    #[serde(default)]
    pub battery_charging: bool,
    #[serde(default)]
    pub cpu_temp: f64,
    #[serde(default)]
    pub throttle_state: String,
}

fn is_mobile_rule(rt: &RuleType) -> bool {
    matches!(
        rt,
        RuleType::MobileBatteryLow
            | RuleType::MobileCpuTempAbove
            | RuleType::MobileThrottle
            | RuleType::MobileOffline
    )
}

static COOLDOWNS: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);
static OFFLINE_COUNTS: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);
// Maps miner IP → (last_accepted_count, last_change_instant)
static SHARE_TRACKER: Mutex<Option<HashMap<String, (f64, Instant)>>> = Mutex::new(None);
// Startup grace period — alerts are suppressed for the first N seconds after
// the process starts so that stateful checks (NoShares, MinerOffline, etc.)
// have time to warm up from a cold boot. Prevents alert storms when PoPManager
// is restarted while miners are running normally.
static STARTUP_INSTANT: Mutex<Option<Instant>> = Mutex::new(None);
const STARTUP_GRACE_SECONDS: u64 = 300; // 5 minutes

fn within_startup_grace() -> (bool, u64) {
    let mut guard = match STARTUP_INSTANT.lock() {
        Ok(g) => g,
        Err(_) => return (false, 0),
    };
    let startup = *guard.get_or_insert_with(Instant::now);
    let elapsed = Instant::now().duration_since(startup).as_secs();
    (elapsed < STARTUP_GRACE_SECONDS, STARTUP_GRACE_SECONDS.saturating_sub(elapsed))
}

fn rules_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("alert_rules.json")
}

fn history_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("alert_history.json")
}

fn load_rules() -> Vec<AlertRule> {
    let path = rules_path();
    if !path.exists() {
        return vec![];
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_rules(rules: &[AlertRule]) -> Result<(), String> {
    let path = rules_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(rules).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

fn load_history() -> Vec<AlertEvent> {
    let path = history_path();
    if !path.exists() {
        return vec![];
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_history(events: &[AlertEvent]) -> Result<(), String> {
    let path = history_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(events).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

fn default_rules() -> Vec<AlertRule> {
    let now_hex = format!("{:x}", Utc::now().timestamp_millis());
    vec![
        AlertRule {
            id: format!("{}-1", now_hex),
            name: "Miner Offline".to_string(),
            enabled: true,
            rule_type: RuleType::MinerOffline,
            threshold: 2.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: true,
            cooldown_minutes: 15,
        },
        AlertRule {
            id: format!("{}-2", now_hex),
            name: "High Temperature".to_string(),
            enabled: true,
            rule_type: RuleType::TempAbove,
            threshold: 80.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: true,
            cooldown_minutes: 30,
        },
        AlertRule {
            id: format!("{}-3", now_hex),
            name: "Low Hashrate".to_string(),
            enabled: true,
            rule_type: RuleType::HashrateDrop,
            threshold: 50.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: false,
            cooldown_minutes: 15,
        },
        AlertRule {
            id: format!("{}-4", now_hex),
            name: "No Shares (30min)".to_string(),
            enabled: true,
            rule_type: RuleType::NoShares,
            threshold: 30.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: true,
            cooldown_minutes: 30,
        },
        AlertRule {
            id: format!("{}-5", now_hex),
            name: "Mobile Battery Low".to_string(),
            enabled: true,
            rule_type: RuleType::MobileBatteryLow,
            threshold: 20.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: true,
            cooldown_minutes: 30,
        },
        AlertRule {
            id: format!("{}-6", now_hex),
            name: "Mobile Thermal Throttle".to_string(),
            enabled: true,
            rule_type: RuleType::MobileThrottle,
            threshold: 0.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: false,
            cooldown_minutes: 15,
        },
        AlertRule {
            id: format!("{}-7", now_hex),
            name: "Mobile CPU Hot".to_string(),
            enabled: true,
            rule_type: RuleType::MobileCpuTempAbove,
            threshold: 65.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: true,
            cooldown_minutes: 30,
        },
        AlertRule {
            id: format!("{}-8", now_hex),
            name: "Mobile Miner Offline".to_string(),
            enabled: true,
            rule_type: RuleType::MobileOffline,
            threshold: 2.0,
            applies_to: vec![],
            notify_desktop: true,
            notify_email: true,
            cooldown_minutes: 15,
        },
    ]
}

#[tauri::command]
pub fn get_alert_rules() -> Result<Vec<AlertRule>, String> {
    let path = rules_path();
    // Auto-create defaults on first launch
    if !path.exists() {
        let defaults = default_rules();
        save_rules(&defaults)?;
        return Ok(defaults);
    }
    let rules = load_rules();
    if rules.is_empty() {
        let defaults = default_rules();
        save_rules(&defaults)?;
        return Ok(defaults);
    }
    Ok(rules)
}

#[tauri::command]
pub fn add_alert_rule(rule: AlertRule) -> Result<Vec<AlertRule>, String> {
    let mut rules = load_rules();
    let new_rule = AlertRule {
        id: format!("{:x}", Utc::now().timestamp_millis()),
        ..rule
    };
    rules.push(new_rule);
    save_rules(&rules)?;
    Ok(rules)
}

#[tauri::command]
pub fn update_alert_rule(rule: AlertRule) -> Result<Vec<AlertRule>, String> {
    let mut rules = load_rules();
    if let Some(r) = rules.iter_mut().find(|r| r.id == rule.id) {
        *r = rule;
    }
    save_rules(&rules)?;
    Ok(rules)
}

#[tauri::command]
pub fn remove_alert_rule(id: String) -> Result<Vec<AlertRule>, String> {
    let mut rules = load_rules();
    rules.retain(|r| r.id != id);
    save_rules(&rules)?;
    Ok(rules)
}

#[tauri::command]
pub fn get_alert_history() -> Result<Vec<AlertEvent>, String> {
    Ok(load_history())
}

#[tauri::command]
pub fn clear_alert_history() -> Result<(), String> {
    save_history(&[])
}

#[tauri::command]
pub fn acknowledge_alert(id: String) -> Result<(), String> {
    let mut history = load_history();
    if let Some(e) = history.iter_mut().find(|e| e.id == id) {
        e.acknowledged = true;
    }
    save_history(&history)
}

#[tauri::command]
pub fn check_alerts(miners: Vec<MinerSnapshot>) -> Result<Vec<AlertEvent>, String> {
    let rules = load_rules();
    let now = Utc::now();
    let now_ts = now.timestamp();
    let now_instant = Instant::now();

    let mut cooldowns_guard = COOLDOWNS.lock().map_err(|e| e.to_string())?;
    let cooldowns = cooldowns_guard.get_or_insert_with(HashMap::new);

    let mut offline_guard = OFFLINE_COUNTS.lock().map_err(|e| e.to_string())?;
    let offline_counts = offline_guard.get_or_insert_with(HashMap::new);

    let mut share_guard = SHARE_TRACKER.lock().map_err(|e| e.to_string())?;
    let share_tracker = share_guard.get_or_insert_with(HashMap::new);

    for miner in &miners {
        let count = offline_counts.entry(miner.ip.clone()).or_insert(0);
        if miner.online {
            *count = 0;
        } else {
            *count += 1;
        }

        // Update share tracker
        if miner.online {
            let entry = share_tracker.entry(miner.ip.clone()).or_insert((miner.accepted_shares, now_instant));
            if miner.accepted_shares != entry.0 {
                // Shares changed — either increased (normal mining) or decreased
                // (miner restarted, counter reset to 0). Either way, reset the
                // timer. Only fire NoShares when the count is truly stuck.
                *entry = (miner.accepted_shares, now_instant);
            }
        }
    }

    // Startup grace period — trackers have been updated above, but we
    // suppress alert evaluation so stateful rules (NoShares, MinerOffline)
    // don't fire against a cold-boot baseline.
    let (in_grace, remaining) = within_startup_grace();
    if in_grace {
        log::debug!(
            "ASIC alert evaluation suppressed during startup grace period ({}s remaining, {} miners tracked)",
            remaining,
            miners.len()
        );
        return Ok(vec![]);
    }

    let mut triggered: Vec<AlertEvent> = Vec::new();
    let mut idx: u32 = 0;

    for rule in &rules {
        if !rule.enabled {
            continue;
        }
        // Skip mobile rule types — handled by check_mobile_alerts
        if is_mobile_rule(&rule.rule_type) {
            continue;
        }

        for miner in &miners {
            if !rule.applies_to.is_empty() && !rule.applies_to.contains(&miner.ip) {
                continue;
            }

            let cooldown_key = format!("{}:{}", rule.id, miner.ip);
            if let Some(&last_ts) = cooldowns.get(&cooldown_key) {
                let elapsed_mins = (now_ts - last_ts) / 60;
                if elapsed_mins < rule.cooldown_minutes as i64 {
                    continue;
                }
            }

            let message = match rule.rule_type {
                RuleType::HashrateDrop => {
                    if miner.online && miner.rt_hashrate < rule.threshold {
                        Some(format!(
                            "Hashrate dropped to {:.1} GH/s (threshold: {:.1} GH/s)",
                            miner.rt_hashrate, rule.threshold
                        ))
                    } else {
                        None
                    }
                }
                RuleType::TempAbove => {
                    let max_temp = miner
                        .boards
                        .iter()
                        .map(|b| b.in_tmp.max(b.out_tmp))
                        .fold(0.0f64, f64::max);
                    if miner.online && max_temp > rule.threshold {
                        Some(format!(
                            "Temperature {:.1}°C exceeds threshold {:.1}°C",
                            max_temp, rule.threshold
                        ))
                    } else {
                        None
                    }
                }
                RuleType::MinerOffline => {
                    let count = offline_counts.get(&miner.ip).copied().unwrap_or(0);
                    if count >= rule.threshold as u32 {
                        Some(format!(
                            "Miner offline for {} consecutive poll(s)",
                            count
                        ))
                    } else {
                        None
                    }
                }
                RuleType::NoShares => {
                    if !miner.online {
                        None
                    } else if let Some(&(_, last_change)) = share_tracker.get(&miner.ip) {
                        let elapsed_mins = now_instant.duration_since(last_change).as_secs_f64() / 60.0;
                        if elapsed_mins >= rule.threshold {
                            Some(format!(
                                "No new shares for {:.0} minutes (threshold: {:.0} min)",
                                elapsed_mins, rule.threshold
                            ))
                        } else {
                            None
                        }
                    } else {
                        // First time we see this miner — initialize tracker, don't fire
                        None
                    }
                }
                // Mobile rule types handled by check_mobile_alerts (already filtered above)
                RuleType::MobileBatteryLow
                | RuleType::MobileCpuTempAbove
                | RuleType::MobileThrottle
                | RuleType::MobileOffline => None,
            };

            if let Some(msg) = message {
                log::info!("Alert triggered: rule='{}' miner={} — {}", rule.name, miner.ip, msg);
                cooldowns.insert(cooldown_key, now_ts);
                idx += 1;
                let event = AlertEvent {
                    id: format!("{:x}-{}", now_ts, idx),
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    miner_ip: miner.ip.clone(),
                    miner_label: miner.label.clone(),
                    message: msg,
                    timestamp: now.to_rfc3339(),
                    acknowledged: false,
                    notify_desktop: rule.notify_desktop,
                    notify_email: rule.notify_email,
                };
                triggered.push(event);
            }
        }
    }

    if !triggered.is_empty() {
        let mut history = load_history();
        for e in &triggered {
            history.push(e.clone());
        }
        if history.len() > 100 {
            let start = history.len() - 100;
            history = history[start..].to_vec();
        }
        save_history(&history)?;
    }

    Ok(triggered)
}

#[tauri::command]
pub fn check_mobile_alerts(miners: Vec<MobileMinerSnapshot>) -> Result<Vec<AlertEvent>, String> {
    let rules = load_rules();
    let now = Utc::now();
    let now_ts = now.timestamp();

    let mut cooldowns_guard = COOLDOWNS.lock().map_err(|e| e.to_string())?;
    let cooldowns = cooldowns_guard.get_or_insert_with(HashMap::new);

    let mut offline_guard = OFFLINE_COUNTS.lock().map_err(|e| e.to_string())?;
    let offline_counts = offline_guard.get_or_insert_with(HashMap::new);

    for miner in &miners {
        let count = offline_counts.entry(miner.device_id.clone()).or_insert(0);
        if miner.is_online {
            *count = 0;
        } else {
            *count += 1;
        }
    }

    // Startup grace period — same rationale as check_alerts. Trackers are
    // updated above so counters warm up, but alert evaluation is suppressed.
    let (in_grace, remaining) = within_startup_grace();
    if in_grace {
        log::debug!(
            "Mobile alert evaluation suppressed during startup grace period ({}s remaining, {} devices tracked)",
            remaining,
            miners.len()
        );
        return Ok(vec![]);
    }

    let mut triggered: Vec<AlertEvent> = Vec::new();
    let mut idx: u32 = 0;

    for rule in &rules {
        if !rule.enabled {
            continue;
        }
        if !is_mobile_rule(&rule.rule_type) {
            continue;
        }

        for miner in &miners {
            if !rule.applies_to.is_empty() && !rule.applies_to.contains(&miner.device_id) {
                continue;
            }

            let cooldown_key = format!("{}:{}", rule.id, miner.device_id);
            if let Some(&last_ts) = cooldowns.get(&cooldown_key) {
                let elapsed_mins = (now_ts - last_ts) / 60;
                if elapsed_mins < rule.cooldown_minutes as i64 {
                    continue;
                }
            }

            let message = match rule.rule_type {
                RuleType::MobileBatteryLow => {
                    if miner.is_online
                        && !miner.battery_charging
                        && miner.battery_level > 0.0
                        && miner.battery_level < rule.threshold
                    {
                        Some(format!(
                            "Battery at {:.0}% (threshold: {:.0}%)",
                            miner.battery_level, rule.threshold
                        ))
                    } else {
                        None
                    }
                }
                RuleType::MobileCpuTempAbove => {
                    if miner.is_online && miner.cpu_temp > rule.threshold {
                        Some(format!(
                            "CPU temperature {:.1}°C exceeds threshold {:.1}°C",
                            miner.cpu_temp, rule.threshold
                        ))
                    } else {
                        None
                    }
                }
                RuleType::MobileThrottle => {
                    if miner.is_online
                        && (miner.throttle_state == "severe"
                            || miner.throttle_state == "critical"
                            || miner.throttle_state == "moderate")
                    {
                        Some(format!("Thermal throttling: {}", miner.throttle_state))
                    } else {
                        None
                    }
                }
                RuleType::MobileOffline => {
                    let count = offline_counts.get(&miner.device_id).copied().unwrap_or(0);
                    if count >= rule.threshold as u32 {
                        Some(format!(
                            "Mobile miner offline for {} consecutive poll(s)",
                            count
                        ))
                    } else {
                        None
                    }
                }
                // ASIC rule types — never reached due to is_mobile_rule guard
                RuleType::HashrateDrop
                | RuleType::TempAbove
                | RuleType::MinerOffline
                | RuleType::NoShares => None,
            };

            if let Some(msg) = message {
                log::info!(
                    "Mobile alert triggered: rule='{}' device={} — {}",
                    rule.name,
                    miner.device_id,
                    msg
                );
                cooldowns.insert(cooldown_key, now_ts);
                idx += 1;
                let event = AlertEvent {
                    id: format!("{:x}-m{}", now_ts, idx),
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    miner_ip: miner.device_id.clone(),
                    miner_label: miner.name.clone(),
                    message: msg,
                    timestamp: now.to_rfc3339(),
                    acknowledged: false,
                    notify_desktop: rule.notify_desktop,
                    notify_email: rule.notify_email,
                };
                triggered.push(event);
            }
        }
    }

    if !triggered.is_empty() {
        let mut history = load_history();
        for e in &triggered {
            history.push(e.clone());
        }
        if history.len() > 100 {
            let start = history.len() - 100;
            history = history[start..].to_vec();
        }
        save_history(&history)?;
    }

    Ok(triggered)
}
