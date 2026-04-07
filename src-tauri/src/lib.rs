mod commands;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_log::{Target, TargetKind};
use commands::{
    miner::get_miner_status,
    pool::{configure_pool, set_miner_pools},
    scan::{scan_network, get_local_subnet},
};
use commands::storage::{
    get_saved_miners, add_miner, remove_miner, update_miner_label, import_from_scan, update_miner_wattage,
};
use commands::pool_profiles::{
    get_saved_pools, add_pool_profile, update_pool_profile, remove_pool_profile,
};
use commands::preferences::{get_preferences, save_preferences, set_log_level, open_log_directory};
use commands::profitability::{get_kas_price, get_network_stats, calculate_earnings, get_coin_price, get_coin_network_stats, calculate_coin_earnings};
use commands::history::{add_farm_snapshot, get_farm_history, clear_farm_history};
use commands::alerts::{
    get_alert_rules, add_alert_rule, update_alert_rule, remove_alert_rule,
    get_alert_history, clear_alert_history, acknowledge_alert, check_alerts,
};
use commands::coins::{get_coins, add_coin, remove_coin};
use commands::email::{get_smtp_config, save_smtp_config, test_smtp_config, send_alert_email};
use commands::notifications::send_desktop_notification;
use commands::uptime::{record_uptime, get_uptime_stats, get_all_uptime_stats, clear_uptime_data};
use commands::export::{export_miners_csv, export_alert_history_csv, export_profitability_csv, export_farm_history_csv};
use commands::tray::{TrayState, update_tray_tooltip};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: Some("popmanager".into()) }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let identifier = app.config().identifier.clone();
                commands::notifications::setup_windows_aumid(&identifier, "PoPManager");
            }

            // Load preferences and initialise managed tray state.
            let prefs = commands::preferences::load_prefs_sync(app.handle());
            app.manage(TrayState {
                minimize_to_tray: std::sync::Mutex::new(prefs.minimize_to_tray),
            });

            // Build the system tray menu.
            let show = MenuItem::with_id(app, "show", "Open PoPManager", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("PoPManager - Mining Manager")
                .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                log::info!("Restoring PoPManager from system tray");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            log::info!("Restoring PoPManager from system tray (click)");
                        }
                    }
                })
                .build(app)?;

            // Intercept the window close button: hide to tray instead of quitting
            // (when minimize_to_tray is enabled).
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let tray_state = app_handle.state::<TrayState>();
                        let minimize = *tray_state.minimize_to_tray.lock().unwrap();
                        if minimize {
                            api.prevent_close();
                            if let Some(win) = app_handle.get_webview_window("main") {
                                log::info!("Minimizing PoPManager to system tray");
                                let _ = win.hide();
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_network,
            get_local_subnet,
            get_miner_status,
            configure_pool,
            set_miner_pools,
            get_saved_miners,
            add_miner,
            remove_miner,
            update_miner_label,
            import_from_scan,
            update_miner_wattage,
            get_saved_pools,
            add_pool_profile,
            update_pool_profile,
            remove_pool_profile,
            get_preferences,
            save_preferences,
            get_kas_price,
            get_network_stats,
            calculate_earnings,
            get_coin_price,
            get_coin_network_stats,
            calculate_coin_earnings,
            get_alert_rules,
            add_alert_rule,
            update_alert_rule,
            remove_alert_rule,
            get_alert_history,
            clear_alert_history,
            acknowledge_alert,
            check_alerts,
            get_coins,
            add_coin,
            remove_coin,
            get_smtp_config,
            save_smtp_config,
            test_smtp_config,
            send_alert_email,
            send_desktop_notification,
            add_farm_snapshot,
            get_farm_history,
            clear_farm_history,
            record_uptime,
            get_uptime_stats,
            get_all_uptime_stats,
            clear_uptime_data,
            export_miners_csv,
            export_alert_history_csv,
            export_profitability_csv,
            export_farm_history_csv,
            set_log_level,
            open_log_directory,
            update_tray_tooltip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
