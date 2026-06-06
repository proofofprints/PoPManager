# OverManager Cloud Sync

Connect your OverManager desktop app to OverCloud for remote monitoring, push notifications, and remote miner control from anywhere.

## What Cloud Sync Does

| Feature | Free (Local) | Cloud ($5/month) |
|---|---|---|
| Monitor miners on LAN | Yes | Yes |
| Hashrate history | 30 days | Unlimited |
| Desktop alerts (sound + email) | Yes | Yes |
| Push notifications to phone | No | Yes |
| Remote monitoring from anywhere | No | Yes |
| Remote start/stop/config from phone | No | Yes |
| Multiple OverManager installations | N/A | Yes |
| Web portal (cloud.overbuildlabs.com) | No | Yes |
| Companion app (iOS + Android) | No | Yes |
| Ad-free desktop | Ads after 5 devices | Yes |

## Getting Started

### 1. Create a OverCloud account

Visit [cloud.overbuildlabs.com](https://cloud.overbuildlabs.com) and create an account. You'll need:
- Email address
- Password (minimum 8 characters)

Account creation is free. You can explore the web portal before subscribing.

### 2. Subscribe to Cloud Basic

From the web portal, go to **Account → Subscription** and choose the Cloud Basic plan ($5/month). Payment is handled securely via Stripe.

### 3. Connect OverManager

In OverManager desktop:

1. Open **Settings**
2. Find the **Cloud Sync** section (near the top, below Preferences)
3. Enter your email and password
4. Click **Sign In**
5. OverManager will create an "instance" for this installation and begin syncing

You should see:
- **Status:** Connected (green dot)
- **Instance:** "My Farm" (editable name)
- **Last Sync:** timestamp updating every 60 seconds

### 4. Verify data is flowing

After signing in, wait 60 seconds, then open [cloud.overbuildlabs.com](https://cloud.overbuildlabs.com) in your browser. You should see:
- Your farm's current hashrate
- Online/offline miner counts
- The miners you have configured locally

## How It Works

### Data flow

OverManager pushes three types of data to the cloud:

1. **Farm snapshots** (every 60 seconds) — total hashrate, online count, per-coin earnings
2. **Miner states** (on change) — individual miner status, hashrate, temperature, pool info
3. **Alert events** (when they fire) — offline alerts, temperature warnings, share alerts

All data flows **outbound** from your desktop to the cloud. OverManager never exposes any ports to the internet — it's always your app initiating the connection.

### Remote commands

When you (or someone you authorize) sends a command from the web portal or companion app:

1. The command is queued in the cloud
2. OverManager picks it up via a persistent WebSocket connection
3. OverManager executes it locally (same as clicking the button in the UI)
4. OverManager sends an acknowledgment back to the cloud
5. The web portal / companion app shows the result

If OverManager is offline when a command is queued, it will execute when OverManager reconnects.

### Offline behavior

OverManager continues working fully offline. When cloud connectivity is lost:

- Local monitoring, alerts, and miner management continue normally
- Snapshots and alerts are queued locally (stored in a SQLite database)
- When connectivity is restored, queued data is synced automatically
- Stale data is pruned: snapshots older than 30 days, alerts older than 90 days

## Settings Reference

### Cloud Sync section in Settings

| Field | Description |
|---|---|
| **Email** | Your OverCloud account email |
| **Password** | Your OverCloud account password (only needed for initial login) |
| **Status** | Connection state: Connected / Disconnected / Syncing / Error |
| **Instance Name** | A name for this OverManager installation (e.g. "Home Farm", "Office Rig") — editable |
| **Last Sync** | Timestamp of the last successful data push |
| **Queue Size** | Number of pending items in the offline queue (only shown when > 0) |
| **Sign Out** | Disconnects from cloud and removes stored credentials |

### Credentials storage

Your cloud credentials are stored securely in your operating system's native credential store:

| OS | Storage |
|---|---|
| Windows | Windows Credential Manager |
| macOS | macOS Keychain |
| Linux | Secret Service (GNOME Keyring / KDE Wallet) |

OverManager never stores your password. After initial login, only an API key and a refresh token are stored. The refresh token expires after 30 days of inactivity — if you don't open OverManager for 30+ days, you'll need to sign in again.

## Multiple Instances

One OverCloud account can have multiple OverManager installations connected. Each installation is a separate "instance" with its own name and API key.

Common use cases:
- Home mining farm + hosted facility
- One PC monitoring ASICs, another running PoPMiner Nanos
- Test/development instance separate from production

Each instance pushes its own snapshots and miner states. The web portal and companion app show data from all instances, with a dropdown to filter by instance.

## Data Retention

| Data type | Local (free) | Cloud (subscribed) |
|---|---|---|
| Farm snapshots | 30 days | Unlimited |
| Alert history | 100 events | Unlimited |
| Miner states | Current only | Current + last 90 days of changes |

If you cancel your subscription, your cloud data is retained for 30 days. After that, it's permanently deleted.

## Privacy & Security

- **No miner credentials leave your machine.** OverManager never sends miner passwords, wallet private keys, or pool credentials to the cloud. Only performance metrics (hashrate, temperature, share counts, pool URLs, uptime) are synced.
- **All communication is encrypted.** OverManager connects to the cloud over HTTPS (TLS 1.3) and WSS (WebSocket Secure).
- **Your API key is unique to your installation.** It can be regenerated at any time from the web portal if you suspect it's been compromised.
- **Remote commands are relayed, not executed by the cloud.** The cloud never connects to your miners directly — OverManager desktop is always the execution layer.

## Bandwidth Usage

Cloud sync uses very little bandwidth:

| Data | Size | Frequency | ~Monthly |
|---|---|---|---|
| Farm snapshot | ~500 bytes | Every 60s | ~22 MB |
| Miner state update | ~1 KB per miner | On change | ~5-15 MB |
| Alert event | ~200 bytes | Per alert | < 1 MB |
| WebSocket keepalive | ~50 bytes | Every 30s | ~4 MB |
| **Total** | | | **~30-40 MB/month** |

This is negligible even on metered connections.
