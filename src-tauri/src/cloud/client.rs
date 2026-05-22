use reqwest::Client;
use serde::{Deserialize, Serialize};

// The cloud API runs at cloud-api.proofofprints.com. The bare `cloud.`
// subdomain now hosts the web portal (Cloudflare static assets) and will
// return 405 Method Not Allowed for any POST that hits it. Don't put the
// portal URL here — it's a different host with no API routes.
const CLOUD_API_URL: &str = "https://cloud-api.proofofprints.com";

fn api_url(path: &str) -> String {
    format!("{}{}", CLOUD_API_URL, path)
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(format!("PoPManager/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

// --- Response types ----------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub token: String,
    pub refresh_token: String,
    pub user: UserInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub name: String,
    pub plan: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub token: String,
    pub refresh_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    pub id: String,
    pub api_key: String,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
}

/// Wrapper for GET /instances response: { "instances": [...] }
#[derive(Debug, Deserialize)]
pub struct InstancesListResponse {
    #[serde(default)]
    pub instances: Vec<InstanceInfo>,
}

/// Wrapper for POST /instances response: { "instance": {...} }
#[derive(Debug, Deserialize)]
pub struct InstanceCreateResponse {
    pub instance: InstanceInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponse {
    pub ok: bool,
    #[serde(default)]
    pub message: Option<String>,
}

// --- Auth endpoints ----------------------------------------------------------

pub async fn login(email: &str, password: &str) -> Result<LoginResponse, String> {
    let client = http_client()?;
    let resp = client
        .post(api_url("/api/v1/auth/login"))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Login failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Login failed ({}): {}", status, body));
    }

    resp.json::<LoginResponse>()
        .await
        .map_err(|e| format!("Failed to parse login response: {}", e))
}

pub async fn refresh_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client = http_client()?;
    let resp = client
        .post(api_url("/api/v1/auth/refresh"))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Token refresh failed ({})", status));
    }

    resp.json::<TokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))
}

// --- Instance endpoints ------------------------------------------------------

pub async fn create_or_get_instance(jwt: &str) -> Result<InstanceInfo, String> {
    let client = http_client()?;

    // First try to get existing instances
    let resp = client
        .get(api_url("/api/v1/instances"))
        .bearer_auth(jwt)
        .send()
        .await
        .map_err(|e| format!("Failed to get instances: {}", e))?;

    if resp.status().is_success() {
        let wrapper: InstancesListResponse = resp.json().await.unwrap_or(InstancesListResponse { instances: vec![] });
        if let Some(inst) = wrapper.instances.into_iter().next() {
            log::info!("Cloud: using existing instance '{}'", inst.name);
            return Ok(inst);
        }
    }

    // No existing instance -- create one
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "My Farm".to_string());

    let resp = client
        .post(api_url("/api/v1/instances"))
        .bearer_auth(jwt)
        .json(&serde_json::json!({ "name": hostname }))
        .send()
        .await
        .map_err(|e| format!("Failed to create instance: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Failed to create instance ({}): {}", status, body));
    }

    let wrapper: InstanceCreateResponse = resp.json().await
        .map_err(|e| format!("Failed to parse instance response: {}", e))?;
    let inst = wrapper.instance;

    log::info!("Cloud: created new instance '{}'", inst.name);
    Ok(inst)
}

pub async fn update_instance_name(jwt: &str, instance_id: &str, name: &str) -> Result<(), String> {
    let client = http_client()?;
    let resp = client
        .patch(api_url(&format!("/api/v1/instances/{}", instance_id)))
        .bearer_auth(jwt)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| format!("Failed to update instance: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Failed to update instance ({})", status));
    }

    Ok(())
}

// --- Ingest endpoints --------------------------------------------------------

pub async fn push_snapshot(api_key: &str, payload: &serde_json::Value) -> Result<(), String> {
    let client = http_client()?;
    let resp = client
        .post(api_url("/api/v1/ingest/snapshot"))
        .header("X-API-Key", api_key)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("Snapshot push failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Snapshot push failed ({}): {}", status, body));
    }

    Ok(())
}

pub async fn push_alert(api_key: &str, payload: &serde_json::Value) -> Result<(), String> {
    let client = http_client()?;
    let resp = client
        .post(api_url("/api/v1/ingest/alert"))
        .header("X-API-Key", api_key)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("Alert push failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Alert push failed ({}): {}", status, body));
    }

    Ok(())
}

pub async fn push_miners(api_key: &str, payload: &serde_json::Value) -> Result<(), String> {
    let client = http_client()?;
    let resp = client
        .post(api_url("/api/v1/ingest/miners"))
        .header("X-API-Key", api_key)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("Miner state push failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Miner state push failed ({}): {}", status, body));
    }

    Ok(())
}
