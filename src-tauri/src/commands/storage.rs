use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedMiner {
    pub ip: String,
    pub label: String,
    pub added_at: String,
    #[serde(default = "default_coin_id")]
    pub coin_id: String,
    #[serde(default = "default_wattage")]
    pub wattage: f64,
}

fn default_coin_id() -> String {
    "kaspa".to_string()
}

fn default_wattage() -> f64 { 100.0 }

fn config_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("miners.json")
}

fn load_miners() -> Vec<SavedMiner> {
    let path = config_path();
    if !path.exists() {
        return vec![];
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_miners(miners: &[SavedMiner]) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(miners).map_err(|e| {
        log::error!("Failed to serialize miners: {}", e);
        e.to_string()
    })?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    log::info!("Saved {} miner(s) to disk", miners.len());
    Ok(())
}

#[tauri::command]
pub fn get_saved_miners() -> Result<Vec<SavedMiner>, String> {
    Ok(load_miners())
}

#[tauri::command]
pub fn add_miner(ip: String, label: Option<String>, coin_id: Option<String>, wattage: Option<f64>) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    if miners.iter().any(|m| m.ip == ip) {
        return Ok(miners);
    }
    let label = label.unwrap_or_else(|| ip.clone());
    miners.push(SavedMiner {
        ip,
        label,
        added_at: Utc::now().to_rfc3339(),
        coin_id: coin_id.unwrap_or_else(|| "kaspa".to_string()),
        wattage: wattage.unwrap_or(100.0),
    });
    save_miners(&miners)?;
    Ok(miners)
}

#[tauri::command]
pub fn update_miner_wattage(ip: String, wattage: f64) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    if let Some(m) = miners.iter_mut().find(|m| m.ip == ip) {
        m.wattage = wattage;
    }
    save_miners(&miners)?;
    Ok(miners)
}

#[tauri::command]
pub fn remove_miner(ip: String) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    miners.retain(|m| m.ip != ip);
    save_miners(&miners)?;
    Ok(miners)
}

#[tauri::command]
pub fn update_miner_label(ip: String, label: String) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    if let Some(m) = miners.iter_mut().find(|m| m.ip == ip) {
        m.label = label;
    }
    save_miners(&miners)?;
    Ok(miners)
}

#[tauri::command]
pub fn import_from_scan(ips: Vec<String>, coin_id: Option<String>) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    let coin = coin_id.unwrap_or_else(|| "kaspa".to_string());
    for ip in ips {
        if !miners.iter().any(|m| m.ip == ip) {
            miners.push(SavedMiner {
                label: ip.clone(),
                ip,
                added_at: Utc::now().to_rfc3339(),
                coin_id: coin.clone(),
                wattage: 100.0,
            });
        }
    }
    save_miners(&miners)?;
    Ok(miners)
}
