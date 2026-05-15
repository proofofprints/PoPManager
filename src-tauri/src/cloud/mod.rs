use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub mod auth;
pub mod client;
pub mod command_exec;
pub mod queue;
pub mod sync;
pub mod ws;

/// Current sync connection status (sent to frontend)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CloudSyncStatus {
    Disconnected,
    Connecting,
    Connected,
    Syncing,
    Error(String),
    AuthRequired,
}

/// Cloud sync state managed by Tauri
pub struct CloudState {
    pub status: Mutex<CloudSyncStatus>,
    pub email: Mutex<Option<String>>,
    pub instance_name: Mutex<Option<String>>,
    pub instance_id: Mutex<Option<String>>,
    pub api_key: Mutex<Option<String>>,
    pub last_sync: Mutex<Option<i64>>,  // unix timestamp ms
    pub queue_size: Mutex<u64>,         // number of pending items
    pub latest_snapshot: Mutex<Option<serde_json::Value>>,
}

impl CloudState {
    pub fn new() -> Self {
        CloudState {
            status: Mutex::new(CloudSyncStatus::Disconnected),
            email: Mutex::new(None),
            instance_name: Mutex::new(None),
            instance_id: Mutex::new(None),
            api_key: Mutex::new(None),
            last_sync: Mutex::new(None),
            queue_size: Mutex::new(0),
            latest_snapshot: Mutex::new(None),
        }
    }
}

/// Response shape for cloud_status Tauri command
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatusResponse {
    pub connected: bool,
    pub status: String,
    pub email: Option<String>,
    pub instance_name: Option<String>,
    pub instance_id: Option<String>,
    pub last_sync: Option<i64>,
    pub queue_size: u64,
}

// --- Tauri Commands -----------------------------------------------------------

#[tauri::command]
pub async fn cloud_login(
    app: tauri::AppHandle,
    email: String,
    password: String,
    state: tauri::State<'_, Arc<CloudState>>,
) -> Result<CloudStatusResponse, String> {
    // 1. Call POST /api/v1/auth/login
    let login_resp = client::login(&email, &password).await?;

    // 2. Create instance (or use existing)
    let instance = client::create_or_get_instance(&login_resp.token).await?;

    // 3. Store credentials in OS keychain
    auth::store_api_key(&instance.api_key)?;
    auth::store_refresh_token(&login_resp.refresh_token)?;
    auth::store_email(&email)?;
    auth::store_instance_id(&instance.id)?;
    auth::store_instance_name(&instance.name)?;

    // 4. Update state
    {
        *state.status.lock().unwrap() = CloudSyncStatus::Connected;
        *state.email.lock().unwrap() = Some(email.clone());
        *state.instance_name.lock().unwrap() = Some(instance.name.clone());
        *state.instance_id.lock().unwrap() = Some(instance.id.clone());
        *state.api_key.lock().unwrap() = Some(instance.api_key.clone());
    }

    log::info!("Cloud: logged in as {} (instance: {})", email, instance.name);

    // 5. Immediately enqueue the latest snapshot so the sync loop picks it up
    //    within 60 seconds instead of waiting for the next poll cycle (~3.75 min)
    let history_path = app.path().app_data_dir()
        .map(|d| d.join("history.json"))
        .unwrap_or_default();
    if let Ok(history_json) = std::fs::read_to_string(&history_path) {
        if let Ok(snapshots) = serde_json::from_str::<Vec<serde_json::Value>>(&history_json) {
            if let Some(latest) = snapshots.last() {
                *state.latest_snapshot.lock().unwrap() = Some(latest.clone());
                if let Err(e) = queue::enqueue("snapshot", latest) {
                    log::warn!("Cloud: failed to enqueue initial snapshot: {}", e);
                } else {
                    log::info!("Cloud: initial snapshot enqueued for immediate sync");
                }
            }
        }
    }

    Ok(cloud_status_from_state(&state))
}

#[tauri::command]
pub async fn cloud_logout(
    state: tauri::State<'_, Arc<CloudState>>,
) -> Result<(), String> {
    // Clear keychain
    let _ = auth::clear_all();

    // Clear state
    *state.status.lock().unwrap() = CloudSyncStatus::Disconnected;
    *state.email.lock().unwrap() = None;
    *state.instance_name.lock().unwrap() = None;
    *state.instance_id.lock().unwrap() = None;
    *state.api_key.lock().unwrap() = None;
    *state.last_sync.lock().unwrap() = None;
    *state.queue_size.lock().unwrap() = 0;

    // Delete queue database
    let _ = queue::delete_queue_db();

    log::info!("Cloud: signed out and credentials cleared");
    Ok(())
}

#[tauri::command]
pub fn cloud_status(
    state: tauri::State<'_, Arc<CloudState>>,
) -> CloudStatusResponse {
    cloud_status_from_state(&state)
}

#[tauri::command]
pub async fn cloud_update_instance_name(
    name: String,
    state: tauri::State<'_, Arc<CloudState>>,
) -> Result<(), String> {
    let _api_key = state.api_key.lock().unwrap().clone()
        .ok_or("Not logged in")?;
    let instance_id = state.instance_id.lock().unwrap().clone()
        .ok_or("No instance")?;

    // Get a fresh JWT to call the instances endpoint
    let refresh_token = auth::load_refresh_token()?;
    let tokens = client::refresh_token(&refresh_token).await?;
    auth::store_refresh_token(&tokens.refresh_token)?;

    client::update_instance_name(&tokens.token, &instance_id, &name).await?;

    *state.instance_name.lock().unwrap() = Some(name.clone());
    auth::store_instance_name(&name)?;

    log::info!("Cloud: instance renamed to '{}'", name);
    Ok(())
}

fn cloud_status_from_state(state: &CloudState) -> CloudStatusResponse {
    let status = state.status.lock().unwrap();
    let connected = matches!(*status, CloudSyncStatus::Connected | CloudSyncStatus::Syncing);
    let status_str = match &*status {
        CloudSyncStatus::Disconnected => "disconnected".to_string(),
        CloudSyncStatus::Connecting => "connecting".to_string(),
        CloudSyncStatus::Connected => "connected".to_string(),
        CloudSyncStatus::Syncing => "syncing".to_string(),
        CloudSyncStatus::Error(msg) => format!("error: {}", msg),
        CloudSyncStatus::AuthRequired => "auth_required".to_string(),
    };

    CloudStatusResponse {
        connected,
        status: status_str,
        email: state.email.lock().unwrap().clone(),
        instance_name: state.instance_name.lock().unwrap().clone(),
        instance_id: state.instance_id.lock().unwrap().clone(),
        last_sync: *state.last_sync.lock().unwrap(),
        queue_size: *state.queue_size.lock().unwrap(),
    }
}
