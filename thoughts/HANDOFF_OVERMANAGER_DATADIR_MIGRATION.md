# Handoff: OverManager data-dir migration (deferred from v1.4.0 rebrand)

## Context

v1.4.0 rebranded PoPManager → OverManager (OverBuild Labs) on all user-visible
surfaces, but **intentionally kept two internal identifiers** so existing
v1.3.0 installs auto-update with zero data loss:

1. **Bundle identifier** `com.proofofprints.popmanager` (in `tauri.conf.json`).
   This is permanent — changing it breaks the updater chain for all existing
   installs. It is invisible to users. **Leave it forever.**
2. **Storage directory** `dirs::data_local_dir().join("PoPManager")` →
   `…\AppData\Local\PoPManager\`. Holds ALL user config: miners.json,
   pool_profiles.json, alert_rules.json, alert_history.json, coins.json,
   smtp_config.json, mobile_miners.json, mobile_server_config.json,
   mobile_miner_commands.json, popminer_devices.json, cloud_queue.db.
   Used via `base.join("PoPManager")` in 12 spots across `src-tauri/src/`.

This doc covers migrating **#2 only** (the storage dir) to `…\OverManager\`,
if/when desired. **#1 stays.**

## Is this even worth doing?

The storage dir lives under `%LOCALAPPDATA%` — invisible to normal users.
Renaming `…\PoPManager\` → `…\OverManager\` is purely cosmetic for anyone who
browses AppData. It carries migration risk (data loss if the copy is buggy)
for low user-visible benefit. **Recommendation: only do this if you want the
on-disk footprint to fully match the brand. Otherwise leave it — it's a
harmless invisible string.** The Tauri-managed dir (history.json, logs) lives
under `…\com.proofofprints.popmanager\` and stays put regardless, since we
keep the bundle identifier.

## If you do it — implementation plan (v1.5.0)

### 1. One-time, idempotent first-launch migration

New module `src-tauri/src/migrate.rs`, called early in the `lib.rs` setup hook
(before any state loads from disk):

```rust
pub fn migrate_data_dir() {
    let base = dirs::data_local_dir().unwrap_or_default();
    let old = base.join("PoPManager");
    let new = base.join("OverManager");
    // Idempotent: only migrate if new doesn't exist yet and old does.
    if new.exists() || !old.exists() {
        return;
    }
    // Copy (not move) so a crash mid-migration leaves the old dir intact.
    if let Err(e) = copy_dir_all(&old, &new) {
        log::error!("Data-dir migration failed: {} — falling back to old dir", e);
        return; // storage.rs should fall back to old path if new is absent
    }
    log::info!("Migrated data dir PoPManager -> OverManager");
}
```

- **Copy, don't move** — leaves `…\PoPManager\` as an automatic backup.
- **Idempotent** — guarded by `new.exists()`. Safe to run every launch
  (matches the project's idempotent-redundancy rule).

### 2. Switch storage paths with a fallback

Change the 12 `base.join("PoPManager")` call sites to a shared helper:

```rust
// in a shared module
pub fn app_data_root() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(/* exe fallback */);
    let new = base.join("OverManager");
    if new.exists() { new } else { base.join("PoPManager") }
}
```

Then replace `base.join("PoPManager").join("x.json")` with
`app_data_root().join("x.json")` everywhere. The fallback means: if migration
hasn't run or failed, reads/writes still hit the old dir — no data loss.

Files to update (the 12 `base.join("PoPManager")` sites):
storage.rs, commands/alerts.rs (×2), commands/pool_profiles.rs,
commands/coins.rs, commands/email.rs, commands/export.rs,
commands/mobile_miner.rs (×3), cloud/queue.rs, popminer_device.rs.

### 3. Optional: also rename the log file

`tauri-plugin-log` writes `popmanager.log` (lib.rs `file_name: "popmanager"`).
Renaming to `obmanager` orphans old logs (not user data). Low value; decide
separately.

## Test scenarios

- [ ] Fresh install (no old dir): app creates `…\OverManager\` directly, works.
- [ ] Upgrade from v1.4.0 with existing `…\PoPManager\` data: on first v1.5.0
      launch, data is copied to `…\OverManager\`, all miners/pools/alerts/coins
      load intact, `…\PoPManager\` remains as backup.
- [ ] Second launch: migration is a no-op (new dir exists), no duplicate copy.
- [ ] Simulated migration failure (make `…\OverManager\` unwritable): app logs
      the error and falls back to reading `…\PoPManager\` — no data loss.
- [ ] Cloud queue (`cloud_queue.db`, SQLite) survives the copy and continues
      draining.
- [ ] Auto-update v1.4.0 → v1.5.0 reaches the user (bundle identifier unchanged),
      confirming the two-step rebrand path works end-to-end.

## Do NOT

- Do NOT change the bundle identifier.
- Do NOT delete `…\PoPManager\` in the same release you add the migration —
  keep it one release as a safety net, prune in a later version if desired.
