use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtpConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub username: String,
    pub password: String,
    pub from_address: String,
    pub to_addresses: Vec<String>,
    pub use_tls: bool,
}

fn smtp_config_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join("PoPManager").join("smtp_config.json")
}

fn load_smtp_config() -> Option<SmtpConfig> {
    let path = smtp_config_path();
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub fn get_smtp_config() -> Result<Option<SmtpConfig>, String> {
    Ok(load_smtp_config())
}

#[tauri::command]
pub fn save_smtp_config(config: SmtpConfig) -> Result<(), String> {
    let path = smtp_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

async fn do_send(config: &SmtpConfig, email: Message) -> Result<(), String> {
    let creds = Credentials::new(config.username.clone(), config.password.clone());
    log::info!("Sending email via {}:{}", config.smtp_host, config.smtp_port);
    // Port 465 = implicit TLS (relay); port 587 = STARTTLS; anything else follows use_tls flag.
    match config.smtp_port {
        465 => {
            let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
                .map_err(|e| e.to_string())?
                .credentials(creds)
                .port(config.smtp_port)
                .build();
            mailer.send(email).await.map_err(|e| e.to_string())?;
        }
        587 | 25 => {
            let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
                .map_err(|e| e.to_string())?
                .credentials(creds)
                .port(config.smtp_port)
                .build();
            mailer.send(email).await.map_err(|e| e.to_string())?;
        }
        _ => {
            if config.use_tls {
                let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
                    .map_err(|e| e.to_string())?
                    .credentials(creds)
                    .port(config.smtp_port)
                    .build();
                mailer.send(email).await.map_err(|e| e.to_string())?;
            } else {
                let mailer =
                    AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.smtp_host)
                        .credentials(creds)
                        .port(config.smtp_port)
                        .build();
                mailer.send(email).await.map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn test_smtp_config() -> Result<String, String> {
    let config = load_smtp_config().ok_or_else(|| "SMTP not configured".to_string())?;
    let to = config
        .to_addresses
        .first()
        .ok_or_else(|| "No recipient address configured".to_string())?;
    let email = Message::builder()
        .from(config.from_address.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .to(to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .subject("PoPManager Test Email")
        .header(ContentType::TEXT_PLAIN)
        .body("This is a test email from PoPManager. Your alert notifications are configured correctly.".to_string())
        .map_err(|e| e.to_string())?;
    do_send(&config, email).await.map_err(|e| {
        log::error!("Test email send failed: {}", e);
        e
    })?;
    log::info!("Test email sent successfully to {}", to);
    Ok("Test email sent successfully".to_string())
}

#[tauri::command]
pub async fn send_alert_email(subject: String, body: String) -> Result<(), String> {
    let config = load_smtp_config().ok_or_else(|| "SMTP not configured".to_string())?;
    let to = config
        .to_addresses
        .first()
        .ok_or_else(|| "No recipient address configured".to_string())?;
    let email = Message::builder()
        .from(config.from_address.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .to(to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .subject(subject.as_str())
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|e| e.to_string())?;
    do_send(&config, email).await.map_err(|e| {
        log::error!("Alert email send failed: {}", e);
        e
    })?;
    log::info!("Alert email sent: {}", subject);
    Ok(())
}
