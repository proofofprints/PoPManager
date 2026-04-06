use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use super::coins::get_coins;

const CACHE_TTL: Duration = Duration::from_secs(60);
const BLOCKS_PER_SECOND: f64 = 1.0;

struct PriceCache {
    price: f64,
    currency: String,
    fetched_at: Instant,
}

struct NetworkStatsCache {
    hashrate: f64,
    block_reward: f64,
    fetched_at: Instant,
}

static PRICE_CACHE: Mutex<Option<PriceCache>> = Mutex::new(None);
static NETWORK_STATS_CACHE: Mutex<Option<NetworkStatsCache>> = Mutex::new(None);
static COIN_PRICE_CACHE: Mutex<Option<HashMap<String, PriceCache>>> = Mutex::new(None);
static COIN_STATS_CACHE: Mutex<Option<HashMap<String, NetworkStatsCache>>> = Mutex::new(None);

#[derive(Serialize, Deserialize)]
pub struct KasPrice {
    pub price: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    pub network_hashrate: f64,
    pub block_reward: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarningsEstimate {
    pub daily_kas: f64,
    pub weekly_kas: f64,
    pub monthly_kas: f64,
    pub daily_usd: f64,
    pub weekly_usd: f64,
    pub monthly_usd: f64,
    pub kas_price: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoinNetworkStats {
    pub network_hashrate_ths: f64,
    pub block_reward: f64,
    pub block_time_seconds: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoinEarnings {
    pub daily_coins: f64,
    pub monthly_coins: f64,
    pub daily_fiat: f64,
    pub monthly_fiat: f64,
    pub coin_price: f64,
}

#[derive(Deserialize)]
struct CoinGeckoResponse {
    kaspa: serde_json::Value,
}

fn make_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("PoPManager/0.1.0")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

#[tauri::command]
pub async fn get_kas_price(currency: String) -> Result<KasPrice, String> {
    let currency = currency.to_lowercase();
    {
        let cache = PRICE_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref cached) = *cache {
            if cached.currency == currency && cached.fetched_at.elapsed() < CACHE_TTL {
                return Ok(KasPrice { price: cached.price });
            }
        }
    }

    let client = make_client()?;
    let url = format!(
        "https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies={}",
        currency
    );
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch KAS price: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        log::warn!("CoinGecko returned HTTP {} for currency={}", status, currency);
        return Err(format!(
            "CoinGecko returned HTTP {}: {}",
            status,
            &body[..body.len().min(200)]
        ));
    }

    let data: CoinGeckoResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse KAS price response: {}", e))?;

    let price = data.kaspa[&currency]
        .as_f64()
        .ok_or_else(|| format!("Missing '{}' field in CoinGecko response", currency))?;

    {
        let mut cache = PRICE_CACHE.lock().map_err(|e| e.to_string())?;
        *cache = Some(PriceCache {
            price,
            currency: currency.clone(),
            fetched_at: Instant::now(),
        });
    }

    log::info!("KAS price fetched: {} {}", price, currency);
    Ok(KasPrice { price })
}

#[tauri::command]
pub async fn get_network_stats() -> Result<NetworkStats, String> {
    {
        let cache = NETWORK_STATS_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref cached) = *cache {
            if cached.fetched_at.elapsed() < CACHE_TTL {
                return Ok(NetworkStats {
                    network_hashrate: cached.hashrate,
                    block_reward: cached.block_reward,
                });
            }
        }
    }

    let client = make_client()?;

    let hashrate_resp = client
        .get("https://api.kaspa.org/info/hashrate?stringOnly=false")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch network hashrate: {}", e))?;

    let status = hashrate_resp.status();
    if !status.is_success() {
        let body = hashrate_resp.text().await.unwrap_or_default();
        log::warn!("kaspa.org hashrate returned HTTP {}", status);
        return Err(format!(
            "kaspa.org hashrate returned HTTP {}: {}",
            status,
            &body[..body.len().min(200)]
        ));
    }

    let hashrate_val: serde_json::Value = hashrate_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse hashrate response: {}", e))?;

    let network_hashrate = hashrate_val["hashrate"]
        .as_f64()
        .ok_or_else(|| format!("Missing 'hashrate' field in response: {}", hashrate_val))?;

    let reward_resp = client
        .get("https://api.kaspa.org/info/blockreward?stringOnly=false")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch block reward: {}", e))?;

    let status = reward_resp.status();
    if !status.is_success() {
        let body = reward_resp.text().await.unwrap_or_default();
        log::warn!("kaspa.org blockreward returned HTTP {}", status);
        return Err(format!(
            "kaspa.org blockreward returned HTTP {}: {}",
            status,
            &body[..body.len().min(200)]
        ));
    }

    let reward_val: serde_json::Value = reward_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse block reward response: {}", e))?;

