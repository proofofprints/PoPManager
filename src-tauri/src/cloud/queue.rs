use rusqlite::{params, Connection};
use std::path::PathBuf;

fn queue_db_path() -> PathBuf {
    crate::paths::app_data_root().join("cloud_queue.db")
}

pub fn open_queue() -> Result<Connection, String> {
    let path = queue_db_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open cloud queue DB: {}", e))?;

    // Enable WAL mode for better concurrent access
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    // Create table if not exists. The CHECK constraint allows the kinds the
    // sync loop currently knows how to push.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_sync_queue (
            id              INTEGER PRIMARY KEY,
            kind            TEXT NOT NULL CHECK (kind IN ('snapshot', 'alert', 'miners')),
            payload_json    TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            attempts        INTEGER NOT NULL DEFAULT 0,
            last_attempt_at INTEGER,
            last_error      TEXT
        );
        CREATE INDEX IF NOT EXISTS cloud_sync_queue_created_idx
            ON cloud_sync_queue(created_at);"
    ).map_err(|e| format!("Failed to create queue table: {}", e))?;

    // Migration: older installs created the table with a CHECK that allowed
    // only ('snapshot', 'alert'). SQLite can't ALTER a CHECK constraint, so
    // rebuild the table when the existing definition doesn't include 'miners'.
    let existing_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='cloud_sync_queue'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();
    if !existing_sql.is_empty() && !existing_sql.contains("'miners'") {
        log::info!("Cloud queue: migrating CHECK constraint to allow 'miners' kind");
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE cloud_sync_queue_new (
                 id              INTEGER PRIMARY KEY,
                 kind            TEXT NOT NULL CHECK (kind IN ('snapshot', 'alert', 'miners')),
                 payload_json    TEXT NOT NULL,
                 created_at      INTEGER NOT NULL,
                 attempts        INTEGER NOT NULL DEFAULT 0,
                 last_attempt_at INTEGER,
                 last_error      TEXT
             );
             INSERT INTO cloud_sync_queue_new
                 (id, kind, payload_json, created_at, attempts, last_attempt_at, last_error)
                 SELECT id, kind, payload_json, created_at, attempts, last_attempt_at, last_error
                 FROM cloud_sync_queue;
             DROP TABLE cloud_sync_queue;
             ALTER TABLE cloud_sync_queue_new RENAME TO cloud_sync_queue;
             CREATE INDEX IF NOT EXISTS cloud_sync_queue_created_idx
                 ON cloud_sync_queue(created_at);
             COMMIT;",
        )
        .map_err(|e| format!("Failed to migrate queue table: {}", e))?;
    }

    Ok(conn)
}

pub fn enqueue(kind: &str, payload: &serde_json::Value) -> Result<(), String> {
    let conn = open_queue()?;
    let now = chrono::Utc::now().timestamp();
    let json = serde_json::to_string(payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    conn.execute(
        "INSERT INTO cloud_sync_queue (kind, payload_json, created_at) VALUES (?1, ?2, ?3)",
        params![kind, json, now],
    ).map_err(|e| format!("Failed to enqueue: {}", e))?;

    Ok(())
}

/// Fetch the oldest N pending items from the queue
pub fn peek(limit: u32) -> Result<Vec<QueueItem>, String> {
    let conn = open_queue()?;
    let mut stmt = conn
        .prepare("SELECT id, kind, payload_json, created_at, attempts, last_error
                  FROM cloud_sync_queue ORDER BY created_at ASC LIMIT ?1")
        .map_err(|e| format!("Failed to prepare peek query: {}", e))?;

    let items = stmt
        .query_map(params![limit], |row| {
            Ok(QueueItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload_json: row.get(2)?,
                created_at: row.get(3)?,
                attempts: row.get(4)?,
                last_error: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to peek queue: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Remove a successfully synced item
pub fn remove(id: i64) -> Result<(), String> {
    let conn = open_queue()?;
    conn.execute("DELETE FROM cloud_sync_queue WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to remove queue item: {}", e))?;
    Ok(())
}

/// Mark a failed attempt
pub fn mark_failed(id: i64, error: &str) -> Result<(), String> {
    let conn = open_queue()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE cloud_sync_queue SET attempts = attempts + 1, last_attempt_at = ?1, last_error = ?2 WHERE id = ?3",
        params![now, error, id],
    ).map_err(|e| format!("Failed to mark failed: {}", e))?;
    Ok(())
}

/// Drop items that have exceeded retry limits or are too old
pub fn prune() -> Result<u64, String> {
    let conn = open_queue()?;
    let now = chrono::Utc::now().timestamp();
    let snapshot_cutoff = now - (30 * 24 * 3600); // 30 days
    let alert_cutoff = now - (90 * 24 * 3600);    // 90 days

    let mut total = 0u64;

    // Prune old snapshots
    total += conn.execute(
        "DELETE FROM cloud_sync_queue WHERE kind = 'snapshot' AND created_at < ?1",
        params![snapshot_cutoff],
    ).map_err(|e| format!("Failed to prune snapshots: {}", e))? as u64;

    // Prune old alerts
    total += conn.execute(
        "DELETE FROM cloud_sync_queue WHERE kind = 'alert' AND created_at < ?1",
        params![alert_cutoff],
    ).map_err(|e| format!("Failed to prune alerts: {}", e))? as u64;

    // Prune items with too many permanent failures (5+ attempts on 4xx errors)
    total += conn.execute(
        "DELETE FROM cloud_sync_queue WHERE attempts >= 5 AND last_error LIKE '%(4%'",
        [],
    ).map_err(|e| format!("Failed to prune failed items: {}", e))? as u64;

    if total > 0 {
        log::info!("Cloud queue: pruned {} stale/failed items", total);
    }

    Ok(total)
}

/// Get the number of pending items
pub fn count() -> Result<u64, String> {
    let conn = open_queue()?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cloud_sync_queue", [], |row| row.get(0))
        .map_err(|e| format!("Failed to count queue: {}", e))?;
    Ok(count as u64)
}

/// Get approximate queue size in bytes
pub fn size_bytes() -> Result<u64, String> {
    let path = queue_db_path();
    if path.exists() {
        std::fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to get queue size: {}", e))
    } else {
        Ok(0)
    }
}

/// Delete the entire queue database (used on sign-out)
pub fn delete_queue_db() -> Result<(), String> {
    let path = queue_db_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete queue DB: {}", e))?;
    }
    // Also remove WAL and SHM files
    let wal = path.with_extension("db-wal");
    let shm = path.with_extension("db-shm");
    let _ = std::fs::remove_file(wal);
    let _ = std::fs::remove_file(shm);
    Ok(())
}

#[derive(Debug)]
pub struct QueueItem {
    pub id: i64,
    pub kind: String,
    pub payload_json: String,
    pub created_at: i64,
    pub attempts: u32,
    pub last_error: Option<String>,
}
