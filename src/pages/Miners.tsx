import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MinerInfo, ScanResult } from "../types/miner";

export default function Miners() {
  const [scanning, setScanning] = useState(false);
  const [miners, setMiners] = useState<MinerInfo[]>([]);
  const [scanRange, setScanRange] = useState("192.168.1.0/24");
  const [lastScan, setLastScan] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    try {
      const result = await invoke<ScanResult>("scan_network", { cidr: scanRange });
      setMiners(result.found);
      setLastScan(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Network Scanner</h2>
        <p className="text-slate-400 mt-1">Discover Iceriver miners on your local network</p>
      </div>

      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6 mb-6">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              IP Range (CIDR)
            </label>
            <input
              type="text"
              value={scanRange}
              onChange={(e) => setScanRange(e.target.value)}
              className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary-500"
              placeholder="192.168.1.0/24"
            />
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {scanning ? "Scanning..." : "Scan Network"}
          </button>
        </div>
        {lastScan && (
          <p className="text-xs text-slate-500 mt-3">Last scan: {lastScan} · Found {miners.length} miner(s)</p>
        )}
      </div>

      {miners.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700/50">
              <tr className="text-slate-400">
                <th className="text-left px-6 py-3">IP Address</th>
                <th className="text-left px-6 py-3">Model</th>
                <th className="text-left px-6 py-3">Status</th>
                <th className="text-right px-6 py-3">Hashrate</th>
                <th className="text-right px-6 py-3">Temp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {miners.map((m) => (
                <tr key={m.ip} className="hover:bg-slate-800/50">
                  <td className="px-6 py-4 font-mono text-slate-300">{m.ip}</td>
                  <td className="px-6 py-4 text-slate-300">{m.model}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                      m.status === "online" ? "bg-emerald-500/20 text-emerald-400" :
                      m.status === "offline" ? "bg-red-500/20 text-red-400" :
                      "bg-amber-500/20 text-amber-400"
                    }`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-slate-300">
                    {(m.totalHashrate / 1000).toFixed(2)} TH/s
                  </td>
                  <td className="px-6 py-4 text-right text-slate-300">
                    {m.boards.length > 0 ? `${Math.max(...m.boards.map(b => b.temperature))}°C` : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
