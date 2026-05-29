# v1.5 Coding Prompt: OverManager data-directory migration

> Paste the "SESSION PROMPT" block at the bottom into a fresh Claude Code
> session started in `L:\PoPManager`. The rest of this doc is the spec it
> references.

## Background (what shipped before)

- **v1.3.0** — last release under the **PoPManager** name (Proof of Prints).
- **v1.4.0** — rebrand to **OverManager** (company OverBuild Labs). All
  user-visible names/theme/icons changed, but **two internal identifiers were
  deliberately kept** so existing installs auto-update seamlessly with zero
  data loss:
  1. **Bundle identifier** `com.proofofprints.popmanager` (in `tauri.conf.json`).
     Permanent — changing it breaks the updater chain. Invisible to users.
     Governs the Tauri-managed dir `…\AppData\Local\com.proofofprints.popmanager\`
     (history.json, logs, webview cache).
  2. **Storage directory** `dirs::data_local_dir().join("PoPManager")` →
     `…\AppData\Local\PoPManager\`. Holds ALL user config: `miners.json`,
     `pool_profiles.json`, `alert_rules.json`, `alert_history.json`,
     `coins.json`, `smtp_config.json`, `mobile_miners.json`,
     `mobile_server_config.json`, `mobile_miner_commands.json`,
     `popminer_devices.json`, `cloud_queue.db`. Referenced via
     `base.join("PoPManager")` in **12 spots** across `src-tauri/src/`.

**v1.5.0 goal:** migrate the storage dir `…\PoPManager\` → `…\OverManager\`
so the on-disk footprint matches the brand. **The bundle identifier stays
`com.proofofprints.popmanager` forever** — do NOT touch it.

## ⚠️ Critical correctness rule: trigger on filesystem state, NOT version

Because **v1.4 never moved the data dir** (it still used `…\PoPManager\`),
every pre-v1.5 install — whether last on v1.2, v1.3, or v1.4 — has its data in
`…\PoPManager\`. Therefore the migration MUST key off directory existence, not
"what version was installed before":

- Migrate **iff** `…\PoPManager\` exists AND `…\OverManager\` does not.
- This makes **1.3 → 1.5 (skipping 1.4)** work identically to 1.3 → 1.4 → 1.5,
  and also covers 1.2 → 1.5, 1.4 → 1.5, etc.
- Auto-update reaches direct jumpers fine: the updater serves `latest`, semver
  allows non-sequential jumps, and the signing key/identifier are unchanged.

Do NOT gate the migration on `previous_version == "1.4.x"` or similar.

## Implementation

### 1. `src-tauri/src/migrate.rs` (new) — idempotent, copy-not-move

Call it **first thing** in the `lib.rs` setup hook, before any state loads:

```rust
use std::path::PathBuf;

