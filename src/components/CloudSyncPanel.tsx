import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CloudStatus {
  connected: boolean;
  status: string;
  email: string | null;
  instanceName: string | null;
  instanceId: string | null;
  lastSync: number | null;
  queueSize: number;
}

export default function CloudSyncPanel() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showExistingLogin, setShowExistingLogin] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<CloudStatus>("cloud_status");
      setStatus(s);
    } catch (err) {
      console.error("Failed to get cloud status:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      await invoke("cloud_login", { email: email.trim(), password });
      setPassword("");
      await refresh();
    } catch (err) {
      setLoginError(String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    try {
      await invoke("cloud_logout");
      await refresh();
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }

  async function handleSaveName() {
    if (!newName.trim()) return;
    try {
      await invoke("cloud_update_instance_name", { name: newName.trim() });
      setEditingName(false);
      await refresh();
    } catch (err) {
      console.error("Failed to update name:", err);
    }
  }

  const isLoggedIn = status?.email != null;

  const statusColor: Record<string, string> = {
    connected: "bg-emerald-500",
    syncing: "bg-emerald-500 animate-pulse",
    connecting: "bg-amber-500",
    disconnected: "bg-slate-500",
    auth_required: "bg-red-500",
  };

  const statusLabel: Record<string, string> = {
    connected: "Connected",
    syncing: "Syncing",
    connecting: "Connecting",
    disconnected: "Disconnected",
    auth_required: "Re-login Required",
  };

  const rawStatus = status?.status?.split(":")[0] ?? "disconnected";

  return (
    <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-white">Cloud Sync</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Remote monitoring, push alerts, and a web dashboard — coming soon.
        </p>
      </div>

      {!isLoggedIn ? (
        !showExistingLogin ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 px-4 py-3 bg-dark-900 rounded-lg border border-primary-500/20">
              <svg
                className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-white">Coming soon</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Cloud sync will let you monitor your farm from a web dashboard
                  and get push alerts on your phone. We're putting the finishing
                  touches on it — your local setup keeps working in the meantime.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setLoginError(null);
                setShowExistingLogin(true);
              }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              I already have an account →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                placeholder="••••••••"
              />
            </div>
            {loginError && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {loginError}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={handleLogin}
                disabled={loggingIn || !email.trim() || !password.trim()}
                className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loggingIn ? "Signing in..." : "Sign In"}
              </button>
              <button
                onClick={() => {
                  setShowExistingLogin(false);
                  setLoginError(null);
                }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${statusColor[rawStatus] ?? "bg-slate-500"}`}
              />
              <span className="text-sm text-white font-medium">
                {statusLabel[rawStatus] ?? status?.status ?? "Unknown"}
              </span>
            </div>
            {status?.lastSync && (
              <span className="text-xs text-slate-500">
                Last sync: {new Date(status.lastSync).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Account */}
          <div className="bg-dark-900 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-400">Account</p>
            <p className="text-sm text-white">{status?.email}</p>
          </div>

          {/* Instance name */}
          <div className="bg-dark-900 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-400">Instance Name</p>
            {editingName ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                  className="flex-1 bg-dark-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-primary-500"
                  autoFocus
                />
                <button
                  onClick={handleSaveName}
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="text-xs text-slate-500 hover:text-slate-400"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-white">
                  {status?.instanceName || "My Farm"}
                </p>
                <button
                  onClick={() => {
                    setNewName(status?.instanceName || "");
                    setEditingName(true);
                  }}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Queue size warning */}
          {(status?.queueSize ?? 0) > 0 && (
            <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
              {status!.queueSize} item{status!.queueSize !== 1 ? "s" : ""}{" "}
              pending sync
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleLogout}
              className="text-xs text-red-400 hover:text-red-300 transition-colors ml-auto"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
