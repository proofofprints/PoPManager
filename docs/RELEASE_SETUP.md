# PoPManager Release Setup Guide

## One-Time Setup: Signing Keys

Tauri's auto-updater requires releases to be cryptographically signed. This ensures users receive authentic updates.

### Generate Signing Keys

Run this once on your development machine:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/popmanager.key
```

This creates:
- **Private key** (`~/.tauri/popmanager.key`) — keep this secret, never commit it
- **Public key** — displayed in the terminal output

### Configure the Public Key

1. Copy the public key string from the terminal output
2. Open `src-tauri/tauri.conf.json`
3. Find the `plugins.updater.pubkey` field and paste the public key there

### Set Environment Variable for Builds

Before building a release, set the private key path:

```bash
# Windows (PowerShell)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/popmanager.key

# Linux/Mac
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/popmanager.key)
```

## Creating a Release

### 1. Update Version

Edit `src-tauri/tauri.conf.json` and update the `version` field (e.g., "0.2.0").

### 2. Build

```bash
npm run tauri build
```

This creates:
- `src-tauri/target/release/bundle/msi/PoPManager_x.x.x_x64_en-US.msi` — Windows installer
- `src-tauri/target/release/bundle/msi/PoPManager_x.x.x_x64_en-US.msi.sig` — Update signature

### 3. Create GitHub Release

1. Go to https://github.com/proofofprints/PoPManager/releases/new
2. Create a new tag (e.g., `v0.2.0`)
3. Upload the MSI file
4. Upload the `.msi.sig` signature file
5. Create a `latest.json` file with this format and upload it:

```json
{
  "version": "0.2.0",
  "notes": "Release notes here",
  "pub_date": "2026-04-06T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of the .msi.sig file>",
      "url": "https://github.com/proofofprints/PoPManager/releases/download/v0.2.0/PoPManager_0.2.0_x64_en-US.msi"
    }
  }
}
```

### 4. How Users Get Updates

- **First install:** Users download the MSI from the GitHub Releases page
- **Subsequent updates:** The app automatically checks for updates on launch and shows a notification if a new version is available. Users click "Update Now" and the app downloads, installs, and restarts automatically.
- **Manual check:** Users can also click "Check for Updates" in Settings
