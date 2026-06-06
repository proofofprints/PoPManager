# Cloud Sync — Technical Architecture

Internal reference for developers working on OverManager's cloud integration. For user-facing docs see [CLOUD_SYNC.md](./CLOUD_SYNC.md).

## Overview

OverManager Cloud Sync is an opt-in feature that connects the desktop app to OverCloud (cloud.overbuildlabs.com). Data flows outbound from the desktop to the cloud via REST pushes and a persistent WebSocket for receiving remote commands.

```
OverManager Desktop                          OverCloud API
┌──────────────────┐                    ┌──────────────────┐
│                  │  POST /ingest/*    │                  │
│  sync.rs ────────│───────────────────>│  Fastify +       │
│  (60s ticker)    │  snapshots, alerts │  PostgreSQL +    │
│                  │  miner states      │  TimescaleDB     │
│                  │                    │                  │
│  ws.rs ──────────│<══════════════════>│  WebSocket       │
│  (persistent)    │  commands + acks   │  + Redis pub/sub │
│                  │                    │                  │
│  queue.rs ───────│  SQLite offline    │                  │
│  (durable)       │  queue             │                  │
│                  │                    │                  │
│  auth.rs ────────│  OS keychain       │                  │
│  (credentials)   │  storage           │                  │
└──────────────────┘                    └──────────────────┘
```

## Module structure

```
src-tauri/src/cloud/
├── mod.rs              # Module entry, CloudState struct, start/stop lifecycle
├── client.rs           # reqwest HTTP client — login, refresh, instance ops, ingest
├── ws.rs               # tokio-tungstenite WebSocket — receives commands, sends acks
├── auth.rs             # Keychain read/write (keyring crate), token rotation
├── queue.rs            # rusqlite offline queue — enqueue, drain, prune
├── sync.rs             # Background tokio task — 60s snapshot ticker, queue drain
└── command_exec.rs     # Cloud command → local execution adapter
```

## Dependencies added

| Crate | Version | Purpose |
|---|---|---|
| `rusqlite` | 0.31 (bundled) | Offline sync queue (WAL-mode SQLite) |
| `tokio-tungstenite` | 0.21 (rustls) | WebSocket client for command relay |
| `keyring` | 2.x | OS keychain for credential storage |

`reqwest` (already present) is used for all REST API calls.

## Authentication model

### Dual credential system

| Credential | Storage | Lifetime | Used for |
|---|---|---|---|
| **API Key** | OS keychain (`popmanager-cloud-api-key`) | Until revoked | All ingest calls (`X-API-Key` header) + WebSocket auth |
| **Refresh Token** | OS keychain (`popmanager-cloud-refresh-token`) | 30 days (auto-renewed) | Minting JWT access tokens for UI calls |
| **JWT Access Token** | In-memory only | 15 minutes | `/auth/me`, `/instances` — Settings UI calls |

### Login flow

```
User enters email + password in Settings
        │
        ▼
POST /api/v1/auth/login → { user, token, refreshToken }
        │
        ▼
POST /api/v1/instances → { id, apiKey, name } (create instance)
        │
        ▼
Store apiKey + refreshToken in OS keychain
        │
        ▼
Start sync.rs background task + ws.rs WebSocket connection
```

### Token refresh flow

```
Settings UI needs to show user info
        │
        ▼
Read refreshToken from keychain
        │
        ▼
POST /api/v1/auth/refresh → { token, refreshToken }
        │
        ▼
Store new refreshToken in keychain
        │
        ▼
Use JWT token for GET /api/v1/auth/me
```

### Refresh token expiry

If the refresh token expires (user offline for 30+ days):
- Sync continues working (API key is still valid for ingest)
- Settings UI shows "Session expired — please sign in again"
- User re-enters password → new refresh token issued

## Offline queue

### Schema

```sql
CREATE TABLE cloud_sync_queue (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('snapshot', 'alert')),
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,       -- unix epoch seconds
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error    TEXT
);
```

Stored in `%LOCALAPPDATA%/OverManager/cloud_queue.db` (SQLite with WAL mode).

### Retry policy

| HTTP Response | Classification | Action |
|---|---|---|
| 2xx | Success | Delete from queue |
| 400 (bad request) | Permanent | Retry up to 5 times, then drop |
| 401 / 403 | Auth failure | Stop syncing, prompt re-login |
| 429 | Rate limited | Back off harder (double the interval) |
| 5xx | Transient | Retry with exponential backoff |
| Network error / timeout | Transient | Retry with exponential backoff |