    let block_reward = reward_val["blockreward"]
        .as_f64()
        .ok_or_else(|| format!("Missing 'blockreward' field in response: {}", reward_val))?;

    {
        let mut cache = NETWORK_STATS_CACHE.lock().map_err(|e| e.to_string())?;
        *cache = Some(NetworkStatsCache {
            hashrate: network_hashrate,
            block_reward,
            fetched_at: Instant::now(),
        });
    }

    log::info!("Network stats fetched: hashrate={:.4e} TH/s block_reward={:.4} KAS", network_hashrate, block_reward);
    Ok(NetworkStats {
        network_hashrate,
        block_reward,
    })
}

#[tauri::command]
pub async fn calculate_earnings(
    hashrate: f64,
    pool_fee_percent: f64,
    currency: String,
) -> Result<EarningsEstimate, String> {
    let price = get_kas_price(currency).await?;
    let stats = get_network_stats().await?;

    let network_hashrate_hs = stats.network_hashrate * 1_000_000_000_000.0;
    let miner_hashrate_hs = hashrate * 1_000_000_000.0;

    log::info!(
        "Earnings calc: miner={:.2} GH/s network={:.4e} TH/s block_reward={:.4} KAS price={:.6}",
        hashrate, stats.network_hashrate, stats.block_reward, price.price
    );

    let daily_kas = (miner_hashrate_hs / network_hashrate_hs)
        * stats.block_reward
        * BLOCKS_PER_SECOND
        * 86400.0
        * (1.0 - pool_fee_percent / 100.0);

    let weekly_kas = daily_kas * 7.0;
    let monthly_kas = daily_kas * 30.0;
    let kas_price = price.price;
    let daily_usd = daily_kas * kas_price;
    let weekly_usd = weekly_kas * kas_price;
    let monthly_usd = monthly_kas * kas_price;

    Ok(EarningsEstimate {
        daily_kas,
        weekly_kas,
        monthly_kas,
        daily_usd,
        weekly_usd,
        monthly_usd,
        kas_price,
    })
}

// ---- Generic multi-coin helpers ----

/// Convert a value in the given unit to TH/s.
fn to_ths(value: f64, unit: &str) -> f64 {
    match unit {
        "GH/s" => value / 1_000.0,
        "TH/s" => value,
        "PH/s" => value * 1_000.0,
        "EH/s" => value * 1_000_000.0,
        "H/s"  => value / 1_000_000_000_000.0,
        _      => value,
    }
}

/// Try to extract a f64 from either plain text or a single-key JSON object.
fn extract_number(text: &str) -> Result<f64, String> {
    let trimmed = text.trim();
    if let Ok(v) = trimmed.parse::<f64>() {
        return Ok(v);
    }
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(obj) = val.as_object() {
            for (_, v) in obj {
                if let Some(n) = v.as_f64() {
                    return Ok(n);
                }
            }
        }
        if let Some(n) = val.as_f64() {
            return Ok(n);
        }
    }
    Err(format!("Cannot parse response as a number: '{}'", &trimmed[..trimmed.len().min(80)]))
}

/// Generic price fetch for any CoinGecko coin id.
#[tauri::command]
pub async fn get_coin_price(coingecko_id: String, currency: String) -> Result<f64, String> {
    let currency = currency.to_lowercase();
    let cache_key = format!("{}:{}", coingecko_id, currency);

    {
        let cache = COIN_PRICE_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref map) = *cache {
            if let Some(cached) = map.get(&cache_key) {
                if cached.currency == currency && cached.fetched_at.elapsed() < CACHE_TTL {
                    return Ok(cached.price);
                }
            }
        }
    }

    let client = make_client()?;
    let url = format!(
        "https://api.coingecko.com/api/v3/simple/price?ids={}&vs_currencies={}",
        coingecko_id, currency
    );
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {} price: {}", coingecko_id, e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        log::warn!("CoinGecko returned HTTP {} for {}/{}", status, coingecko_id, currency);
        return Err(format!(
            "CoinGecko returned HTTP {}: {}",
            status,
            &body[..body.len().min(200)]
        ));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse {} price response: {}", coingecko_id, e))?;

    let price = data[&coingecko_id][&currency]
        .as_f64()
        .ok_or_else(|| format!("Missing price for {}/{} in CoinGecko response", coingecko_id, currency))?;

    {
        let mut cache = COIN_PRICE_CACHE.lock().map_err(|e| e.to_string())?;
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(cache_key, PriceCache {
            price,
            currency: currency.clone(),
            fetched_at: Instant::now(),
        });
    }

    log::info!("{} price fetched: {} {}", coingecko_id, price, currency);
    Ok(price)
}

