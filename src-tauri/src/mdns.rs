use mdns_sd::{ServiceDaemon, ServiceInfo};

const SERVICE_TYPE: &str = "_popmanager._tcp.local.";

/// Register PoPManager as an mDNS service on the local network.
/// Returns the ServiceDaemon handle which must be kept alive for the
/// advertisement to remain active. Drop it or call `unregister` to stop.
pub fn register(port: u16) -> Result<ServiceDaemon, String> {
    let daemon =
        ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

    // Use COMPUTERNAME on Windows, HOSTNAME on Unix, fall back to "PoPManager".
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PoPManager".to_string());

    let instance_name = hostname.clone();

    // TXT record properties advertised to discovering clients.
    let properties = [
        ("version", env!("CARGO_PKG_VERSION")),
        ("api", "/api/miners/mobile"),
        ("auth", "pairing-code"),
    ];

    // The host_name must end with ".local." for mDNS.
    let host_name = format!("{}.local.", hostname);

    let service = ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name,
        &host_name,
        "",   // empty = no hardcoded IPs; enable_addr_auto below
        port,
        &properties[..],
    )
    .map_err(|e| format!("Failed to create mDNS service info: {}", e))?
    .enable_addr_auto();

    daemon
        .register(service)
        .map_err(|e| format!("Failed to register mDNS service: {}", e))?;

    log::info!(
        "mDNS: advertising PoPManager as {}.{} on port {}",
        instance_name,
        SERVICE_TYPE,
        port
    );

    Ok(daemon)
}

/// Shut down the mDNS daemon, stopping service advertisement.
pub fn unregister(daemon: ServiceDaemon) {
    match daemon.shutdown() {
        Ok(_receiver) => {
            log::info!("mDNS: service advertisement stopped");
        }
        Err(e) => {
            log::warn!("mDNS: shutdown error: {}", e);
        }
    }
}
