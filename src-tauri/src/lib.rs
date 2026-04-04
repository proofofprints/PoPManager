mod commands;

use commands::{miner::get_miner_status, pool::configure_pool, scan::{scan_network, get_local_subnet}};
use commands::storage::{
    get_saved_miners, add_miner, remove_miner, update_miner_label, import_from_scan,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            scan_network,
            get_local_subnet,
            get_miner_status,
            configure_pool,
            get_saved_miners,
            add_miner,
            remove_miner,
            update_miner_label,
            import_from_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
