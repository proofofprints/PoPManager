import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PoolSlot } from "../types/miner";

const defaultPools: PoolSlot[] = [
  { no: 1, addr: "", user: "", pass: "x" },
  { no: 2, addr: "", user: "", pass: "x" },
  { no: 3, addr: "", user: "", pass: "x" },
];

export default function Settings() {
  const [pools, setPools] = useState<PoolSlot[]>(defaultPools);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updatePool(no: number, field: keyof PoolSlot, value: string) {
    setPools((prev) =>
      prev.map((p) => (p.no === no ? { ...p, [field]: value } : p))
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await invoke("configure_pool", { ip: "", pools });
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

      <div className="max-w-2xl space-y-6">
        {/* Pool Configuration */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Pool Configuration</h3>
          <div className="space-y-6">
            {pools.map((pool) => (
              <div key={pool.no} className="border border-slate-700/40 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-300 mb-3">Pool {pool.no}</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Address</label>
                    <input
                      type="text"
                      value={pool.addr}
                      onChange={(e) => updatePool(pool.no, "addr", e.target.value)}
                      className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                      placeholder="stratum+tcp://pool.example.com:3333"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Worker / Username</label>
                    <input
                      type="text"
                      value={pool.user}
                      onChange={(e) => updatePool(pool.no, "user", e.target.value)}
                      className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                      placeholder="wallet.worker1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Password</label>
                    <input
                      type="text"
                      value={pool.pass}
                      onChange={(e) => updatePool(pool.no, "pass", e.target.value)}
                      className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                      placeholder="x"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Apply to All Miners"}
          </button>
        </div>

        {/* About Section */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <h3 className="text-lg font-semibold text-white mb-5">About</h3>

          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-700/50">
            {/* Logo placeholder — replace with <img src="/pop-icon.png"> when asset is available */}
            <div className="w-14 h-14 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <div>
              <h4 className="text-xl font-bold text-white">PoPManager</h4>
              <p className="text-sm text-primary-400 font-medium">v0.1.0</p>
              <p className="text-xs text-slate-500 mt-0.5">Open-source ASIC miner management</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Created by</span>
              <span className="text-slate-200 font-medium">Proof of Prints</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Support</span>
              <a
                href="mailto:support@proofofprints.com"
                className="text-primary-400 hover:text-primary-300 transition-colors"
              >
                support@proofofprints.com
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">License</span>
              <span className="text-slate-200">MIT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Supported Hardware</span>
              <span className="text-slate-200">Iceriver KS0 / KS0 Pro / KS0 Ultra</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="text-slate-500">GitHub</span>
              <span className="text-slate-500 text-xs italic">Coming soon</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
