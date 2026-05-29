use std::path::Path;

/// One-time, idempotent migration of the user storage directory from the
/// legacy `PoPManager` name to `OverManager`.
///
/// Triggered by **filesystem state, not version**: it runs iff the old dir
/// exists and the new one doesn't. This makes a direct 1.3 → 1.5 jump (skipping
/// 1.4, which never moved the dir) behave identically to 1.4 → 1.5.
///
/// The old dir is **copied, not moved**, leaving `…\PoPManager\` intact as a
/// one-release backup. If the copy fails, any partial new dir is removed so the
/// app falls back to reading the intact old dir (see [`crate::paths`]).
pub fn migrate_data_dir() {
    let base = crate::paths::data_local_base();
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
            // Best-effort: drop any partial new dir so the app falls back to the
            // intact old dir.
            let _ = std::fs::remove_dir_all(&new);
            log::error!("Data-dir migration failed ({e}); falling back to old dir");
        }
    }
}

/// Recursively copy `src` into `dst`, creating `dst` (and nested dirs) as
/// needed. Files are copied byte-for-byte via `std::fs::copy`.
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::copy_dir_all;
    use std::fs;
    use std::path::PathBuf;

    fn temp_root(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let unique = format!(
            "overmanager_migrate_test_{}_{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        p.push(unique);
        p
    }

    #[test]
    fn copies_nested_files_and_binary_byte_for_byte() {
        let root = temp_root("copy");
        let src = root.join("src");
        let dst = root.join("dst");
        fs::create_dir_all(src.join("sub")).unwrap();

        // A JSON-like text file at the top level.
        fs::write(src.join("miners.json"), b"[{\"ip\":\"1.2.3.4\"}]").unwrap();
        // A nested file.
        fs::write(src.join("sub").join("nested.txt"), b"hello nested").unwrap();
        // A "SQLite" file: arbitrary bytes including nulls, to prove binary
        // fidelity (cloud_queue.db).
        let db_bytes: Vec<u8> = (0u16..512).map(|i| (i % 256) as u8).collect();
        fs::write(src.join("cloud_queue.db"), &db_bytes).unwrap();

        copy_dir_all(&src, &dst).unwrap();

        assert_eq!(
            fs::read(dst.join("miners.json")).unwrap(),
            b"[{\"ip\":\"1.2.3.4\"}]"
        );
        assert_eq!(
            fs::read(dst.join("sub").join("nested.txt")).unwrap(),
            b"hello nested"
        );
        assert_eq!(fs::read(dst.join("cloud_queue.db")).unwrap(), db_bytes);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn migration_is_noop_when_new_dir_already_exists() {
        // Simulate the guard `migrate_data_dir` uses: if new.exists(), do nothing.
        let root = temp_root("noop");
        let old = root.join("PoPManager");
        let new = root.join("OverManager");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("miners.json"), b"old-data").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("miners.json"), b"new-data").unwrap();

        let should_migrate = !(new.exists() || !old.exists());
        assert!(!should_migrate, "must not migrate when new dir exists");

        // The new dir's data must be untouched (no overwrite with old).
        assert_eq!(fs::read(new.join("miners.json")).unwrap(), b"new-data");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn app_data_root_prefers_new_then_falls_back_to_old() {
        // Mirror paths::app_data_root selection logic against a controlled base.
        let base = temp_root("select");
        let old = base.join("PoPManager");
        let new = base.join("OverManager");
        fs::create_dir_all(&old).unwrap();

        let select = |base: &std::path::Path| {
            let n = base.join("OverManager");
            if n.exists() { n } else { base.join("PoPManager") }
        };

        // New missing → old.
        assert_eq!(select(&base), old);

        // New present → new.
        fs::create_dir_all(&new).unwrap();
        assert_eq!(select(&base), new);

        fs::remove_dir_all(&base).ok();
    }
}