/// Generic network stats fetch for any configured coin.
#[tauri::command]
pub async fn get_coin_network_stats(coin_id: String) -> Result<CoinNetworkStats, String> {
    let coins = get_coins();
    let block_time_seconds = coins.iter()
        .find(|c| c.id == coin_id)
        .map(|c| c.block_time_seconds)
        .unwrap_or(1.0);

    {
        let cache = COIN_STATS_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref map) = *cache {
            if let Some(cached) = map.get(&coin_id) {
                if cached.fetched_at.elapsed() < CACHE_TTL {
                    return Ok(CoinNetworkStats {
                        network_hashrate_ths: cached.hashrate,
                        block_reward: cached.block_reward,
                        block_time_seconds,
                    });
                }
            }
        }
    }
    let coin = coins.iter().find(|c| c.id == coin_id)
        .ok_or_else(|| format!("Unknown coin: {}", coin_id))?;

    let client = make_client()?;

    // Fetch network hashrate
    let hashrate_resp = client
        .get(&coin.network_hashrate_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {} network hashrate: {}", coin_id, e))?;

    let status = hashrate_resp.status();
    if !status.is_success() {
        let body = hashrate_resp.text().await.unwrap_or_default();
        log::warn!("{} hashrate API returned HTTP {}", coin_id, status);
        return Err(format!(
            "{} hashrate API returned HTTP {}: {}",
            coin_id, status, &body[..body.len().min(200)]
        ));
    }

    let hashrate_text = hashrate_resp.text().await
        .map_err(|e| format!("Failed to read {} hashrate response: {}", coin_id, e))?;
    let raw_hashrate = extract_number(&hashrate_text)
        .map_err(|e| format!("{} hashrate parse error: {}", coin_id, e))?;
    let network_hashrate_ths = to_ths(raw_hashrate, &coin.network_hashrate_unit);

    // Fetch block reward
    let reward_resp = client
        .get(&coin.block_reward_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {} block reward: {}", coin_id, e))?;

    let status = reward_resp.status();
    if !status.is_success() {
        let body = reward_resp.text().await.unwrap_or_default();
        log::warn!("{} block reward API returned HTTP {}", coin_id, status);
        return Err(format!(
            "{} block reward API returned HTTP {}: {}",
            coin_id, status, &body[..body.len().min(200)]
        ));
    }

    let reward_text = reward_resp.text().await
        .map_err(|e| format!("Failed to read {} block reward response: {}", coin_id, e))?;
    let raw_reward = extract_number(&reward_text)
        .map_err(|e| format!("{} block reward parse error: {}", coin_id, e))?;
    let block_reward = raw_reward / coin.block_reward_divisor;

    {
        let mut cache = COIN_STATS_CACHE.lock().map_err(|e| e.to_string())?;
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(coin_id.clone(), NetworkStatsCache {
            hashrate: network_hashrate_ths,
            block_reward,
            fetched_at: Instant::now(),
        });
    }

    log::info!(
        "{} network stats: hashrate={:.4e} TH/s block_reward={:.8} block_time={}s",
        coin_id, network_hashrate_ths, block_reward, coin.block_time_seconds
    );

    Ok(CoinNetworkStats {
        network_hashrate_ths,
        block_reward,
        block_time_seconds: coin.block_time_seconds,
    })
}

/// Generic earnings calculation for any configured coin.
/// `hashrate_ghs` is in the coin's `default_hashrate_unit` (e.g. GH/s for KAS, TH/s for BTC).
#[tauri::command]
pub async fn calculate_coin_earnings(
    coin_id: String,
    hashrate_ghs: f64,
    pool_fee_percent: f64,
    currency: String,
) -> Result<CoinEarnings, String> {
    let coins = get_coins();
    let coin = coins.iter().find(|c| c.id == coin_id)
        .ok_or_else(|| format!("Unknown coin: {}", coin_id))?
        .clone();

    let stats = get_coin_network_stats(coin_id.clone()).await?;
    let coin_price = get_coin_price(coin.coingecko_id.clone(), currency).await?;

    // Convert miner hashrate from coin's default unit to TH/s
    let miner_hashrate_ths = to_ths(hashrate_ghs, &coin.default_hashrate_unit);

    let blocks_per_day = 86400.0 / stats.block_time_seconds;
    let daily_coins = (miner_hashrate_ths / stats.network_hashrate_ths)
        * stats.block_reward
        * blocks_per_day
        * (1.0 - pool_fee_percent / 100.0);
    let monthly_coins = daily_coins * 30.0;
    let daily_fiat = daily_coins * coin_price;
    let monthly_fiat = monthly_coins * coin_price;

    log::info!(
        "{} earnings: miner={:.4} TH/s network={:.4e} TH/s blocks_per_day={:.1} reward={:.8} price={:.6} → {:.8} coins/day",
        coin_id, miner_hashrate_ths, stats.network_hashrate_ths, blocks_per_day, stats.block_reward, coin_price, daily_coins
    );

    Ok(CoinEarnings {
        daily_coins,
        monthly_coins,
        daily_fiat,
        monthly_fiat,
        coin_price,
    })
}
