use tauri_plugin_notification::NotificationExt;

/// Register the app's AUMID in the user registry and set it as the current
/// process AUMID so Windows attributes toast notifications to "PoPManager"
/// even in dev mode.
#[cfg(target_os = "windows")]
pub fn setup_windows_aumid(identifier: &str, display_name: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe {
        let key_path = format!("Software\\Classes\\AppUserModelId\\{}", identifier);
        let key_path_w = to_wide(&key_path);
        let mut hkey: HKEY = std::ptr::null_mut();
        let mut disposition: u32 = 0;

        let rc = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_path_w.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            std::ptr::null::<SECURITY_ATTRIBUTES>(),
            &mut hkey,
            &mut disposition,
        );

        if rc == ERROR_SUCCESS {
            let value_name_w = to_wide("DisplayName");
            let display_w = to_wide(display_name);
            let data_ptr = display_w.as_ptr() as *const u8;
            let data_len = (display_w.len() * 2) as u32;
            RegSetValueExW(hkey, value_name_w.as_ptr(), 0, REG_SZ, data_ptr, data_len);
            RegCloseKey(hkey);
        }

        // Set AUMID for this process so the registered entry is used immediately
        #[link(name = "Shell32")]
        extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(AppID: *const u16) -> u32;
        }
        let aumid_w = to_wide(identifier);
        SetCurrentProcessExplicitAppUserModelID(aumid_w.as_ptr());
    }
}

/// Report whether Windows will actually surface our toasts. When the per-app or
/// system notification toggle is OFF, `Toast::show()` returns `Ok` but nothing
/// appears — users have no way to tell. The frontend uses this to show a warning
/// banner that deep-links to `ms-settings:notifications`.
///
/// Returns one of: `enabled`, `disabledForApplication`, `disabledForUser`,
/// `disabledByGroupPolicy`, `disabledByManifest`, `unknown`.
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_notification_status(app: tauri::AppHandle) -> Result<String, String> {
    use windows::core::HSTRING;
    use windows::UI::Notifications::{NotificationSetting, ToastNotificationManager};

    let identifier = app.config().identifier.clone();
    let aumid = HSTRING::from(identifier);
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&aumid)
        .map_err(|e| format!("Failed to create toast notifier: {}", e))?;
    let setting = notifier
        .Setting()
        .map_err(|e| format!("Failed to read notification setting: {}", e))?;

    let s = if setting == NotificationSetting::Enabled {
        "enabled"
    } else if setting == NotificationSetting::DisabledForApplication {
        "disabledForApplication"
    } else if setting == NotificationSetting::DisabledForUser {
        "disabledForUser"
    } else if setting == NotificationSetting::DisabledByGroupPolicy {
        "disabledByGroupPolicy"
    } else if setting == NotificationSetting::DisabledByManifest {
        "disabledByManifest"
    } else {
        "unknown"
    };
    Ok(s.to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn get_notification_status(_app: tauri::AppHandle) -> Result<String, String> {
    Ok("enabled".to_string())
}

#[tauri::command]
pub fn send_desktop_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    // On Windows, bypass the notification plugin's dev-mode AUMID skip by using
    // tauri-winrt-notification directly so our registered AUMID is always used.
    #[cfg(target_os = "windows")]
    {
        use tauri_winrt_notification::Toast;
        let identifier = app.config().identifier.clone();
        return Toast::new(&identifier)
            .title(&title)
            .text1(&body)
            .show()
            .map_err(|e| {
                log::error!("Desktop notification failed: {}", e);
                e.to_string()
            })
            .map(|_| {
                log::info!("Desktop notification sent: {}", title);
            });
    }

    #[cfg(not(target_os = "windows"))]
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| {
            log::error!("Desktop notification failed: {}", e);
            e.to_string()
        })
        .map(|_| {
            log::info!("Desktop notification sent: {}", title);
        })
}
