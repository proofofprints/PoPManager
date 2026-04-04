use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedMiner {
    pub ip: String,
    pub label: String,
    pub added_at: String,
}

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
    let content = serde_json::to_string_pretty(miners).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_saved_miners() -> Result<Vec<SavedMiner>, String> {
    Ok(load_miners())
}

#[tauri::command]
pub fn add_miner(ip: String, label: Option<String>) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    if miners.iter().any(|m| m.ip == ip) {
        return Ok(miners);
    }
    let label = label.unwrap_or_else(|| ip.clone());
    miners.push(SavedMiner {
        ip,
        label,
        added_at: Utc::now().to_rfc3339(),
    });
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
pub fn import_from_scan(ips: Vec<String>) -> Result<Vec<SavedMiner>, String> {
    let mut miners = load_miners();
    for ip in ips {
        if !miners.iter().any(|m| m.ip == ip) {
            miners.push(SavedMiner {
                label: ip.clone(),
                ip,
                added_at: Utc::now().to_rfc3339(),
            });
        }
    }
    save_miners(&miners)?;
    Ok(miners)
}