### Backoff schedule

30s → 1m → 2m → 5m → 15m → 30m (cap)

### Pruning

- Snapshot rows older than **30 days** → dropped (stale, not worth backfilling)
- Alert rows older than **90 days** → dropped
- Queue exceeds **100 MB** → UI warns user

### Miner states are NOT queued

Miner state changes are frequent and only the latest state matters. On reconnect after an offline period, the sync task pushes the **current** state of all miners (one bulk POST), not the history of changes.

## Integration points

### Snapshot push

`add_farm_snapshot` in `history.rs` is the single funnel for all farm snapshots. When cloud is enabled, this function also enqueues the snapshot for cloud sync.

### Alert push

`check_alerts` and `check_mobile_alerts` in `alerts.rs` return `Vec<AlertEvent>`. When cloud is enabled, each fired alert is enqueued for cloud sync after being saved to local history.

### Miner state push

| Miner type | State source | Push trigger |
|---|---|---|
| ASIC | Frontend (`minerData` in Dashboard.tsx) | After each poll cycle via Tauri command |
| Mobile | `Arc<MobileMinersState>` in Rust | From sync.rs background task |
| PoPMiner | `Arc<PopMinerDevicesState>` in Rust | From sync.rs background task |

### Command execution

Commands arrive via WebSocket as:
```json
{ "type": "command", "data": {
    "id": "cmd-uuid",
    "targetType": "mobile",
    "targetId": "device-uuid",
    "commandType": "stop",
    "params": null
}}
```

`command_exec.rs` maps this to existing OverManager functions:

| targetType | commandType | Calls |
|---|---|---|
| `mobile` | `start/stop/restart/set_config/set_threads` | `queue_mobile_command()` in `mobile_miner.rs` |
| `asic` | `set_pool` | `set_miner_pools()` in `pool.rs` |
| `popminer` | *(not yet supported)* | Returns error — PoPMiner control is tier 2 |

After execution, sends ack back via WebSocket:
```json
{ "type": "command-ack", "data": {
    "id": "cmd-uuid",
    "status": "applied"  // or "failed"
    "error": null         // or error message
}}
```

## Cloud sync lifecycle

### Start (on app launch)

1. Check keychain for stored API key
2. If found → start sync.rs background task + ws.rs WebSocket
3. If not found → do nothing (user hasn't logged in yet)

### Running

- sync.rs: 60s ticker pushes latest snapshot, drains queue
- ws.rs: persistent WebSocket connection, auto-reconnects on drop
- Queue: enqueue on ingest failure, drain on connectivity restore

### Stop (on sign-out or app quit)

1. Close WebSocket connection
2. Stop sync task
3. Queue persists on disk (will resume on next launch)
4. On explicit sign-out: clear keychain credentials + delete queue DB

## Settings UI

### Cloud Sync section (in Settings.tsx)

Positioned between Preferences and Email Configuration sections.

**Signed out state:**
- Email input
- Password input
- "Sign In" button
- "Don't have an account? Sign up at cloud.overbuildlabs.com" link

**Signed in state:**
- Status indicator: green dot "Connected" / yellow "Syncing" / red "Disconnected"
- Account email (read-only)
- Instance name (editable text input with save button)
- Last sync timestamp
- Queue size (only shown when > 0, with warning if > 100 MB)
- "Sign Out" button

## Tauri commands

| Command | Auth | Purpose |
|---|---|---|
| `cloud_login(email, password)` | None | Login + create instance + store credentials |
| `cloud_logout()` | None | Clear credentials, stop sync, delete queue |
| `cloud_status()` | None | Returns { connected, email, instanceName, lastSync, queueSize } |
| `cloud_update_instance_name(name)` | API key | Rename the instance |

## Error handling

| Error | User sees | Action |
|---|---|---|
| Network unreachable | Status: "Disconnected" | Auto-retry, queue locally |
| 401 from ingest | Status: "Auth error" | Prompt re-login |
| 401 from refresh | "Session expired" toast | Prompt re-login |
| WebSocket disconnected | Status: "Reconnecting" | Auto-reconnect (5s → 10s → 30s → 60s backoff) |
| Queue > 100 MB | Warning banner in Settings | Suggest checking connection |
| Cloud API returns 500 | Logged, not shown to user | Retry with backoff |
