import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import type { PopMinerDevice } from "../types/miner";

const MAX_HISTORY_POINTS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHashrate(hs: number): string {
  if (hs >= 1e9) return `${(hs / 1e9).toFixed(2)} GH/s`;
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`;
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(2)} KH/s`;
  return `${hs.toFixed(0)} H/s`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

// ─── Hashrate Chart ──────────────────────────────────────────────────────────

interface HistoryPoint {
  ts: number;
  hs: number;
}

function PopMinerHashrateChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return null;
  const chartData = history.map((p) => ({
    label: new Date(p.ts).toLocaleTimeString(),
    hashrate: p.hs,
  }));
  const maxHs = Math.max(...history.map((p) => p.hs));
  let unit = "H/s";
  let divisor = 1;
  if (maxHs >= 1e9) {
    unit = "GH/s";
    divisor = 1e9;
  } else if (maxHs >= 1e6) {
    unit = "MH/s";
    divisor = 1e6;
  } else if (maxHs >= 1e3) {
    unit = "KH/s";
    divisor = 1e3;
  }
  const scaled = chartData.map((d) => ({
    ...d,
    hashrate: d.hashrate / divisor,
  }));

  return (
    <div className="bg-dark-900 rounded-lg p-3 mt-3">
      <p className="text-xs text-slate-400 mb-2">Hashrate History ({unit})</p>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={scaled}>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "none",
              borderRadius: 6,
              fontSize: 11,
            }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(v: number) => [`${v.toFixed(2)} ${unit}`, "Hashrate"]}
          />
          <Line
            type="monotone"
            dataKey="hashrate"
            stroke="#6366f1"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function HealthDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full ${
          ok ? "bg-emerald-400" : "bg-red-500"
        }`}
      />
      <span className={`text-xs ${ok ? "text-slate-400" : "text-red-400"}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Microchip Icon ──────────────────────────────────────────────────────────

function MicrochipIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.75}
    >
      <rect x="6" y="6" width="12" height="12" rx="1" />
      <line x1="9" y1="2" x2="9" y2="6" />
      <line x1="15" y1="2" x2="15" y2="6" />
      <line x1="9" y1="18" x2="9" y2="22" />
      <line x1="15" y1="18" x2="15" y2="22" />
      <line x1="2" y1="9" x2="6" y2="9" />
      <line x1="2" y1="15" x2="6" y2="15" />
      <line x1="18" y1="9" x2="22" y2="9" />
      <line x1="18" y1="15" x2="22" y2="15" />
    </svg>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function PopMinerCard({
  device,
  onClick,
  onRemove,
  history,
}: {
  device: PopMinerDevice;
  onClick: () => void;
  onRemove: () => void;
  history: HistoryPoint[];
}) {
  const statusColor = !device.online
    ? "bg-slate-500"
    : device.mining
    ? "bg-emerald-500"
    : "bg-amber-500";

  const statusText = !device.online
    ? "offline"
    : device.mining
    ? "mining"
    : "idle";

  return (
    <div
      className="bg-dark-800 rounded-xl border border-slate-700/50 p-5 cursor-pointer hover:border-primary-500/50 hover:bg-dark-800/80 transition-all"
      onClick={onClick}
    >
      {/* Header: name + status + remove */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <MicrochipIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span className="truncate">{device.name || device.hostname}</span>
          </h3>
          <p className="text-sm text-slate-400 truncate">
            {device.hostname}.local &middot; {device.ip}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            FW v{device.fw} &middot; {device.model}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${statusColor}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
            {statusText}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove device"
            className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Stats grid */}
      {device.online ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-dark-900 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Hashrate</p>
              <p className="text-sm font-bold text-white">
                {formatHashrate(device.hashrate)}
              </p>
            </div>
            <div className="bg-dark-900 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Shares</p>
              <p className="text-sm font-bold text-white">
                {device.accepted}/{device.submitted}
                {device.rejected > 0 && (
                  <span className="text-red-400 text-xs ml-1">
                    ({device.rejected}r)
                  </span>
                )}
              </p>
            </div>
            <div className="bg-dark-900 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Uptime</p>
              <p className="text-sm font-bold text-white">
                {formatUptime(device.uptimeS)}
              </p>
            </div>
          </div>
          {device.pool && (
            <div className="bg-dark-900 rounded-lg px-3 py-2 mb-3">
              <p className="text-xs text-slate-400">Pool</p>
              <p className="text-xs text-slate-300 font-mono truncate">
                {device.pool}
              </p>
              <p className="text-xs text-slate-500">
                Diff:{" "}
                {device.difficulty < 0.01
                  ? device.difficulty.toPrecision(4)
                  : device.difficulty.toFixed(4)}
                {device.blocks > 0 && (
                  <span className="text-amber-400 ml-2">
                    {device.blocks} block{device.blocks !== 1 ? "s" : ""}
                  </span>
                )}
              </p>
            </div>
          )}
          {/* Health dots */}
          <div className="flex items-center gap-3 text-xs">
            <HealthDot ok={device.poolConnected} label="Pool" />
            <HealthDot ok={device.authorized} label="Auth" />
            <HealthDot ok={device.mining} label={device.mining ? "Mining" : "Idle"} />
          </div>
          <PopMinerHashrateChart history={history} />
        </>
      ) : (
        <div className="text-center py-4 text-slate-500 text-sm">
          Device offline — last seen at {device.ip}
        </div>
      )}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function PopMinerTable({
  data,
  sortCol,
  sortDir,
  onSort,
  onRowClick,
  onRemove,
}: {
  data: PopMinerDevice[];
  sortCol: string | null;
  sortDir: SortDir;
  onSort: (col: string) => void;
  onRowClick: (device: PopMinerDevice) => void;
  onRemove: (device: PopMinerDevice) => void;
}) {
  const statusBg = (device: PopMinerDevice) => {
    if (!device.online) return "bg-slate-500";
    if (device.mining) return "bg-emerald-500";
    return "bg-amber-500";
  };

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) {
      return (
        <svg
          className="w-3 h-3 text-slate-600 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"
          />
        </svg>
      );
    }
    return sortDir === "asc" ? (
      <svg
        className="w-3 h-3 text-primary-400 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 15l7-7 7 7"
        />
      </svg>
    ) : (
      <svg
        className="w-3 h-3 text-primary-400 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    );
  }

  function Th({
    col,
    label,
    className = "",
  }: {
    col: string;
    label: string;
    className?: string;
  }) {
    return (
      <th
        className={`px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors ${className}`}
        onClick={() => onSort(col)}
      >
        <div className="flex items-center gap-1.5">
          {label}
          <SortIcon col={col} />
        </div>
      </th>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-700/30">
            <Th col="name" label="Name" />
            <Th col="hostname" label="Hostname" className="hidden md:table-cell" />
            <Th col="ip" label="IP" className="hidden lg:table-cell" />
            <Th col="fw" label="FW" className="hidden lg:table-cell" />
            <Th col="status" label="Status" />
            <Th col="hashrate" label="Hashrate" />
            <Th col="shares" label="Shares" className="hidden md:table-cell" />
            <Th col="pool" label="Pool" className="hidden xl:table-cell" />
            <Th col="uptime" label="Uptime" className="hidden lg:table-cell" />
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((device, i) => {
            const statusLabel = !device.online
              ? "offline"
              : device.mining
              ? "mining"
              : "idle";
            const rowBg =
              i % 2 === 0
                ? "bg-dark-800 hover:bg-dark-700/50"
                : "bg-dark-800/60 hover:bg-dark-700/50";

            return (
              <tr
                key={device.mac}
                className={`border-t border-slate-700/30 cursor-pointer transition-colors ${rowBg}`}
                onClick={() => onRowClick(device)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MicrochipIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-white truncate">
                      {device.name || device.hostname}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 hidden md:table-cell">
                  {device.hostname}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 font-mono hidden lg:table-cell">
                  {device.ip}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">
                  v{device.fw}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${statusBg(device)}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                    {statusLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {device.online ? formatHashrate(device.hashrate) : "--"}
                </td>
                <td className="px-4 py-3 text-sm text-white hidden md:table-cell">
                  {device.online ? (
                    <>
                      {device.accepted}/{device.submitted}
                      {device.rejected > 0 && (
                        <span className="text-red-400 text-xs ml-1">
                          ({device.rejected}r)
                        </span>
                      )}
                    </>
                  ) : (
                    "--"
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 font-mono truncate max-w-[200px] hidden xl:table-cell">
                  {device.pool || "--"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 hidden lg:table-cell">
                  {device.online ? formatUptime(device.uptimeS) : "--"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(device);
                    }}
                    title="Remove device"
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors rounded"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Add Device Panel ─────────────────────────────────────────────────────────

function AddDevicePanel({
  onClose,
  onDeviceAdded,
}: {
  onClose: () => void;
  onDeviceAdded: () => void;
}) {
  const [discovered, setDiscovered] = useState<PopMinerDevice[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  const fetchDiscovered = useCallback(async () => {
    try {
      const list = await invoke<PopMinerDevice[]>(
        "get_discovered_popminer_devices"
      );
      setDiscovered(list);
    } catch (err) {
      console.error("Failed to fetch discovered devices:", err);
    }
  }, []);

  useEffect(() => {
    fetchDiscovered();
    const id = setInterval(fetchDiscovered, 3000);
    return () => clearInterval(id);
  }, [fetchDiscovered]);

  async function handleAdd(mac: string) {
    setAdding(mac);
    try {
      await invoke("add_popminer_device", { mac });
      onDeviceAdded();
      await fetchDiscovered();
    } catch (err) {
      console.error("Failed to add device:", err);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Discovered PoPMiner Devices
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Devices found on your local network via mDNS. Click "Add" to start
            monitoring.
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-dark-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {discovered.length === 0 ? (
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-dark-900 mb-3">
            <svg
              className="w-5 h-5 text-slate-500 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <p className="text-sm text-slate-400">
            No PoPMiner devices found on your network.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Make sure your device is powered on and connected to the same LAN.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {discovered.map((d) => {
            const statusColor = !d.online
              ? "bg-slate-500"
              : d.mining
              ? "bg-emerald-500"
              : "bg-amber-500";
            const statusText = !d.online
              ? "offline"
              : d.mining
              ? "mining"
              : "idle";

            return (
              <div
                key={d.mac}
                className="flex items-center justify-between bg-dark-900 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MicrochipIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {d.name || d.hostname}
                    </p>
                    <p className="text-xs text-slate-500">
                      {d.hostname}.local &middot; {d.ip} &middot; FW v{d.fw}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${statusColor}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                    {statusText}
                  </span>
                  <button
                    onClick={() => handleAdd(d.mac)}
                    disabled={adding === d.mac}
                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {adding === d.mac ? "Adding..." : "Add"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = "card" | "grid";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PopMinerList() {
  const [devices, setDevices] = useState<Map<string, PopMinerDevice>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [showAddPanel, setShowAddPanel] = useState(false);

  // Removal modal
  const [removeTarget, setRemoveTarget] = useState<PopMinerDevice | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("popminer-view-mode");
    return saved === "grid" ? "grid" : "card";
  });

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");

  const historyRef = useRef<Map<string, HistoryPoint[]>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<PopMinerDevice[]>("get_popminer_devices");
      const map = new Map<string, PopMinerDevice>();
      for (const d of list) map.set(d.mac, d);
      setDevices(map);
    } catch (err) {
      console.error("Failed to load PoPMiner devices:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const unlisteners: (() => void)[] = [];

    listen<PopMinerDevice>("popminer-device-stats", (event) => {
      const d = event.payload;
      setDevices((prev) => {
        const next = new Map(prev);
        const existing = next.get(d.mac);
        if (existing) {
          next.set(d.mac, { ...existing, ...d });
        } else {
          next.set(d.mac, d);
        }
        return next;
      });
      // Update hashrate history ring buffer
      const map = historyRef.current;
      const hist = map.get(d.mac) ?? [];
      hist.push({ ts: Date.now(), hs: d.hashrate });
      if (hist.length > MAX_HISTORY_POINTS) {
        hist.splice(0, hist.length - MAX_HISTORY_POINTS);
      }
      map.set(d.mac, hist);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [refresh]);

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    const mac = removeTarget.mac;
    setRemoving(true);
    try {
      await invoke("remove_popminer_device", { mac });
      setDevices((prev) => {
        const next = new Map(prev);
        next.delete(mac);
        return next;
      });
      historyRef.current.delete(mac);
      setRemoveTarget(null);
    } catch (err) {
      console.error("Failed to remove device:", err);
      setRemoveError(String(err));
    } finally {
      setRemoving(false);
    }
  }

  // ── Filter + sort ──────────────────────────────────────────────────────────

  const deviceList = Array.from(devices.values());

  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return deviceList.filter((d) => {
      if (q) {
        const matches =
          d.name.toLowerCase().includes(q) ||
          d.hostname.toLowerCase().includes(q) ||
          d.ip.toLowerCase().includes(q) ||
          d.pool.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filterStatus !== "All") {
        if (filterStatus === "online" && !d.online) return false;
        if (filterStatus === "offline" && d.online) return false;
        if (filterStatus === "mining" && (!d.online || !d.mining)) return false;
        if (filterStatus === "idle" && (!d.online || d.mining)) return false;
      }
      return true;
    });
  }, [deviceList, searchText, filterStatus]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortCol) {
        case "name":
          aVal = (a.name || a.hostname).toLowerCase();
          bVal = (b.name || b.hostname).toLowerCase();
          break;
        case "hostname":
          aVal = a.hostname.toLowerCase();
          bVal = b.hostname.toLowerCase();
          break;
        case "ip":
          aVal = a.ip;
          bVal = b.ip;
          break;
        case "fw":
          aVal = a.fw;
          bVal = b.fw;
          break;
        case "status":
          aVal = !a.online ? "offline" : a.mining ? "mining" : "idle";
          bVal = !b.online ? "offline" : b.mining ? "mining" : "idle";
          break;
        case "hashrate":
          aVal = a.hashrate;
          bVal = b.hashrate;
          break;
        case "shares":
          aVal = a.accepted;
          bVal = b.accepted;
          break;
        case "pool":
          aVal = a.pool.toLowerCase();
          bVal = b.pool.toLowerCase();
          break;
        case "uptime":
          aVal = a.uptimeS;
          bVal = b.uptimeS;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortDir]);

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("popminer-view-mode", mode);
  }

  const hasFilters = searchText || filterStatus !== "All";

  function clearFilters() {
    setSearchText("");
    setFilterStatus("All");
  }

  const onlineCount = deviceList.filter((d) => d.online).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">PoPMiner Devices</h2>
          <p className="text-slate-400 mt-1">
            PoPMiner hardware devices on your local network
          </p>
        </div>
        <div className="flex items-center gap-3">
          {deviceList.length > 0 && (
            <p className="text-xs text-slate-500">
              {onlineCount}/{deviceList.length} online
            </p>
          )}
          <button
            onClick={() => setShowAddPanel((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            {showAddPanel ? "Hide Discovery" : "Add Device"}
          </button>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-slate-700/50 hover:border-primary-500/50 text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Add Device panel */}
      {showAddPanel && (
        <AddDevicePanel
          onClose={() => setShowAddPanel(false)}
          onDeviceAdded={refresh}
        />
      )}

      {/* Search + Filters + View Toggle */}
      {(deviceList.length > 0 || loading) && (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search by name, hostname, IP, or pool..."
                className="w-full bg-dark-800 border border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary-500/70"
              />
            </div>

            <div className="flex items-center bg-dark-800 border border-slate-700/50 rounded-lg p-0.5">
              <button
                onClick={() => handleViewModeChange("card")}
                title="Card view"
                className={`p-2 rounded-md transition-colors ${
                  viewMode === "card"
                    ? "bg-primary-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
              </button>
              <button
                onClick={() => handleViewModeChange("grid")}
                title="Table view"
                className={`p-2 rounded-md transition-colors ${
                  viewMode === "grid"
                    ? "bg-primary-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h18M3 14h18M10 3v18M14 3v18"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Status:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-dark-800 border border-slate-700/50 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-primary-500/70 cursor-pointer"
              >
                <option value="All">All</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="mining">Mining</option>
                <option value="idle">Idle</option>
              </select>
            </div>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Device list */}
      {loading ? (
        <div className="text-center py-20 text-slate-500 text-sm">
          Loading...
        </div>
      ) : deviceList.length === 0 ? (
        <div className="text-center py-20">
          <MicrochipIcon className="w-16 h-16 mx-auto mb-4 text-slate-600" />
          <p className="text-lg font-medium text-slate-300">
            No PoPMiner devices added
          </p>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Click "Add Device" above to discover PoPMiner devices on your
            network. Make sure your PoPMiner Nano (or other PoPMiner device) is
            powered on and connected to the same LAN.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-lg font-medium">No devices match your filters</p>
          <button
            onClick={clearFilters}
            className="text-sm mt-2 text-primary-400 hover:text-primary-300"
          >
            Clear filters
          </button>
        </div>
      ) : viewMode === "grid" ? (
        <PopMinerTable
          data={sorted}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
          onRowClick={(d) => openUrl(`http://${d.ip}/`)}
          onRemove={(d) => {
            setRemoveError(null);
            setRemoveTarget(d);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((d) => (
            <PopMinerCard
              key={d.mac}
              device={d}
              onClick={() => openUrl(`http://${d.ip}/`)}
              onRemove={() => {
                setRemoveError(null);
                setRemoveTarget(d);
              }}
              history={historyRef.current.get(d.mac) ?? []}
            />
          ))}
        </div>
      )}

      {/* Remove device confirmation modal */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!removing) {
                setRemoveTarget(null);
                setRemoveError(null);
              }
            }}
          />
          <div className="relative z-10 bg-dark-800 border border-red-900/40 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-3">
              Remove {removeTarget.name || removeTarget.hostname}?
            </h3>
            <div className="text-sm text-slate-300 space-y-3 mb-5">
              <p>
                Are you sure you want to remove this PoPMiner device? It will no
                longer appear in your device list.
              </p>
              <p className="text-xs text-slate-500">
                The device will still be discoverable via mDNS. You can re-add
                it later using the "Add Device" button.
              </p>
            </div>
            {removeError && (
              <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {removeError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setRemoveTarget(null);
                  setRemoveError(null);
                }}
                disabled={removing}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemove}
                disabled={removing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
