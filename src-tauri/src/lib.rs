mod commands;

use commands::{miner::get_miner_status, pool::configure_pool, scan::scan_network};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            scan_network,
            get_miner_status,
            configure_pool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
