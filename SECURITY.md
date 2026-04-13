# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in PoPManager, **please do not open a public GitHub issue.** Instead, report it privately via email:

**Email:** [support@proofofprints.com](mailto:support@proofofprints.com)

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

We will acknowledge your report within 48 hours and work with you to understand and address the issue before any public disclosure.

## Scope

PoPManager is a desktop application that communicates with mining hardware on the local network. Security-relevant areas include:

- **Mobile miner HTTP server** (port 8787) — accepts telemetry and commands from devices on the LAN
- **Pairing code authentication** — single-use codes for device registration
- **Per-device API keys** — used for report and command authentication
- **SMTP credentials** — stored locally for email alert delivery
- **Tauri updater** — verifies release signatures before applying updates
- **Local data storage** — JSON files in `%LOCALAPPDATA%\PoPManager\`

## What is NOT in scope

- Vulnerabilities in upstream dependencies (report those to the relevant project)
- Issues that require physical access to the machine running PoPManager
- Social engineering attacks
- Denial of service against the local HTTP server (it's LAN-only by design)

## Supported versions

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No — please update to the latest version |
