# Cloud Sync Troubleshooting

Common issues and solutions for PoPManager Cloud Sync.

## Connection Issues

### "Could not connect to cloud" / Status shows Disconnected

**Symptoms:** Cloud Sync status shows "Disconnected" or "Error" in Settings. No data appearing in the web portal.

**Checks:**

1. **Verify the cloud API is reachable:**
   ```
   curl https://cloud.proofofprints.com/health
   ```
   Expected: `{"ok":true,"version":"1.0.0"}`
   - If this fails → the cloud service may be temporarily down. Try again in a few minutes.
   - If your network blocks outbound HTTPS → check your firewall/proxy settings.

2. **Check your internet connection:**
   - Can you open [cloud.proofofprints.com](https://cloud.proofofprints.com) in a browser?
   - Is PoPManager behind a corporate proxy that blocks outbound WebSocket connections?

3. **Check PoPManager logs:**
   - Open Settings → Troubleshooting → Open Log Directory
   - Look for lines containing `cloud` or `ws` — they'll show connection errors with details

### "Invalid credentials" when signing in

**Cause:** Wrong email or password.

**Fix:**
1. Try logging in at [cloud.proofofprints.com](https://cloud.proofofprints.com) first to verify your credentials work
2. If you forgot your password, use the "Forgot Password" link on the web portal
3. Make sure you're using the email you registered with (check for typos)

### "Session expired — please sign in again"

**Cause:** Your refresh token expired because PoPManager wasn't opened for 30+ days.

**Fix:** Click "Sign In" again in Settings → Cloud Sync. Your data and instance are still intact — you just need to re-authenticate.

### Status shows "Connected" but no data in the web portal

**Checks:**

1. **Wait 60 seconds** — snapshots are pushed every 60 seconds, not instantly
2. **Check that you have miners configured** — if your ASIC/Mobile/PoPMiner miner lists are empty, there's nothing to push
3. **Check the correct instance** — if you have multiple instances, make sure the web portal is showing the right one
4. **Check PoPManager logs** for `cloud sync` lines — they'll show whether pushes are succeeding or failing

## Sync Issues

### "Queue size: X items" warning in Settings

**Symptoms:** The Cloud Sync section shows a queue count, meaning data is being saved locally but not reaching the cloud.

**Causes:**
- Internet connection lost
- Cloud API temporarily down
- API key revoked or invalid

**Fix:**
1. Check your internet connection
2. Wait — PoPManager will automatically retry with exponential backoff (30s → 1m → 5m → 30m)
3. If the queue keeps growing for hours, check the PoPManager log for specific error messages
4. If the log shows "401 Unauthorized" → your API key may have been revoked. Sign out and sign in again.

### Queue growing very large (100+ MB warning)

**Cause:** Extended offline period (days) while miners are running.

**Fix:**
1. Restore internet connectivity — queued data will sync automatically
2. If you don't need the queued data, sign out and sign in again (this clears the queue)
3. PoPManager automatically prunes: snapshots older than 30 days and alerts older than 90 days are dropped from the queue

### Miner states not updating in the web portal

**Cause:** Miner state pushes happen on state change, not on a timer. If nothing changes (same hashrate, same status), no push occurs.

**Fix:** This is normal behavior. Force a refresh by navigating away from the Miners page and back, or clicking Refresh.

## Remote Command Issues

### Commands stuck in "Pending" status

**Cause:** PoPManager desktop is offline or the WebSocket connection is down.

**Fix:**
1. Open PoPManager on the desktop — it will connect to the cloud and pick up pending commands
2. Check Cloud Sync status in Settings — it should show "Connected"
3. Commands will execute in order as soon as the WebSocket reconnects

### Command shows "Failed" status

**Cause:** PoPManager received the command but couldn't execute it.

**Common reasons:**
- The target miner is offline or unreachable on the LAN
- The miner rejected the configuration (wrong pool URL format, etc.)
- The target miner was removed from PoPManager since the command was queued

**Fix:** Check the error message on the command in the web portal. Fix the underlying issue and retry.

### "Subscription required" when trying to send commands

**Cause:** Remote commands require an active Cloud Basic or Cloud Pro subscription.

**Fix:** Subscribe at [cloud.proofofprints.com](https://cloud.proofofprints.com) → Account → Subscription.

## Credential Issues

### Can't find stored credentials after OS reinstall

**Cause:** Cloud credentials are stored in the OS keychain. Reinstalling the OS clears the keychain.

**Fix:** Just sign in again in Settings → Cloud Sync. Your cloud account, data, and instance are stored server-side — nothing is lost.

### "Keychain access denied" on Linux

**Cause:** The Secret Service (GNOME Keyring or KDE Wallet) isn't running or is locked.

**Fix:**
1. Make sure `gnome-keyring` or `kwallet` is installed and running
2. Try unlocking the keyring: `gnome-keyring-daemon --unlock`
3. If using a headless Linux environment, you may need to set up a keyring manually

### Signed in but API key shows as invalid

**Cause:** The API key for this instance was regenerated from the web portal or another PoPManager installation.

**Fix:** Sign out and sign in again. A new API key will be issued for this instance.

## Firewall & Network

### PoPManager behind a corporate firewall

PoPManager Cloud Sync requires outbound access to:

| Destination | Port | Protocol | Purpose |
|---|---|---|---|
| `cloud.proofofprints.com` | 443 | HTTPS | REST API calls |
| `cloud.proofofprints.com` | 443 | WSS | WebSocket for commands |

No inbound ports are needed. If your firewall blocks outbound WebSocket connections (WSS), remote commands won't work but snapshot/alert sync will still function via REST.

### Proxy configuration

PoPManager currently does not support HTTP proxy configuration for cloud sync. If you're behind a proxy, the cloud connection may fail. This is a known limitation — proxy support is planned for a future release.

## Data & Privacy

### What data does PoPManager send to the cloud?

**Sent:**
- Farm-level metrics: total hashrate, online miner count, per-coin earnings estimates
- Per-miner metrics: hashrate, temperature, fan speed, pool URL, worker name, share counts, uptime, status (online/offline/mining)
- Alert events: rule name, miner label, alert message, timestamp
- PoPManager version and instance name

**Never sent:**
- Miner web UI passwords
- Wallet private keys
- Pool passwords
- SMTP credentials
- Your operating system username or hostname (beyond the instance name you choose)
- Contents of any local files

### How to delete all cloud data

1. Log in to [cloud.proofofprints.com](https://cloud.proofofprints.com)
2. Go to Account → Danger Zone → Delete Account
3. This permanently deletes your account, all instances, all historical data, and cancels your subscription

Alternatively, to delete data for a specific instance only:
1. Go to Instances in the web portal
2. Click the instance → Delete Instance
3. This removes that instance and all its data but keeps your account

### Exporting cloud data

From the web portal:
- Dashboard → Export CSV (farm history)
- Miners → Export CSV (miner states)
- Alerts → Export CSV (alert history)

All exports are in CSV format, compatible with Excel, Google Sheets, and accounting software.

## Getting Help

If you can't resolve an issue using this guide:

1. **Check the logs** — Settings → Troubleshooting → Open Log Directory. Lines containing `cloud`, `ws`, `sync`, or `queue` are the most relevant.
2. **Open a GitHub issue** — [github.com/proofofprints/PoPManager/issues](https://github.com/proofofprints/PoPManager/issues) with:
   - Your PoPManager version (Settings → About)
   - Your operating system
   - The error message or behavior you're seeing
   - Relevant log lines (redact your email/API key if present)
3. **Email support** — [support@overbuildlabs.com](mailto:support@overbuildlabs.com) for account or billing issues
