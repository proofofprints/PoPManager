use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolProfile {
    pub id: String,
    pub name: String,
    pub pool1addr: String,
    pub pool1miner: String,
    pub pool1pwd: String,
    pub pool2addr: String,
    pub pool2miner: String,
    pub pool2pwd: String,
    pub pool3addr: String,
    pub pool3miner: String,
    pub pool3pwd: String,
    #[serde(default = "default_pool_fee")]
    pub fee_percent: f64,
    #[serde(default = "default_coin_id")]
    pub coin_id: String,
}

fn default_pool_fee() -> f64 { 1.0 }
fn default_coin_id() -> String { String::from("kaspa") }

fn profiles_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("pool_profiles.json")
}

fn load_profiles() -> Vec<PoolProfile> {
    let path = profiles_path();
    if !path.exists() {
        return vec![];
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_profiles(profiles: &[PoolProfile]) -> Result<(), String> {
    let path = profiles_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(profiles).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_saved_pools() -> Result<Vec<PoolProfile>, String> {
    Ok(load_profiles())
}

#[tauri::command]
pub fn add_pool_profile(
    name: String,
    pool1addr: String,
    pool1miner: String,
    pool1pwd: String,
    pool2addr: String,
    pool2miner: String,
    pool2pwd: String,
    pool3addr: String,
    pool3miner: String,
    pool3pwd: String,
    fee_percent: f64,
    coin_id: String,
) -> Result<Vec<PoolProfile>, String> {
    let mut profiles = load_profiles();
    let id = format!("{:x}", Utc::now().timestamp_millis());
    profiles.push(PoolProfile {
        id,
        name,
        pool1addr,
        pool1miner,
        pool1pwd,
        pool2addr,
        pool2miner,
        pool2pwd,
        pool3addr,
        pool3miner,
        pool3pwd,
        fee_percent,
        coin_id,
    });
    save_profiles(&profiles)?;
    Ok(profiles)
}

#[tauri::command]
pub fn update_pool_profile(
    id: String,
    name: String,
    pool1addr: String,
    pool1miner: String,
    pool1pwd: String,
    pool2addr: String,
    pool2miner: String,
    pool2pwd: String,
    pool3addr: String,
    pool3miner: String,
    pool3pwd: String,
    fee_percent: f64,
    coin_id: String,
) -> Result<Vec<PoolProfile>, String> {
    let mut profiles = load_profiles();
    if let Some(p) = profiles.iter_mut().find(|p| p.id == id) {
        p.name = name;
        p.pool1addr = pool1addr;
        p.pool1miner = pool1miner;
        p.pool1pwd = pool1pwd;
        p.pool2addr = pool2addr;
        p.pool2miner = pool2miner;
        p.pool2pwd = pool2pwd;
        p.pool3addr = pool3addr;
        p.pool3miner = pool3miner;
        p.pool3pwd = pool3pwd;
        p.fee_percent = fee_percent;
        p.coin_id = coin_id;
    }
    save_profiles(&profiles)?;
    Ok(profiles)
}

#[tauri::command]
pub fn remove_pool_profile(id: String) -> Result<Vec<PoolProfile>, String> {
    let mut profiles = load_profiles();
    profiles.retain(|p| p.id != id);
    save_profiles(&profiles)?;
    Ok(profiles)
}