pub fn migrate_data_dir() {
    let base = match dirs::data_local_dir() {
        Some(b) => b,
        None => return,
    };
    let old = base.join("PoPManager");
    let new = base.join("OverManager");

    // Idempotent + path-agnostic: only migrate when the old dir exists and the
    // new one doesn't. Never overwrite newer data with older.
    if new.exists() || !old.exists() {
        return;
    }
    match copy_dir_all(&old, &new) {
        Ok(_) => log::info!("Migrated data dir PoPManager -> OverManager"),
        Err(e) => {
            // Best-effort: if the copy fails, remove any partial new dir so the
            // app falls back to reading the intact old dir (see step 2).
            let _ = std::fs::remove_dir_all(&new);
            log::error!("Data-dir migration failed ({e}); falling back to old dir");
        }
    }
    // COPY, don't move — leaves …\PoPManager\ intact as a one-release backup.
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}
```

### 2. Shared path helper with fallback — replace the 12 `base.join("PoPManager")`

Add one helper (e.g. `src-tauri/src/paths.rs`) and route all storage paths
through it:

```rust
pub fn app_data_root() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    let new = base.join("OverManager");
    // Fallback: if migration hasn't run or failed, keep using the old dir so
    // there is never data loss.
    if new.exists() { new } else { base.join("PoPManager") }
}
```

Then change every `base.join("PoPManager").join("x.json")` to
`app_data_root().join("x.json")`. The 12 sites (grep `join("PoPManager")`):
`commands/storage.rs`, `commands/alerts.rs` (×2), `commands/pool_profiles.rs`,
`commands/coins.rs`, `commands/email.rs`, `commands/export.rs`,
`commands/mobile_miner.rs` (×3), `cloud/queue.rs`, `popminer_device.rs`.

### 3. Wire `migrate_data_dir()` into `lib.rs` setup

First line of the `.setup(|app| { ... })` closure (before tray/state/poller).

### 4. Bump version → 1.5.0

`tauri.conf.json` (the field the bundler reads), `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`. (v1.4.0 missed tauri.conf.json
once — don't repeat that.)

## Test scenarios (check each)

### Automatable
- [ ] `cargo check` + `npm run build` + `npx tsc --noEmit` pass
- [ ] Unit test `copy_dir_all` copies nested files + a SQLite file byte-for-byte
- [ ] Unit test: migration is a no-op when `…\OverManager\` already exists
- [ ] Unit test: `app_data_root()` returns new dir when it exists, old otherwise

### Manual — the upgrade matrix (the important part)
- [ ] **1.3 → 1.5 direct** (the skip case): install v1.3, add miners/pools/alerts,
      then auto-update (or install) v1.5 → data present in `…\OverManager\`,
      `…\PoPManager\` remains as backup, app fully functional
- [ ] **1.4 → 1.5**: same outcome
- [ ] **Fresh 1.5 install** (no old dir): creates `…\OverManager\` directly, works
- [ ] **Second launch of 1.5**: migration no-ops (new dir exists), no duplicate copy
- [ ] **Simulated copy failure** (make `…\OverManager\` unwritable): app logs error,
      falls back to `…\PoPManager\`, no data loss
- [ ] `cloud_queue.db` (SQLite) survives the copy and keeps draining to cloud
- [ ] Auto-update 1.3 → 1.5 actually offered + installs (validates the kept
      signing key + identifier across a version skip)

### Regression
- [ ] All v1.4 functionality intact (miners poll, alerts fire, cloud sync,
      OverMobile pairing, OverMiner discovery)

## Do NOT
- Do NOT change the bundle identifier (`com.proofofprints.popmanager`).
- Do NOT regenerate the updater signing key.
- Do NOT gate migration on a version check — key it on dir existence.
- Do NOT delete `…\PoPManager\` in v1.5 — keep it one release as a backup; a
  later version can prune it.
- Do NOT rename the GitHub repo/org references or the log file name in this pass.

## Release
Same flow as v1.4.0: merge to `main`, tag `v1.5.0`, push tag → release CI builds
+ signs + creates a **draft**. Apply notes, verify artifacts + `latest.json`,
hand back unpublished for the user to publish.

---

## SESSION PROMPT (paste into a fresh session in `L:\PoPManager`)

```
Implement v1.5.0 of OverManager (Tauri/Rust + React desktop app): a one-time,
idempotent data-directory migration from …\AppData\Local\PoPManager\ to
…\AppData\Local\OverManager\.

Read thoughts/HANDOFF_OVERMANAGER_DATADIR_MIGRATION.md first — it's the full
spec, including the critical correctness rule and the test matrix.

Key constraints:
- Trigger migration on FILESYSTEM STATE (old dir exists, new doesn't), never on
  a version check — this is what makes 1.3→1.5 (skipping 1.4) work the same as
  1.4→1.5.
- COPY (don't move) so …\PoPManager\ stays as a one-release backup; fall back to
  the old dir if the copy fails (no data loss, ever).
- Do NOT touch: the bundle identifier com.proofofprints.popmanager, the updater
  signing key/endpoint, GitHub URLs, or the log file name.
- Route all 12 base.join("PoPManager") sites through one app_data_root() helper
  with the new-dir-or-fallback logic.
- Bump version to 1.5.0 in tauri.conf.json, package.json, Cargo.toml, Cargo.lock
  (don't miss tauri.conf.json — that's the one the bundler reads).

Workflow: small commits on a branch; build (npm run build + cargo check, and
npm run tauri build when feasible) before committing. The user runs dev builds
locally and installs the MSI to verify — so verify by automated tests + code
review, and ask them to paste DB/log/dir state when you need to confirm runtime
behavior (your tools can't see writes from the unsandboxed dev binary). Work
through the test matrix in the doc and check items off. Do not merge to main or
publish a release until the user confirms the upgrade matrix — especially the
1.3 → 1.5 direct path — works on their machine.
```
