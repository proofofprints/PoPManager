import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { MobileMiner, MobileCommand } from "../types/miner";

function formatHashrate(hs: number): string {
  if (hs >= 1e9) return `${(hs / 1e9).toFixed(2)} GH/s`;
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`;
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(2)} KH/s`;
  return `${hs.toFixed(0)} H/s`;
}

export default function MobileMinerDetail() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const [miner, setMiner] = useState<MobileMiner | null>(null);
  const [commands, setCommands] = useState<MobileCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialised, setInitialised] = useState(false);

  // Editable config form
  const [poolUrl, setPoolUrl] = useState("");
  const [wallet, setWallet] = useState("");
  const [worker, setWorker] = useState("");
  const [threads, setThreads] = useState<number>(1);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Remove device modal state
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    try {
      const all = await invoke<MobileMiner[]>("get_mobile_miners");
      const m = all.find((x) => x.deviceId === deviceId) ?? null;
      setMiner(m);
      if (m && !initialised) {
        setPoolUrl(m.pool || "");
        const parts = (m.worker || "").split(".");
        setWallet(parts[0] || "");
        setWorker(parts[1] || "");
        setThreads(m.threads || 1);
        setInitialised(true);
      }
      const cmds = await invoke<MobileCommand[]>("get_mobile_commands", {
        deviceId,
      });
      setCommands(cmds);
    } catch (err) {
      console.error("Failed to refresh mobile miner detail:", err);
    } finally {
      setLoading(false);
    }
  }, [deviceId, initialised]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function queueCommand(type: string, params?: Record<string, any>) {
    if (!deviceId) return;
    setActionMsg(null);
    try {
      await invoke<MobileCommand>("queue_mobile_command", {
        deviceId,
        commandType: type,
        params: params ?? null,
      });
      setActionMsg(`${type} command queued`);
      await refresh();
    } catch (err) {
      setActionMsg(`Error: ${err}`);
    }
  }

  async function applyConfig() {
    await queueCommand("set_config", {
      poolUrl,
      wallet,
      worker,
      threads,
    });
  }

  async function clearHistory() {
    if (!deviceId) return;
    await invoke("clear_mobile_command_history", { deviceId });
    await refresh();
  }

  async function cancelCommand(id: string) {
    if (!deviceId) return;
    await invoke("cancel_mobile_command", { deviceId, commandId: id });
    await refresh();
  }

  async function handleRemove() {
    if (!deviceId || !miner) return;
    setRemoving(true);
    try {
      try {
        await invoke("queue_mobile_command", {
          deviceId,
          commandType: "stop",
          params: null,
        });
      } catch (err) {
        console.warn("Failed to queue stop command:", err);
      }
      try {
        await invoke("queue_mobile_command", {
          deviceId,
          commandType: "set_config",
          params: { poolUrl: "", wallet: "", worker: "", threads: 0 },
        });
      } catch (err) {
        console.warn("Failed to queue set_config command:", err);
      }
      await invoke("remove_mobile_miner", { deviceId });
      navigate("/mobile-miners");
    } catch (err) {
      console.error("Failed to remove device:", err);
      setRemoveError(String(err));
    } finally {
      setRemoving(false);
    }
  }

  if (loading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!miner)
    return (
      <div className="p-8">
        <button
          onClick={() => navigate("/mobile-miners")}
          className="text-sm text-slate-400 hover:text-white mb-4"
        >
          ← Back to Mobile Miners
        </button>
        <p className="text-slate-400">Mobile miner not found.</p>
      </div>
    );

  const pending = commands.filter((c) => c.status === "pending");
  const history = commands.filter((c) => c.status !== "pending").slice(0, 20);

  return (
    <div className="p-8 max-w-4xl">
      <button
        onClick={() => navigate("/mobile-miners")}
        className="text-sm text-slate-400 hover:text-white mb-4"
      >
        ← Back to Mobile Miners
      </button>

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">{miner.name}</h2>
        <p className="text-slate-400">
          {miner.deviceModel} · {miner.osVersion} · v{miner.appVersion}
        </p>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-4">
          <p className="text-xs text-slate-400">Hashrate</p>
          <p className="text-lg font-bold text-white">
            {formatHashrate(miner.hashrateHs)}
          </p>
        </div>
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-4">
          <p className="text-xs text-slate-400">Status</p>
          <p className="text-lg font-bold text-white capitalize">
            {miner.isOnline ? miner.status : "offline"}
          </p>
        </div>
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-4">
          <p className="text-xs text-slate-400">Battery</p>
          <p className="text-lg font-bold text-white">
            {miner.batteryLevel}% {miner.batteryCharging ? "⚡" : ""}
          </p>
        </div>
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-4">
          <p className="text-xs text-slate-400">CPU Temp</p>
          <p className="text-lg font-bold text-white">
            {miner.cpuTemp.toFixed(1)}°C
          </p>
        </div>
      </div>

      {/* Remote Control */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4">Remote Control</h3>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => queueCommand("start")}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg"
          >
            Start
          </button>
          <button
            onClick={() => queueCommand("stop")}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg"
          >
            Stop
          </button>
          <button
            onClick={() => queueCommand("restart")}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg"
          >
            Restart
          </button>
        </div>

        <h4 className="text-sm font-medium text-slate-300 mb-3">Configuration</h4>
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Pool URL</label>
            <input
              value={poolUrl}
              onChange={(e) => setPoolUrl(e.target.value)}
              className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              placeholder="stratum+tcp://pool.proofofprints.com:5558"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Wallet</label>
              <input
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="kaspa:qyp..."
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Worker Name</label>
              <input
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="pixel9"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Threads</label>
            <input
              type="number"
              min={1}
              max={16}
              value={threads}
              onChange={(e) => setThreads(Number(e.target.value))}
              className="w-24 bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={applyConfig}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg"
          >
            Apply Configuration
          </button>
          <button
            onClick={() => queueCommand("set_threads", { threads })}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg"
          >
            Update Threads Only
          </button>
        </div>
        {actionMsg && (
          <p className="text-xs text-amber-400 mt-3">{actionMsg}</p>
        )}
      </div>

      {/* Pending Commands */}
      {pending.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">
            Pending Commands ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-dark-900 rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm text-white font-mono">{c.type}</p>
                  {c.params && (
                    <p className="text-xs text-slate-500">
                      {JSON.stringify(c.params)}
                    </p>
                  )}
                  <p className="text-xs text-slate-600">
                    queued {new Date(c.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => cancelCommand(c.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Command History */}
      {history.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-white">Command History</h3>
            <button
              onClick={clearHistory}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear
            </button>
          </div>
          <div className="space-y-2">
            {history.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-dark-900 rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm text-white font-mono">{c.type}</p>
                  {c.error && (
                    <p className="text-xs text-red-400">{c.error}</p>
                  )}
                  <p className="text-xs text-slate-600">
                    {new Date(c.ackedAt ?? c.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    c.status === "applied"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="bg-dark-800 rounded-xl border border-red-900/40 p-6 mt-6">
        <h3 className="text-lg font-semibold text-red-400 mb-1">Danger Zone</h3>
        <p className="text-xs text-slate-500 mb-4">
          Remove this device from PoPManager. A cleanup sequence will be queued before deletion.
        </p>
        <button
          onClick={() => { setRemoveError(null); setShowRemoveModal(true); }}
          className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-300 text-sm font-medium rounded-lg transition-colors"
        >
          Remove Device
        </button>
      </div>

      {showRemoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!removing) { setShowRemoveModal(false); setRemoveError(null); } }}
          />
          <div className="relative z-10 bg-dark-800 border border-red-900/40 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-3">Remove {miner.name}?</h3>
            <div className="text-sm text-slate-300 space-y-3 mb-5">
              <p>This will perform the following steps:</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-400">
                <li>
                  Queue a <code className="text-amber-400">stop</code> command to halt mining
                </li>
                <li>
                  Queue a <code className="text-amber-400">set_config</code> command to clear pool URL, wallet, and worker
                </li>
                <li>Remove the device from PoPManager's local registry</li>
              </ol>
              <p className="text-amber-400 text-xs border-l-2 border-amber-500/50 pl-3">
                <strong>Note:</strong> The cleanup commands are only delivered if the device is currently online.
                If the device is still configured to report to this PoPManager instance, it will re-register automatically
                on its next report. To permanently remove it, first change or clear the server URL in the PoPMobile app.
              </p>
            </div>
            {removeError && (
              <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {removeError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowRemoveModal(false); setRemoveError(null); }}
                disabled={removing}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
              >
                {removing ? "Removing..." : "Remove Device"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
