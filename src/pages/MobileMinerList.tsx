import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { MobileMiner } from "../types/miner";
import type { MobileMinerSnapshot } from "../types/alerts";
import { getCoinIcon } from "../utils/coinIcon";
import { useAlerts } from "../context/AlertContext";
import PairingCodePanel from "../components/PairingCodePanel";

const POLL_INTERVAL_MS = 10_000;
const MAX_HISTORY_POINTS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatMobileHashrate(hs: number): string {
  if (hs >= 1e9) return `${(hs / 1e9).toFixed(2)} GH/s`;
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`;
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(2)} KH/s`;
  return `${hs.toFixed(0)} H/s`;
}

const formatHashrate = formatMobileHashrate;

function timeAgo(ms: number): string {
  if (ms <= 0) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Mobile miners report coin tickers like "KAS"/"BTC"; getCoinIcon expects lowercased ids.
const COIN_TICKER_TO_ID: Record<string, string> = {
  KAS: "kaspa",
  BTC: "bitcoin",
};
function coinIdFromTicker(ticker: string | undefined | null): string {
  if (!ticker) return "kaspa";
  return COIN_TICKER_TO_ID[ticker.toUpperCase()] ?? ticker.toLowerCase();
}

type OnlineState = "online" | "offline" | "warning" | "unknown";

function deriveOnlineState(miner: MobileMiner): OnlineState {
  if (!miner.isOnline) return "offline";
  if (miner.status === "error") return "warning";
  if (miner.status === "mining") return "online";
  return "warning";
}

function poolHealth(miner: MobileMiner): boolean {
  if (!miner.isOnline) return false;
  const total = miner.acceptedShares + miner.rejectedShares;
  if (total === 0) return miner.acceptedShares > 0;
  return miner.acceptedShares > 0 && miner.rejectedShares / total < 0.05;
}
function thermalHealth(miner: MobileMiner): boolean {
  return miner.throttleState === "normal" || miner.throttleState === "light";
}
function batteryHealth(miner: MobileMiner): boolean {
  return miner.batteryCharging || miner.batteryLevel >= 30;
}
function reportHealth(miner: MobileMiner): boolean {
  return miner.isOnline;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HealthDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-500"}`} />
      <span className={`text-xs ${ok ? "text-slate-400" : "text-red-400"}`}>{label}</span>
    </div>
  );
}

interface HistoryPoint {
  ts: number;
  hs: number;
}

function MobileMinerHashrateChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return null;
  const chartData = history.map((p) => ({
    label: new Date(p.ts).toLocaleTimeString(),
    hashrate: p.hs,
  }));
  // Pick a display unit based on max
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
  const scaled = chartData.map((d) => ({ ...d, hashrate: d.hashrate / divisor }));

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

