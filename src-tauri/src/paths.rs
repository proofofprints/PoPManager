use std::path::PathBuf;

/// Base local-data directory (…\AppData\Local on Windows), with a last-resort
/// fallback to the executable's directory if the platform dir can't be found.
pub fn data_local_base() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    })
}

/// Resolves the app's storage directory. Prefers the rebranded `OverManager`
/// dir; falls back to the legacy `PoPManager` dir when the new one doesn't
/// exist yet (migration hasn't run or failed), so there is never data loss.
pub fn app_data_root() -> PathBuf {
    let base = data_local_base();
    let new = base.join("OverManager");
    if new.exists() {
        new
    } else {
        base.join("PoPManager")
    }
}
