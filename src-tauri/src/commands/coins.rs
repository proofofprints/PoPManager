use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoinConfig {
    pub id: String,
    pub name: String,
    pub ticker: String,
    pub algorithm: String,
    pub coingecko_id: String,
    pub color: String,
    pub network_hashrate_url: String,
    pub network_hashrate_unit: String,
    pub block_reward_url: String,
    pub block_reward_divisor: f64,
    pub block_time_seconds: f64,
    pub default_hashrate_unit: String,
}

fn builtin_coins() -> Vec<CoinConfig> {
    vec![
        CoinConfig {
            id: "kaspa".to_string(),
            name: "Kaspa".to_string(),
            ticker: "KAS".to_string(),
            algorithm: "kHeavyHash".to_string(),
            coingecko_id: "kaspa".to_string(),
            color: "#49EACB".to_string(),
            network_hashrate_url: "https://api.kaspa.org/info/hashrate?stringOnly=false".to_string(),
            network_hashrate_unit: "TH/s".to_string(),
            block_reward_url: "https://api.kaspa.org/info/blockreward?stringOnly=false".to_string(),
            block_reward_divisor: 1.0,
            block_time_seconds: 1.0,
            default_hashrate_unit: "GH/s".to_string(),
        },
        CoinConfig {
            id: "bitcoin".to_string(),
            name: "Bitcoin".to_string(),
            ticker: "BTC".to_string(),
            algorithm: "SHA-256".to_string(),
            coingecko_id: "bitcoin".to_string(),
            color: "#F7931A".to_string(),
            network_hashrate_url: "https://blockchain.info/q/hashrate".to_string(),
            network_hashrate_unit: "GH/s".to_string(),
            block_reward_url: "https://blockchain.info/q/bcperblock".to_string(),
            block_reward_divisor: 1.0,
            block_time_seconds: 600.0,
            default_hashrate_unit: "TH/s".to_string(),
        },
    ]
}

fn user_coins_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("coins.json")
}

fn load_user_coins() -> Vec<CoinConfig> {
    let path = user_coins_path();
    if !path.exists() {
        return vec![];
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_user_coins(coins: &[CoinConfig]) -> Result<(), String> {
    let path = user_coins_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(coins).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_coins() -> Vec<CoinConfig> {
    let mut coins = builtin_coins();
    coins.extend(load_user_coins());
    coins
}

#[tauri::command]
pub fn add_coin(coin: CoinConfig) -> Result<Vec<CoinConfig>, String> {
    let builtins = builtin_coins();
    if builtins.iter().any(|c| c.id == coin.id) {
        return Err(format!("'{}' is a built-in coin and cannot be overridden", coin.id));
    }
    let mut user_coins = load_user_coins();
    if user_coins.iter().any(|c| c.id == coin.id) {
        return Err(format!("Coin with id '{}' already exists", coin.id));
    }
    user_coins.push(coin);
    save_user_coins(&user_coins)?;
    Ok(get_coins())
}

#[tauri::command]
pub fn remove_coin(id: String) -> Result<Vec<CoinConfig>, String> {
    let builtins = builtin_coins();
    if builtins.iter().any(|c| c.id == id) {
        return Err(format!("'{}' is a built-in coin and cannot be removed", id));
    }
    let mut user_coins = load_user_coins();
    user_coins.retain(|c| c.id != id);
    save_user_coins(&user_coins)?;
    Ok(get_coins())
}