function MobileMinerCard({
  miner,
  onClick,
  selectionMode,
  selected,
  onSelect,
  onRemove,
  history,
  coinIcon,
}: {
  miner: MobileMiner;
  onClick: () => void;
  selectionMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  history: HistoryPoint[];
  coinIcon: string | null;
}) {
  const onlineState = deriveOnlineState(miner);
  const statusColor = {
    online: "bg-emerald-500",
    offline: "bg-red-500",
    warning: "bg-amber-500",
    unknown: "bg-slate-500",
  }[onlineState];
  const statusLabel = miner.isOnline ? miner.status || "online" : "offline";

  function handleCardClick() {
    if (selectionMode) {
      onSelect();
    } else {
      onClick();
    }
  }

  return (
    <div
      className={`bg-dark-800 rounded-xl border p-5 cursor-pointer transition-all relative ${
        selectionMode && selected
          ? "border-primary-500 bg-primary-500/5"
          : "border-slate-700/50 hover:border-primary-500/50 hover:bg-dark-800/80"
      }`}
      onClick={handleCardClick}
    >
      {selectionMode && (
        <div className="absolute top-3 right-3">
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              selected ? "bg-primary-600 border-primary-600" : "border-slate-600 bg-dark-900"
            }`}
          >
            {selected && (
              <svg
                className="w-3 h-3 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        </div>
      )}

      <div className={`flex items-start justify-between mb-4 ${selectionMode ? "pr-8" : ""}`}>
        <div className="min-w-0">
          <h3 className="font-semibold text-white flex items-center gap-1.5">
            {coinIcon && (
              <img
                src={coinIcon}
                alt="coin"
                className="w-4 h-4 rounded-full flex-shrink-0"
              />
            )}
            <span className="truncate">{miner.name}</span>
          </h3>
          <p className="text-sm text-slate-400 truncate">
            {miner.deviceModel || "Mobile"}
            {miner.osVersion ? ` · ${miner.osVersion}` : ""}
          </p>
          {miner.appVersion && (
            <p className="text-xs text-slate-500 mt-0.5">App v{miner.appVersion}</p>
          )}
        </div>
        {!selectionMode && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${statusColor}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
              {statusLabel}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title="Remove device"
              className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Hashrate</p>
          <p className="text-lg font-bold text-white">{formatHashrate(miner.hashrateHs)}</p>
          <p className="text-xs text-slate-500">{miner.coin || "KAS"}</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">CPU Temp</p>
          <p className="text-lg font-bold text-white">
            {miner.cpuTemp > 0 ? `${miner.cpuTemp.toFixed(1)}°` : "--"}
          </p>
          <p className="text-xs text-slate-500">°C / {miner.throttleState}</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Battery</p>
          <p className="text-lg font-bold text-white flex items-center gap-1">
            {miner.batteryLevel > 0 ? `${miner.batteryLevel}%` : "--"}
            {miner.batteryCharging && (
              <svg
                className="w-3.5 h-3.5 text-amber-400"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {miner.batteryCharging ? "charging" : "discharging"}
          </p>
        </div>
      </div>

      {miner.pool && (
        <div className="bg-dark-900 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-slate-400">Active Pool</p>
          <p className="text-xs text-slate-300 truncate mt-0.5">{miner.pool}</p>
          <p className="text-xs text-slate-500">
            Accepted: {miner.acceptedShares.toLocaleString()} · Diff:{" "}
            {miner.difficulty.toFixed(2)}
          </p>
        </div>
      )}

      <div className="flex gap-3 mb-2 items-center flex-wrap">
        <HealthDot ok={poolHealth(miner)} label="Pool" />
        <HealthDot ok={thermalHealth(miner)} label="Thermal" />
        <HealthDot ok={batteryHealth(miner)} label="Battery" />
        <HealthDot ok={reportHealth(miner)} label="Report" />
      </div>

      <p className="text-xs text-slate-500">
        Last report: {timeAgo(miner.lastReportTimestamp)}
      </p>

      {!selectionMode && <MobileMinerHashrateChart history={history} />}
    </div>
  );
}

type SortDir = "asc" | "desc";

function MobileMinerTable({
  data,
  selectedDeviceIds,
  onToggleSelect,
  onRowClick,
  sortCol,
  sortDir,
  onSort,
  coinIconByDevice,
  onRemove,
}: {
  data: MobileMiner[];
  selectedDeviceIds: Set<string>;
  onToggleSelect: (deviceId: string) => void;
  onRowClick: (deviceId: string) => void;
  sortCol: string | null;
  sortDir: SortDir;
  onSort: (col: string) => void;
  coinIconByDevice: Record<string, string | null>;
  onRemove?: (miner: MobileMiner) => void;
}) {
  const statusBg = (miner: MobileMiner) => {
    const state = deriveOnlineState(miner);
    return (
      {
        online: "bg-emerald-500",
        offline: "bg-red-500",
        warning: "bg-amber-500",
        unknown: "bg-slate-500",
      }[state] ?? "bg-slate-500"
    );
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg
        className="w-3 h-3 text-primary-400 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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

  const allSelected =
    data.length > 0 && data.every((d) => selectedDeviceIds.has(d.deviceId));

  function handleHeaderCheckbox(e: React.MouseEvent) {
    e.stopPropagation();
    if (allSelected) {
      data.forEach((d) => onToggleSelect(d.deviceId));
    } else {
      data
        .filter((d) => !selectedDeviceIds.has(d.deviceId))
        .forEach((d) => onToggleSelect(d.deviceId));
    }
  }

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-700/30">
            <th className="pl-4 pr-2 py-3 w-10" onClick={handleHeaderCheckbox}>
              <div
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                  allSelected
                    ? "bg-primary-600 border-primary-600"
                    : "border-slate-500 bg-dark-900 hover:border-primary-500"
                }`}
              >
                {allSelected && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            </th>
            <Th col="name" label="Name" />
            <Th col="deviceModel" label="Device" className="hidden md:table-cell" />
            <Th col="os" label="OS" className="hidden lg:table-cell" />
            <Th col="coin" label="Coin" />
            <Th col="hashrate" label="Hashrate" />
            <Th col="battery" label="Battery" />
            <Th col="throttle" label="Throttle" />
            <Th col="status" label="Status" />
            <Th col="lastReport" label="Last Report" className="hidden xl:table-cell" />
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((miner, i) => {
            const isSelected = selectedDeviceIds.has(miner.deviceId);
            const rowBg = isSelected
              ? "bg-primary-500/10 hover:bg-primary-500/15"
              : i % 2 === 0
              ? "bg-dark-800 hover:bg-dark-700/50"
              : "bg-dark-800/60 hover:bg-dark-700/50";
            const icon = coinIconByDevice[miner.deviceId];
            const statusLabel = miner.isOnline ? miner.status || "online" : "offline";

            return (
              <tr
                key={miner.deviceId}
                className={`border-t border-slate-700/30 cursor-pointer transition-colors ${rowBg}`}
                onClick={() => onRowClick(miner.deviceId)}
              >
                <td
                  className="pl-4 pr-2 py-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(miner.deviceId);
                  }}
                >
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-primary-600 border-primary-600"
                        : "border-slate-600 bg-dark-900 hover:border-primary-500"
                    }`}
                  >
                    {isSelected && (
                      <svg
                        className="w-2.5 h-2.5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-white">{miner.name}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    {miner.deviceModel || "Mobile"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 hidden md:table-cell">
                  {miner.deviceModel || "--"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 hidden lg:table-cell">
                  {miner.osVersion || "--"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {icon && <img src={icon} alt="coin" className="w-5 h-5 rounded-full" />}
                    <span className="text-xs text-slate-300">{miner.coin || "--"}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {formatHashrate(miner.hashrateHs)}
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {miner.batteryLevel > 0 ? `${miner.batteryLevel}%` : "--"}
                  {miner.batteryCharging && (
                    <span className="ml-1 text-amber-400">⚡</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {miner.throttleState}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${statusBg(miner)}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                    {statusLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 hidden xl:table-cell">
                  {timeAgo(miner.lastReportTimestamp)}
                </td>
                <td className="px-4 py-3 text-right">
                  {onRemove && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(miner);
                      }}
                      title="Remove device"
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors rounded"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "card" | "grid";

// ─── Main component ───────────────────────────────────────────────────────────

export default function MobileMinerList() {
  const navigate = useNavigate();
  const { checkMobileAlerts } = useAlerts();

  const [miners, setMiners] = useState<MobileMiner[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverUrl, setServerUrl] = useState<string>("");
  const [showPairPanel, setShowPairPanel] = useState(false);

  // Removal modal state
  const [removeTarget, setRemoveTarget] = useState<MobileMiner | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [bulkRemoveTargets, setBulkRemoveTargets] = useState<MobileMiner[]>([]);
  const [showBulkRemoveModal, setShowBulkRemoveModal] = useState(false);
  const [bulkRemoveError, setBulkRemoveError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("mobile-miners-view-mode");
    return saved === "grid" ? "grid" : "card";
  });

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [searchText, setSearchText] = useState("");
  const [filterCoin, setFilterCoin] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  const historyRef = useRef<Map<string, HistoryPoint[]>>(new Map());

  const fetchMiners = useCallback(async () => {
    try {
      const list = await invoke<MobileMiner[]>("get_mobile_miners");
      const now = Date.now();
      // Update hashrate history ring buffer
      const map = historyRef.current;
      const seenIds = new Set<string>();
      for (const m of list) {
        seenIds.add(m.deviceId);
        const hist = map.get(m.deviceId) ?? [];
        hist.push({ ts: now, hs: m.hashrateHs });
        if (hist.length > MAX_HISTORY_POINTS) {
          hist.splice(0, hist.length - MAX_HISTORY_POINTS);
        }
        map.set(m.deviceId, hist);
      }
      // Prune histories for devices that no longer exist
      for (const key of Array.from(map.keys())) {
        if (!seenIds.has(key)) map.delete(key);
      }
      setMiners(list);
      setLastRefresh(new Date().toLocaleTimeString());

      // Evaluate alert rules for mobile miners
      const snapshots: MobileMinerSnapshot[] = list.map((m) => ({
        deviceId: m.deviceId,
        name: m.name,
        isOnline: m.isOnline,
        batteryLevel: m.batteryLevel,
        batteryCharging: m.batteryCharging,
        cpuTemp: m.cpuTemp,
        throttleState: m.throttleState,
      }));
      checkMobileAlerts(snapshots);
    } catch (err) {
      console.error("Failed to load mobile miners:", err);
    } finally {
      setLoading(false);
    }
  }, [checkMobileAlerts]);

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    const deviceId = removeTarget.deviceId;
    setRemoving(true);
    try {
      // Queue cleanup commands — only delivered if device is online
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
      // Remove the record
      await invoke("remove_mobile_miner", { deviceId });
      setMiners((prev) => prev.filter((m) => m.deviceId !== deviceId));
      setSelectedDeviceIds((prev) => {
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
      setRemoveTarget(null);
    } catch (err) {
      console.error("Failed to remove device:", err);
      setRemoveError(String(err));
    } finally {
      setRemoving(false);
    }
  }

  async function handleConfirmBulkRemove() {
    if (bulkRemoveTargets.length === 0) return;
    setRemoving(true);
    try {
      for (const miner of bulkRemoveTargets) {
        const deviceId = miner.deviceId;
        // Queue stop + set_config cleanup (best effort)
        try {
          await invoke("queue_mobile_command", {
            deviceId,
            commandType: "stop",
            params: null,
          });
        } catch (err) {
          console.warn(`Failed to queue stop for ${deviceId}:`, err);
        }
        try {
          await invoke("queue_mobile_command", {
            deviceId,
            commandType: "set_config",
            params: { poolUrl: "", wallet: "", worker: "", threads: 0 },
          });
        } catch (err) {
          console.warn(`Failed to queue set_config for ${deviceId}:`, err);
        }
        try {
          await invoke("remove_mobile_miner", { deviceId });
        } catch (err) {
          console.error(`Failed to remove ${deviceId}:`, err);
        }
      }
      await fetchMiners();
      setSelectedDeviceIds(new Set());
      setBulkRemoveTargets([]);
      setShowBulkRemoveModal(false);
    } catch (err) {
      console.error("Bulk remove failed:", err);
      setBulkRemoveError(String(err));
    } finally {
      setRemoving(false);
    }
  }

  function openBulkRemoveModal() {
    const targets = miners.filter((m) => selectedDeviceIds.has(m.deviceId));
    if (targets.length === 0) return;
    setBulkRemoveTargets(targets);
    setBulkRemoveError(null);
    setShowBulkRemoveModal(true);
  }

  useEffect(() => {
    fetchMiners();
    invoke<string>("get_mobile_server_url").then(setServerUrl).catch(console.error);
    const id = setInterval(fetchMiners, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchMiners]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await fetchMiners();
    } finally {
      setRefreshing(false);
    }
  }

  // ── Derived filter options ──────────────────────────────────────────────────

  const uniqueCoins = useMemo(() => {
    const set = new Set(miners.map((m) => m.coin).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [miners]);

  // ── Filter + sort ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return miners.filter((m) => {
      if (q) {
        const matches =
          m.name.toLowerCase().includes(q) ||
          m.deviceId.toLowerCase().includes(q) ||
          (m.worker || "").toLowerCase().includes(q) ||
          (m.pool || "").toLowerCase().includes(q) ||
          (m.deviceModel || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filterCoin !== "All" && m.coin !== filterCoin) return false;
      if (filterStatus !== "All") {
        if (filterStatus === "online" && !m.isOnline) return false;
        if (filterStatus === "offline" && m.isOnline) return false;
        if (filterStatus === "mining" && (!m.isOnline || m.status !== "mining")) return false;
        if (filterStatus === "stopped" && (!m.isOnline || m.status !== "stopped")) return false;
      }
      return true;
    });
  }, [miners, searchText, filterCoin, filterStatus]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortCol) {
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case "deviceModel":
          aVal = (a.deviceModel || "").toLowerCase();
          bVal = (b.deviceModel || "").toLowerCase();
          break;
        case "os":
          aVal = (a.osVersion || "").toLowerCase();
          bVal = (b.osVersion || "").toLowerCase();
          break;
        case "coin":
          aVal = (a.coin || "").toLowerCase();
          bVal = (b.coin || "").toLowerCase();
          break;
        case "hashrate":
          aVal = a.hashrateHs;
          bVal = b.hashrateHs;
          break;
        case "battery":
          aVal = a.batteryLevel;
          bVal = b.batteryLevel;
          break;
        case "throttle":
          aVal = a.throttleState;
          bVal = b.throttleState;
          break;
        case "status":
          aVal = a.isOnline ? a.status : "offline";
          bVal = b.isOnline ? b.status : "offline";
          break;
        case "lastReport":
          aVal = a.lastReportTimestamp;
          bVal = b.lastReportTimestamp;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortDir]);

  const coinIconByDevice = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const m of sorted) {
      map[m.deviceId] = getCoinIcon(coinIdFromTicker(m.coin));
    }
    return map;
  }, [sorted]);

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
    localStorage.setItem("mobile-miners-view-mode", mode);
    setSelectedDeviceIds(new Set());
    setSelectionMode(false);
  }

  // ── Selection helpers ───────────────────────────────────────────────────────

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedDeviceIds(new Set());
  }

  function toggleSelect(deviceId: string) {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  function selectAll() {
    setSelectedDeviceIds(new Set(filtered.map((m) => m.deviceId)));
  }

  // ── Bulk actions ────────────────────────────────────────────────────────────

  async function runBulkCommand(commandType: "start" | "stop") {
    if (bulkRunning || selectedDeviceIds.size === 0) return;
    setBulkRunning(true);
    try {
      const ids = Array.from(selectedDeviceIds);
      for (const deviceId of ids) {
        try {
          await invoke("queue_mobile_command", {
            deviceId,
            commandType,
            params: null,
          });
        } catch (err) {
          console.error(`Bulk ${commandType} failed for ${deviceId}:`, err);
        }
      }
      await fetchMiners();
    } finally {
      setBulkRunning(false);
    }
  }

  // ── CSV export ──────────────────────────────────────────────────────────────

  async function handleExportCSV() {
    try {
      const filePath = await save({ filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!filePath) return;
      const header = [
        "name",
        "deviceId",
        "deviceModel",
        "osVersion",
        "coin",
        "hashrateHs",
        "batteryLevel",
        "batteryCharging",
        "status",
        "isOnline",
        "lastReportTimestamp",
      ];
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const rows = filtered.map((m) =>
        [
          escape(m.name),
          escape(m.deviceId),
          escape(m.deviceModel || ""),
          escape(m.osVersion || ""),
          escape(m.coin || ""),
          String(m.hashrateHs),
          String(m.batteryLevel),
          String(m.batteryCharging),
          escape(m.status || ""),
          String(m.isOnline),
          new Date(m.lastReportTimestamp).toISOString(),
        ].join(",")
      );
      const csv = [header.join(","), ...rows].join("\n");
      await writeTextFile(filePath, csv);
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  const hasFilters = searchText || filterCoin !== "All" || filterStatus !== "All";

  function clearFilters() {
    setSearchText("");
    setFilterCoin("All");
    setFilterStatus("All");
  }

  const effectiveSelectionMode = viewMode === "grid" ? true : selectionMode;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Mobile Miners</h2>
          <p className="text-slate-400 mt-1">
            Phones and tablets reporting telemetry to your local server
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <p className="text-xs text-slate-500">Last updated: {lastRefresh}</p>
          )}
          <button
            onClick={() => setShowPairPanel((v) => !v)}
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
            {showPairPanel ? "Hide Pairing" : "Add Device"}
          </button>
          <button
            onClick={handleExportCSV}
            disabled={miners.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-slate-700/50 hover:border-primary-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-slate-700/50 hover:border-primary-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
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
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {showPairPanel && (
        <div className="mb-6">
          <PairingCodePanel
            serverUrl={serverUrl}
            onClose={() => setShowPairPanel(false)}
          />
        </div>
      )}

      {/* Search + Filters + View Toggle */}
      {(miners.length > 0 || loading) && (
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
                placeholder="Search by name, device ID, worker, or pool..."
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <span className="text-xs text-slate-500">Coin:</span>
              <select
                value={filterCoin}
                onChange={(e) => setFilterCoin(e.target.value)}
                className="bg-dark-800 border border-slate-700/50 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-primary-500/70 cursor-pointer"
              >
                {uniqueCoins.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
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
                <option value="stopped">Stopped</option>
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

      {/* Selection controls + Bulk action bar */}
      {miners.length > 0 && (
        <div className="mb-4 flex items-center gap-3 min-h-[2.25rem]">
          {viewMode === "card" && (
            <button
              onClick={toggleSelectionMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium rounded-lg transition-colors ${
                selectionMode
                  ? "bg-primary-600/20 border-primary-500/50 text-primary-400"
                  : "bg-dark-800 border-slate-700/50 hover:border-primary-500/50 text-slate-300"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {selectionMode ? "Exit Select" : "Select"}
            </button>
          )}

          {effectiveSelectionMode && (
            <div
              className={`flex-1 flex items-center gap-3 ${
                selectionMode || (viewMode === "grid" && selectedDeviceIds.size > 0)
                  ? "px-4 py-2 bg-primary-900/30 border border-primary-500/30 rounded-xl"
                  : ""
              }`}
            >
              <span className="text-sm text-primary-300">
                {selectedDeviceIds.size === 0
                  ? viewMode === "card"
                    ? "Click miners to select them"
                    : "Check rows to select miners"
                  : `${selectedDeviceIds.size} miner${selectedDeviceIds.size > 1 ? "s" : ""} selected`}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {filtered.length > 0 && selectedDeviceIds.size < filtered.length && (
                  <button
                    onClick={selectAll}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    Select all ({filtered.length})
                  </button>
                )}
                {selectedDeviceIds.size > 0 && (
                  <>
                    <button
                      onClick={() => setSelectedDeviceIds(new Set())}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => runBulkCommand("start")}
                      disabled={bulkRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
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
                          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        />
                      </svg>
                      Bulk Start
                    </button>
                    <button
                      onClick={() => runBulkCommand("stop")}
                      disabled={bulkRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
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
                          d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Bulk Stop
                    </button>
                    <button
                      onClick={openBulkRemoveModal}
                      disabled={removing}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Miner list */}
      {loading ? (
        <div className="text-center py-20 text-slate-500 text-sm">Loading...</div>
      ) : miners.length === 0 ? (
        <div className="text-center py-20">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <p className="text-lg font-medium text-slate-300">
            No mobile miners registered yet
          </p>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Install KASMobileMiner on your Android device and point it to this PoPManager
            instance:
          </p>
          {serverUrl && (
            <div className="mt-4 inline-flex items-center gap-2 bg-dark-900 border border-slate-700 rounded-lg px-4 py-2">
              <code className="font-mono text-sm text-primary-400">{serverUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(serverUrl)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Copy
              </button>
            </div>
          )}
          <p className="text-xs text-slate-600 mt-4">
            See Settings → Mobile Miner Server to configure the listener.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-lg font-medium">No miners match your filters</p>
          <button
            onClick={clearFilters}
            className="text-sm mt-2 text-primary-400 hover:text-primary-300"
          >
            Clear filters
          </button>
        </div>
      ) : viewMode === "grid" ? (
        <MobileMinerTable
          data={sorted}
          selectedDeviceIds={selectedDeviceIds}
          onToggleSelect={toggleSelect}
          onRowClick={(deviceId) =>
            navigate(`/mobile-miners/${encodeURIComponent(deviceId)}`)
          }
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
          coinIconByDevice={coinIconByDevice}
          onRemove={(m) => { setRemoveError(null); setRemoveTarget(m); }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((m) => (
            <MobileMinerCard
              key={m.deviceId}
              miner={m}
              onClick={() =>
                navigate(`/mobile-miners/${encodeURIComponent(m.deviceId)}`)
              }
              selectionMode={selectionMode}
              selected={selectedDeviceIds.has(m.deviceId)}
              onSelect={() => toggleSelect(m.deviceId)}
              onRemove={() => { setRemoveError(null); setRemoveTarget(m); }}
              history={historyRef.current.get(m.deviceId) ?? []}
              coinIcon={coinIconByDevice[m.deviceId]}
            />
          ))}
        </div>
      )}

      {/* Remove device confirmation modal */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!removing) { setRemoveTarget(null); setRemoveError(null); } }}
          />
          <div className="relative z-10 bg-dark-800 border border-red-900/40 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-3">
              Remove {removeTarget.name}?
            </h3>
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
                on its next report. To permanently remove it, first change or clear the server URL in the KASMobileMiner app.
              </p>
            </div>
            {removeError && (
              <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {removeError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setRemoveTarget(null); setRemoveError(null); }}
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
                {removing ? "Removing..." : "Remove Device"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk remove confirmation modal */}
      {showBulkRemoveModal && bulkRemoveTargets.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!removing) { setShowBulkRemoveModal(false); setBulkRemoveError(null); } }}
          />
          <div className="relative z-10 bg-dark-800 border border-red-900/40 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-3">
              Remove {bulkRemoveTargets.length} mobile miner{bulkRemoveTargets.length > 1 ? "s" : ""}?
            </h3>
            <div className="text-sm text-slate-300 space-y-3 mb-5">
              <p>Are you sure you want to remove the selected mobile miner{bulkRemoveTargets.length > 1 ? "s" : ""}?</p>
              <p>For each device, this will:</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-400 text-xs">
                <li>Queue a <code className="text-amber-400">stop</code> command</li>
                <li>Queue a <code className="text-amber-400">set_config</code> command to clear pool URL, wallet, and worker</li>
                <li>Remove the device from PoPManager's local registry</li>
              </ol>
              {bulkRemoveTargets.length <= 10 && (
                <ul className="text-xs text-slate-400 bg-dark-900 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                  {bulkRemoveTargets.map((m) => (
                    <li key={m.deviceId} className="font-mono">
                      {m.name} <span className="text-slate-500">({m.deviceModel || m.deviceId.slice(0, 8)})</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-amber-400 text-xs border-l-2 border-amber-500/50 pl-3">
                <strong>Note:</strong> Cleanup commands are only delivered if each device is online. Devices still configured to report to this PoPManager instance will re-register on their next report. To permanently remove them, first change or clear the server URL in each KASMobileMiner app.
              </p>
            </div>
            {bulkRemoveError && (
              <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {bulkRemoveError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowBulkRemoveModal(false); setBulkRemoveError(null); }}
                disabled={removing}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBulkRemove}
                disabled={removing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
              >
                {removing ? "Removing..." : `Remove ${bulkRemoveTargets.length} Device${bulkRemoveTargets.length > 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
