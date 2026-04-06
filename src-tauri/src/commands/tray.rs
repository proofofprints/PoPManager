use std::sync::Mutex;

pub struct TrayState {
    pub minimize_to_tray: Mutex<bool>,
}

#[tauri::command]
pub fn update_tray_tooltip(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_tooltip(Some(text.as_str()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
