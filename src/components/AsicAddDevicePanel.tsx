import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MinerInfo, ScanResult, SavedMiner } from "../types/miner";

interface AsicAddDevicePanelProps {
  onClose?: () => void;
  onMinersAdded?: () => void;
}

export default function AsicAddDevicePanel({ onClose, onMinersAdded }: AsicAddDevicePanelProps) {
  const [scanning, setScanning] = useState(false);
  const [scannedMiners, setScannedMiners] = useState<MinerInfo[]>([]);
  const [scanRange, setScanRange] = useState("192.168.1.0/24");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [subnetDetected, setSubnetDetected] = useState(false);

  const [savedMiners, setSavedMiners] = useState<SavedMiner[]>([]);
  const [addIp, setAddIp] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addWattage, setAddWattage] = useState(100);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());

  useEffect(() => {
    invoke<SavedMiner[]>("get_saved_miners").then(setSavedMiners).catch(console.error);
    invoke<string>("get_local_subnet")
      .then((subnet) => {
        setScanRange(subnet);
        setSubnetDetected(true);
      })
      .catch(() => {
        // Fall back to default — no-op
      });
  }, []);

  async function handleScan() {
    setScanning(true);
    try {
      const result = await invoke<ScanResult>("scan_network", { cidr: scanRange });
      setScannedMiners(result.found);
      setLastScan(new Date().toLocaleTimeString());
      setSelectedIps(new Set());
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setScanning(false);
    }
  }

  async function handleAddMiner() {
    const ip = addIp.trim();
    if (!ip) return;
    setAdding(true);
    setAddError(null);
    try {
      // Verify reachable first and detect manufacturer
      const info = await invoke<MinerInfo>("get_miner_status", { ip, manufacturer: null });
      const updated = await invoke<SavedMiner[]>("add_miner", {
        ip,
        label: addLabel.trim() || null,
        coinId: "kaspa",
        wattage: addWattage,
        manufacturer: info.manufacturer || null,
      });
      setSavedMiners(updated);
      setAddIp("");
      setAddLabel("");
      setAddWattage(100);
      onMinersAdded?.();
    } catch (err) {
      setAddError(`Could not reach miner at ${ip}`);
    } finally {
      setAdding(false);
    }
  }

  async function handleAddMinersFromScan() {
    const ips =
      selectedIps.size > 0
        ? Array.from(selectedIps)
        : scannedMiners.map((m) => m.ip);
    if (!ips.length) return;
    try {
      const manufacturers = ips.map((ip) => scannedMiners.find((m) => m.ip === ip)?.manufacturer ?? "");
      const updated = await invoke<SavedMiner[]>("import_from_scan", { ips, manufacturers, coinId: "kaspa" });
      setSavedMiners(updated);
      setSelectedIps(new Set());
      // Update wattages for newly imported miners from scan data
      for (const ip of ips) {
        const scanned = scannedMiners.find((m) => m.ip === ip);
        if (scanned?.defaultWattage) {
          invoke("update_miner_wattage", { ip, wattage: scanned.defaultWattage }).catch(console.error);
        }
      }
      onMinersAdded?.();
    } catch (err) {
      console.error("Import failed:", err);
    }
  }

  const unsavedMiners = scannedMiners.filter(
    (m) => !savedMiners.some((s) => s.ip === m.ip)
  );
  const allUnsavedSelected =
    unsavedMiners.length > 0 && unsavedMiners.every((m) => selectedIps.has(m.ip));

  function toggleSelectAll() {
    if (allUnsavedSelected) {
      setSelectedIps(new Set());
    } else {
      setSelectedIps(new Set(unsavedMiners.map((m) => m.ip)));
    }
  }

  function toggleSelect(ip: string) {
    setSelectedIps((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) {
        next.delete(ip);
      } else {
        next.add(ip);
      }
      return next;
    });
  }

  return (
    <div className="bg-dark-800 rounded-xl border border-primary-500/30 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Add ASIC Miners</h3>
          <p className="text-xs text-slate-500 mt-0.5">Scan your network or add a miner manually by IP.</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 -mr-1 -mt-1"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-6">
        {/* Add Miner Manually */}
        <div className="bg-dark-900 rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Add Miner Manually
          </h4>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-slate-400 mb-1">IP Address</label>
              <input
                type="text"
                value={addIp}
                onChange={(e) => setAddIp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddMiner()}
                className="w-full bg-dark-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                placeholder="192.168.1.100"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Label <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddMiner()}
                className="w-full bg-dark-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                placeholder="KS0_1"
              />
            </div>
            <div className="min-w-[100px]">
              <label className="block text-xs font-medium text-slate-400 mb-1">Wattage (W)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={addWattage}
                onChange={(e) => setAddWattage(parseFloat(e.target.value) || 100)}
                className="w-full bg-dark-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                placeholder="100"
              />
            </div>
            <button
              onClick={handleAddMiner}
              disabled={adding || !addIp.trim()}
              className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {adding ? "Adding..." : "Add Miner"}
            </button>
          </div>
          {addError && <p className="text-red-400 text-xs mt-2">{addError}</p>}
        </div>

        {/* Network Scanner */}
        <div className="bg-dark-900 rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Network Scanner
          </h4>
          <p className="text-slate-400 text-xs mb-4">Discover ASIC miners on your local network</p>
          <div className="flex gap-4 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                IP Range (CIDR)
                {subnetDetected && (
                  <span className="ml-2 text-emerald-400 font-normal">· auto-detected</span>
                )}
              </label>
              <input
                type="text"
                value={scanRange}
                onChange={(e) => { setScanRange(e.target.value); setSubnetDetected(false); }}
                className="w-full bg-dark-800 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                placeholder="192.168.1.0/24"
              />
            </div>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {scanning ? "Scanning..." : "Scan Network"}
            </button>
          </div>
          {lastScan && (
            <p className="text-xs text-slate-500 mt-3">
              Last scan: {lastScan} · Found {scannedMiners.length} miner(s)
            </p>
          )}
        </div>

        {/* Scan Results */}
        {scannedMiners.length > 0 && (
          <div className="bg-dark-900 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
              <button
                onClick={handleAddMinersFromScan}
                className={`px-4 py-1.5 text-white text-xs font-medium rounded-lg transition-colors ${
                  selectedIps.size > 0
                    ? "bg-purple-600 hover:bg-purple-700"
                    : "bg-primary-600 hover:bg-primary-700"
                }`}
              >
                {selectedIps.size > 0
                  ? `Add Selected (${selectedIps.size}) to be Monitored`
                  : "Add All to be Monitored"}
              </button>
              <span className="text-sm font-semibold text-slate-300">
                Scan Results ({scannedMiners.length})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700/50">
                  <tr className="text-slate-400">
                    <th className="text-center px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allUnsavedSelected}
                        onChange={toggleSelectAll}
                        disabled={unsavedMiners.length === 0}
                        className="cursor-pointer accent-purple-500"
                        title="Select all unsaved"
                      />
                    </th>
                    <th className="text-left px-4 py-3">IP / Host</th>
                    <th className="text-left px-4 py-3">Model</th>
                    <th className="text-left px-4 py-3">Manufacturer</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-right px-4 py-3">Hashrate</th>
                    <th className="text-right px-4 py-3">Temp °C</th>
                    <th className="text-right px-4 py-3">Fan RPM</th>
                    <th className="text-left px-4 py-3">Pool</th>
                    <th className="text-right px-4 py-3">Accepted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {scannedMiners.map((m) => {
                    const maxInTmp = m.boards.length
                      ? Math.max(...m.boards.map((b) => b.inTmp))
                      : null;
                    const activeFan = m.fans.find((f) => f > 0);
                    const activePool = m.pools.find((p) => p.connect);
                    const alreadySaved = savedMiners.some((s) => s.ip === m.ip);
                    return (
                      <tr key={m.ip} className="hover:bg-slate-800/50">
                        <td className="px-4 py-3 text-center">
                          {alreadySaved ? (
                            <span className="text-xs text-slate-500">Saved</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={selectedIps.has(m.ip)}
                              onChange={() => toggleSelect(m.ip)}
                              className="cursor-pointer accent-purple-500"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-slate-300">{m.ip}</span>
                          {m.hostname && (
                            <span className="block text-xs text-slate-500">{m.hostname}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-300">{m.model}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs capitalize">{m.manufacturer || "--"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                              m.online
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {m.rtHashrate} {m.hashrateUnit}H/s
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {maxInTmp !== null ? `${maxInTmp}°` : "--"}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {activeFan ?? "--"}
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-xs">
                          <span className="truncate block text-xs">
                            {activePool?.addr ?? "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {activePool?.accepted.toLocaleString() ?? "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
