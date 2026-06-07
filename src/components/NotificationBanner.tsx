import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";

/**
 * Warns when Windows notifications are turned off for OverManager. When the
 * per-app or system toggle is OFF, toasts silently never appear — this banner
 * surfaces that and deep-links to the Windows notification settings page.
 *
 * Renders nothing while notifications are enabled (or status can't be read).
 */
export default function NotificationBanner() {
  const [status, setStatus] = useState<string>("enabled");

  const check = useCallback(async () => {
    try {
      const s = await invoke<string>("get_notification_status");
      setStatus(s);
    } catch (err) {
      console.error("Failed to query notification status:", err);
      setStatus("enabled"); // fail open — don't nag on an unexpected error
    }
  }, []);

  useEffect(() => {
    check();
    // Re-check when the user returns to the window (e.g. after toggling the
    // setting in the Windows Settings app).
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [check]);

  // "unknown" is treated as enabled to avoid false warnings.
  if (status === "enabled" || status === "unknown") return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 mb-4 bg-amber-900/20 border border-amber-700/40 rounded-lg">
      <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-300">
          Windows notifications are off for OverManager — desktop alerts won't appear
        </p>
        <p className="text-xs text-amber-400/80 mt-1">
          Turn notifications back on in Windows Settings so alert toasts are delivered.
        </p>
        <button
          onClick={() => openUrl("ms-settings:notifications")}
          className="mt-2 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 text-amber-200 text-xs font-medium rounded-lg transition-colors"
        >
          Open Windows notification settings
        </button>
      </div>
    </div>
  );
}
