import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MinerInfo, ScanResult, SavedMiner, CoinConfig } from "../types/miner";


export default function Monitoring() {
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

  const [editingIp, setEditingIp] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());

  const [coins, setCoins] = useState<CoinConfig[]>([]);

  const [savedSearch, setSavedSearch] = useState("");
  const [savedFilterCoin, setSavedFilterCoin] = useState("all");

  useEffect(() => {
    invoke<SavedMiner[]>("get_saved_miners").then(setSavedMiners).catch(console.error);
    invoke<CoinConfig[]>("get_coins").then(setCoins).catch(console.error);
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
      // Verify reachable first
      await invoke("get_miner_status", { ip });
      const updated = await invoke<SavedMiner[]>("add_miner", {
        ip,
        label: addLabel.trim() || null,
        coinId: "other",
        wattage: addWattage,
      });
      setSavedMiners(updated);
      setAddIp("");
      setAddLabel("");
      setAddWattage(100);
    } catch (err) {
      setAddError(`Could not reach miner at ${ip}`);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(ip: string) {
    try {
      const updated = await invoke<SavedMiner[]>("remove_miner", { ip });
      setSavedMiners(updated);
    } catch (err) {
      console.error("Remove failed:", err);
    }
  }

  async function handleSaveLabel(ip: string) {
    try {
      const updated = await invoke<SavedMiner[]>("update_miner_label", {
        ip,
        label: editLabel,
      });
      setSavedMiners(updated);
      setEditingIp(null);
    } catch (err) {
      console.error("Label update failed:", err);
    }
  }

  async function handleAddMinersFromScan() {
    const ips =
      selectedIps.size > 0
        ? Array.from(selectedIps)
        : scannedMiners.map((m) => m.ip);
    if (!ips.length) return;
    try {
      const updated = await invoke<SavedMiner[]>("import_from_scan", { ips, coinId: "other" });
      setSavedMiners(updated);
      setSelectedIps(new Set());
      // Update wattages for newly imported miners from scan data
      for (const ip of ips) {
        const scanned = scannedMiners.find((m) => m.ip === ip);
        if (scanned?.defaultWattage) {
          invoke("update_miner_wattage", { ip, wattage: scanned.defaultWattage }).catch(console.error);
        }
      }
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
    <div className="p-8 space-y-6">
      <div className="mb-2">
        <h2 className="text-2xl font-bold text-white">Monitoring</h2>
        <p className="text-slate-400 mt-1">Add miners manually or discover them via network scan</p>
      </div>

      {/* Add Miner Manually */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
          Add Miner Manually
        </h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-slate-400 mb-1">IP Address</label>
            <input
              type="text"
              value={addIp}
              onChange={(e) => setAddIp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddMiner()}
              className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
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
              className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
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
              className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
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

      {/* Saved Miners List */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Monitored Miners ({savedMiners.length})
          </h3>
          {savedMiners.length > 0 && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={savedSearch}
                onChange={(e) => setSavedSearch(e.target.value)}
                placeholder="Search by name or IP..."
                className="bg-dark-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-primary-500 w-44"
              />
              <select
                value={savedFilterCoin}
                onChange={(e) => setSavedFilterCoin(e.target.value)}
                className="bg-dark-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-primary-500"
              >
                <option value="all">All Coins</option>
                {coins.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.ticker})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {savedMiners.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            No miners saved yet. Add one above or import from a scan.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700/50">
              <tr className="text-slate-400">
                <th className="text-left px-6 py-3">Label</th>
                <th className="text-left px-6 py-3">IP Address</th>
                <th className="text-left px-6 py-3">Coin</th>
                <th className="text-left px-6 py-3">Added</th>
                <th className="text-right px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {savedMiners
                .filter((m) => {
                  const q = savedSearch.toLowerCase();
                  const matchesSearch =
                    !q || m.label.toLowerCase().includes(q) || m.ip.toLowerCase().includes(q);
                  const matchesCoin = savedFilterCoin === "all" || m.coin_id === savedFilterCoin;
                  return matchesSearch && matchesCoin;
                })
                .map((m) => {
                const coin = coins.find((c) => c.id === m.coin_id);
                return (
                  <tr key={m.ip} className="hover:bg-slate-800/50">
                    <td className="px-6 py-3">
                      {editingIp === m.ip ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveLabel(m.ip);
                              if (e.key === "Escape") setEditingIp(null);
                            }}
                            className="bg-dark-900 border border-primary-500 rounded px-2 py-1 text-white text-xs focus:outline-none w-32"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveLabel(m.ip)}
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingIp(null)}
                            className="text-xs text-slate-500 hover:text-slate-400"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span className="text-white font-medium">{m.label}</span>
                      )}
                    </td>
                    <td className="px-6 py-3 font-mono text-slate-300">{m.ip}</td>
                    <td className="px-6 py-3 text-slate-400 text-xs">
                      {coin ? `${coin.name} (${coin.ticker})` : m.coin_id}
                    </td>
                    <td className="px-6 py-3 text-slate-500 text-xs">
                      {new Date(m.added_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => {
                            setEditingIp(m.ip);
                            setEditLabel(m.label);
                          }}
                          className="text-xs text-slate-400 hover:text-white transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemove(m.ip)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Network Scanner */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
          Network Scanner
        </h3>
        <p className="text-slate-400 text-xs mb-4">Discover Iceriver miners on your local network</p>
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
              className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
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

      {scannedMiners.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
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
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700/50">
              <tr className="text-slate-400">
                <th className="text-center px-6 py-3">
                  <input
                    type="checkbox"
                    checked={allUnsavedSelected}
                    onChange={toggleSelectAll}
                    disabled={unsavedMiners.length === 0}
                    className="cursor-pointer accent-purple-500"
                    title="Select all unsaved"
                  />
                </th>
                <th className="text-left px-6 py-3">IP / Host</th>
                <th className="text-left px-6 py-3">Model</th>
                <th className="text-left px-6 py-3">Status</th>
                <th className="text-right px-6 py-3">Hashrate</th>
                <th className="text-right px-6 py-3">Temp °C</th>
                <th className="text-right px-6 py-3">Fan RPM</th>
                <th className="text-left px-6 py-3">Pool</th>
                <th className="text-right px-6 py-3">Accepted</th>
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
                    <td className="px-6 py-4 text-center">
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
                    <td className="px-6 py-4">
                      <span className="font-mono text-slate-300">{m.ip}</span>
                      {m.hostname && (
                        <span className="block text-xs text-slate-500">{m.hostname}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{m.model}</td>
                    <td className="px-6 py-4">
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
                    <td className="px-6 py-4 text-right text-slate-300">
                      {m.rtHashrate} {m.hashrateUnit}H/s
                    </td>
                    <td className="px-6 py-4 text-right text-slate-300">
                      {maxInTmp !== null ? `${maxInTmp}°` : "--"}
                    </td>
                    <td className="px-6 py-4 text-right text-slate-300">
                      {activeFan ?? "--"}
                    </td>
                    <td className="px-6 py-4 text-slate-300 max-w-xs">
                      <span className="truncate block text-xs">
                        {activePool?.addr ?? "--"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-300">
                      {activePool?.accepted.toLocaleString() ?? "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
