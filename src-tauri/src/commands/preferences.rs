use serde::{Deserialize, Serialize};
use tauri::Manager;
use super::tray::TrayState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub currency: String,
    pub pool_fee_percent: f64,
    #[serde(default = "default_electricity_cost")]
    pub electricity_cost_per_kwh: f64,
    #[serde(default = "default_miner_wattage")]
    pub miner_wattage: f64,
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default = "default_minimize_to_tray")]
    pub minimize_to_tray: bool,
}

fn default_electricity_cost() -> f64 { 0.10 }
fn default_miner_wattage() -> f64 { 100.0 }
fn default_log_level() -> String { "info".to_string() }
fn default_minimize_to_tray() -> bool { true }

impl Default for AppPreferences {
    fn default() -> Self {
        AppPreferences {
            currency: "usd".to_string(),
            pool_fee_percent: 1.0,
            electricity_cost_per_kwh: 0.10,
            miner_wattage: 100.0,
            log_level: "info".to_string(),
            minimize_to_tray: true,
        }
    }
}

fn prefs_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("preferences.json"))
}

/// Synchronous preferences load for use during app setup (before async runtime is available).
pub fn load_prefs_sync(app: &tauri::AppHandle) -> AppPreferences {
    let Ok(path) = prefs_path(app) else {
        return AppPreferences::default();
    };
    if !path.exists() {
        return AppPreferences::default();
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        return AppPreferences::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

#[tauri::command]
pub async fn get_preferences(app: tauri::AppHandle) -> Result<AppPreferences, String> {
    let path = prefs_path(&app)?;
    if !path.exists() {
        return Ok(AppPreferences::default());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read preferences: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse preferences: {}", e))
}

#[tauri::command]
pub async fn save_preferences(
    app: tauri::AppHandle,
    prefs: AppPreferences,
) -> Result<(), String> {
    let path = prefs_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&prefs)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write preferences: {}", e))?;

    // Sync minimize_to_tray into managed state so the close handler sees the new value immediately.
    if let Some(tray_state) = app.try_state::<TrayState>() {
        if let Ok(mut guard) = tray_state.minimize_to_tray.lock() {
            *guard = prefs.minimize_to_tray;
        }
    }

    log::info!(
        "Preferences saved (currency={}, log_level={}, minimize_to_tray={})",
        prefs.currency,
        prefs.log_level,
        prefs.minimize_to_tray,
    );
    Ok(())
}

#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    let filter = match level.to_lowercase().as_str() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        _ => return Err(format!("Invalid log level '{}'; expected error/warn/info/debug", level)),
    };
    log::set_max_level(filter);
    log::info!("Log level changed to {}", level);
    Ok(())
}
