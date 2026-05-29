use serde::Deserialize;
use std::sync::Arc;
use tauri::Manager;

use crate::commands::mobile_miner::{
    MobileCommand, MobileCommandsState, save_commands_to_disk,
};
use crate::commands::pool::{set_miner_pools, PoolConfig};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCommand {
    pub id: String,
    pub target_type: String,
    pub target_id: String,
    pub command_type: String,
    pub params: Option<serde_json::Value>,
}

pub struct CommandResult {
    pub status: String,
    pub error: Option<String>,
}

impl CommandResult {
    fn ok() -> Self {
        CommandResult {
            status: "applied".to_string(),
            error: None,
        }
    }

    fn fail(msg: impl Into<String>) -> Self {
        let msg = msg.into();
        CommandResult {
            status: "failed".to_string(),
            error: Some(msg),
        }
    }
}

/// Execute a cloud command by dispatching to the appropriate local handler.
pub async fn execute_command(
    cmd: &CloudCommand,
    app_handle: &tauri::AppHandle,
) -> CommandResult {
    match cmd.target_type.as_str() {
        "mobile" => execute_mobile_command(cmd, app_handle).await,
        "asic" => execute_asic_command(cmd, app_handle).await,
        "popminer" => CommandResult::fail("OBMiner remote control not yet supported"),
        other => CommandResult::fail(format!("Unknown target type: {}", other)),
    }
}

/// Execute a mobile miner command by inserting into the MobileCommandsState.
/// This mirrors the logic of `queue_mobile_command` without going through the
/// Tauri command dispatch layer.
async fn execute_mobile_command(
    cmd: &CloudCommand,
    app_handle: &tauri::AppHandle,
) -> CommandResult {
    let valid_types = ["set_config", "set_threads", "start", "stop", "restart"];
    if !valid_types.contains(&cmd.command_type.as_str()) {
        return CommandResult::fail(format!(
            "Invalid mobile command type: {}",
            cmd.command_type
        ));
    }

    let commands_state = match app_handle.try_state::<Arc<MobileCommandsState>>() {
        Some(s) => s,
        None => return CommandResult::fail("MobileCommandsState not available"),
    };

    let mobile_cmd = MobileCommand {
        id: cmd.id.clone(),
        device_id: cmd.target_id.clone(),
        command_type: cmd.command_type.clone(),
        params: cmd.params.clone().unwrap_or(serde_json::Value::Null),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "pending".to_string(),
        acked_at: None,
        error: None,
    };

    let mut commands = commands_state.commands.lock().unwrap();
    let device_commands = commands
        .entry(cmd.target_id.clone())
        .or_insert_with(Vec::new);

    // Cap at 100 per device
    if device_commands.len() >= 100 {
        if let Some(pos) = device_commands.iter().position(|c| c.status != "pending") {
            device_commands.remove(pos);
        } else {
            device_commands.remove(0);
        }
    }

    device_commands.push(mobile_cmd);
    save_commands_to_disk(&commands);

    log::info!(
        "Cloud command exec: queued mobile command {} ({}) for device {}",
        cmd.id,
        cmd.command_type,
        cmd.target_id
    );

    CommandResult::ok()
}

/// Execute an ASIC command. Only `set_pool` is supported.
async fn execute_asic_command(
    cmd: &CloudCommand,
    _app_handle: &tauri::AppHandle,
) -> CommandResult {
    match cmd.command_type.as_str() {
        "set_pool" => {
            let params = match &cmd.params {
                Some(p) => p,
                None => return CommandResult::fail("set_pool requires params"),
            };

            let pool_config: PoolConfig = match serde_json::from_value(params.clone()) {
                Ok(c) => c,
                Err(e) => {
                    return CommandResult::fail(format!("Invalid pool config: {}", e));
                }
            };

            // target_id is the miner IP for ASICs
            match set_miner_pools(cmd.target_id.clone(), pool_config).await {
                Ok(_) => {
                    log::info!(
                        "Cloud command exec: pool config applied to ASIC {}",
                        cmd.target_id
                    );
                    CommandResult::ok()
                }
                Err(e) => CommandResult::fail(format!("Failed to set pools on {}: {}", cmd.target_id, e)),
            }
        }
        "start" | "stop" | "restart" => {
            CommandResult::fail(format!(
                "ASIC {} command not supported — ASICs do not have a remote start/stop API",
                cmd.command_type
            ))
        }
        other => CommandResult::fail(format!("Unknown ASIC command type: {}", other)),
    }
}
