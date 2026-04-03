import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PoolConfig } from "../types/miner";

export default function Settings() {
  const [pool, setPool] = useState<PoolConfig>({
    url: "",
    user: "",
    password: "x",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await invoke("configure_pool", { config: pool });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Configure failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <p className="text-slate-400 mt-1">Configure pool and application settings</p>
      </div>

      <div className="max-w-2xl">
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Pool Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Pool URL</label>
              <input
                type="text"
                value={pool.url}
                onChange={(e) => setPool({ ...pool, url: e.target.value })}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary-500"
                placeholder="stratum+tcp://pool.example.com:3333"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Worker / Username</label>
              <input
                type="text"
                value={pool.user}
                onChange={(e) => setPool({ ...pool, user: e.target.value })}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary-500"
                placeholder="wallet.worker1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <input
                type="text"
                value={pool.password}
                onChange={(e) => setPool({ ...pool, password: e.target.value })}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary-500"
                placeholder="x"
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Apply to All Miners"}
          </button>
        </div>

        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">About</h3>
          <div className="space-y-2 text-sm text-slate-400">
            <p><span className="text-slate-300">Application:</span> PoPManager v0.1.0</p>
            <p><span className="text-slate-300">By:</span> Proof of Prints</p>
            <p><span className="text-slate-300">License:</span> MIT</p>
            <p><span className="text-slate-300">Supported Hardware:</span> Iceriver KS0</p>
          </div>
        </div>
      </div>
    </div>
  );
}
