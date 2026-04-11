import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { MinerInfo, SavedMiner, CoinConfig, PoolProfile, UptimeStats } from "../types/miner";
import { getMinerCoinId } from "../utils/coinLookup";
import { getCoinIcon } from "../utils/coinIcon";
import { profileToPayload } from "../types/miner";
import { useAlerts } from "../context/AlertContext";
import type { MinerSnapshot } from "../types/alerts";
import AsicAddDevicePanel from "../components/AsicAddDevicePanel";

const POLL_INTERVAL_MS = 45_000;

function extractWorkerName(user: string): string | null {
  const dot = user.lastIndexOf(".");
  if (dot !== -1 && dot < user.length - 1) {
    return user.slice(dot + 1);
  }
  return null;
}

function resolveDisplayName(miner: MinerInfo, saved: SavedMiner | undefined): string {
  if (saved && saved.label && saved.label !== miner.ip) {
    return saved.label;
  }
  const activePool = miner.pools.find((p) => p.connect);
  if (activePool) {
    const worker = extractWorkerName(activePool.user);
    if (worker) return worker;
  }
  return miner.hostname || miner.ip;
}

function extractManufacturer(model: string): string {
  return model.split(" ")[0] || model;
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

function HashrateChart({ miner }: { miner: MinerInfo }) {
  if (!miner.hashrateHistory.length) return null;
  const history = miner.hashrateHistory[0];
  const chartData = history.labels.map((label, i) => ({
    label,
    hashrate: history.values[i] ?? 0,
  }));

  return (
    <div className="bg-dark-900 rounded-lg p-3 mt-3">
      <p className="text-xs text-slate-400 mb-2">Hashrate History ({miner.hashrateUnit}H/s)</p>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={chartData}>
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
            formatter={(v: number) => [`${v} ${miner.hashrateUnit}H/s`, "Hashrate"]}
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

function MinerCard({
  miner,
  displayName,
  onClick,
  selectionMode,
  selected,
  onSelect,
  uptimeStats,
  coinIcon,
  onRemove,
}: {
  miner: MinerInfo;
  displayName: string;
  onClick: () => void;
  selectionMode: boolean;
  selected: boolean;
  onSelect: () => void;
  uptimeStats?: UptimeStats;
  coinIcon?: string | null;
  onRemove?: () => void;
}) {
  const statusColor =
    {
      online: "bg-emerald-500",
      offline: "bg-red-500",
      warning: "bg-amber-500",
      unknown: "bg-slate-500",
    }[miner.status] ?? "bg-slate-500";

  const maxInTmp = miner.boards.length ? Math.max(...miner.boards.map((b) => b.inTmp)) : null;
  const maxOutTmp = miner.boards.length ? Math.max(...miner.boards.map((b) => b.outTmp)) : null;
  const activeFans = miner.fans.filter((f) => f > 0);
  const activePool = miner.pools.find((p) => p.connect);

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
        <div>
          <h3 className="font-semibold text-white flex items-center gap-1.5">
              {coinIcon && <img src={coinIcon} alt="coin" className="w-4 h-4 rounded-full flex-shrink-0" />}
              {displayName}
            </h3>
          <p className="text-sm text-slate-400">
            {miner.ip} · {miner.model}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{miner.firmware}</p>
        </div>
        {!selectionMode && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                openUrl(`http://${miner.ip}`);
              }}
              title="Open miner web UI"
              className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded"
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
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </button>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${statusColor}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
              {miner.status}
            </span>
            {onRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Remove miner"
                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors rounded"
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
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Hashrate</p>
          <p className="text-lg font-bold text-white">{miner.rtHashrate}</p>
          <p className="text-xs text-slate-500">{miner.hashrateUnit}H/s</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Inlet / Outlet</p>
          <p className="text-lg font-bold text-white">
            {maxInTmp !== null ? `${maxInTmp}°` : "--"}
            <span className="text-sm text-slate-400">
              {maxOutTmp !== null ? ` / ${maxOutTmp}°` : ""}
            </span>
          </p>
          <p className="text-xs text-slate-500">°C</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Fans</p>
          <p className="text-lg font-bold text-white">{activeFans[0] ?? "--"}</p>
          <p className="text-xs text-slate-500">RPM</p>
        </div>
      </div>

      {activePool && (
        <div className="bg-dark-900 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-slate-400">Active Pool</p>
          <p className="text-xs text-slate-300 truncate mt-0.5">{activePool.addr}</p>
          <p className="text-xs text-slate-500">
            Accepted: {activePool.accepted.toLocaleString()} · Diff: {activePool.diff}
          </p>
        </div>
      )}

      <div className="flex gap-3 mb-2 items-center flex-wrap">
        <HealthDot ok={miner.health.power} label="Power" />
        <HealthDot ok={miner.health.network} label="Net" />
        <HealthDot ok={miner.health.fan} label="Fan" />
        <HealthDot ok={miner.health.temp} label="Temp" />
        {uptimeStats && (
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">
            {uptimeStats.uptime_percent.toFixed(0)}% up
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">Runtime: {miner.runtime}</p>

      {!selectionMode && <HashrateChart miner={miner} />}
    </div>
  );
}

type SortDir = "asc" | "desc";

function MinerTable({
  data,
  selectedIps,
  onToggleSelect,
  onRowClick,
  sortCol,
  sortDir,
  onSort,
  uptimeStats,
  coinIconByIp,
  onRemove,
}: {
  data: MinerWithSaved[];
  selectedIps: Set<string>;
  onToggleSelect: (ip: string) => void;
  onRowClick: (ip: string) => void;
  sortCol: string | null;
  sortDir: SortDir;
  onSort: (col: string) => void;
  uptimeStats: Record<string, UptimeStats>;
  coinIconByIp?: Record<string, string | null>;
  onRemove?: (ip: string) => void;
}) {
  const statusBg = (status: string) =>
    ({
      online: "bg-emerald-500",
      offline: "bg-red-500",
      warning: "bg-amber-500",
      unknown: "bg-slate-500",
    }[status] ?? "bg-slate-500");

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
    data.length > 0 && data.every((d) => selectedIps.has(d.info.ip));

  function handleHeaderCheckbox(e: React.MouseEvent) {
    e.stopPropagation();
    if (allSelected) {
      data.forEach((d) => onToggleSelect(d.info.ip));
    } else {
      data.filter((d) => !selectedIps.has(d.info.ip)).forEach((d) => onToggleSelect(d.info.ip));
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
            <Th col="ip" label="IP Address" />
            <Th col="status" label="Status" />
            <Th col="coin" label="Coin" className="hidden md:table-cell" />
            <Th col="hashrate" label="Hashrate" />
            <Th col="temp" label="Avg Temp" />
            <Th col="pool" label="Pool" className="hidden lg:table-cell" />
            <Th col="uptime" label="Uptime (24h)" className="hidden xl:table-cell" />
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ info, saved }, i) => {
            const displayName = resolveDisplayName(info, saved);
            const isSelected = selectedIps.has(info.ip);
            const maxInTmp = info.boards.length
              ? Math.max(...info.boards.map((b) => b.inTmp))
              : null;
            const activePool = info.pools.find((p) => p.connect);
            const rowBg = isSelected
              ? "bg-primary-500/10 hover:bg-primary-500/15"
              : i % 2 === 0
              ? "bg-dark-800 hover:bg-dark-700/50"
              : "bg-dark-800/60 hover:bg-dark-700/50";

            return (
              <tr
                key={info.ip}
                className={`border-t border-slate-700/30 cursor-pointer transition-colors ${rowBg}`}
                onClick={() => onRowClick(info.ip)}
              >
                <td
                  className="pl-4 pr-2 py-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(info.ip);
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
                  <span className="text-sm font-medium text-white">{displayName}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">{info.model}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 font-mono">{info.ip}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${statusBg(info.status)}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                    {info.status}
                  </span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {coinIconByIp?.[info.ip] && (
                    <img src={coinIconByIp[info.ip]!} alt="coin" className="w-5 h-5 rounded-full" />
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {info.rtHashrate}{" "}
                  <span className="text-xs text-slate-500">{info.hashrateUnit}H/s</span>
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {maxInTmp !== null ? `${maxInTmp}°C` : "--"}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 max-w-xs truncate hidden lg:table-cell">
                  {activePool?.addr ?? "--"}
                </td>
                <td className="px-4 py-3 text-xs hidden xl:table-cell">
                  {uptimeStats[info.ip] ? (
                    <span className={`font-medium ${uptimeStats[info.ip].uptime_percent >= 90 ? "text-emerald-400" : uptimeStats[info.ip].uptime_percent >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {uptimeStats[info.ip].uptime_percent.toFixed(0)}%
                    </span>
                  ) : "--"}
                </td>
                <td className="px-4 py-3 text-right">
                  {onRemove && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(info.ip);
                      }}
                      title="Remove miner"
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

type ApplyState = "idle" | "applying" | "success" | "error";
type ViewMode = "card" | "grid";

interface MinerWithSaved {
  info: MinerInfo;
  saved: SavedMiner | undefined;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MinerList() {
  const navigate = useNavigate();
  const { checkAlerts } = useAlerts();
  const [searchParams] = useSearchParams();

  const [minerData, setMinerData] = useState<MinerWithSaved[]>([]);
  const [savedMiners, setSavedMiners] = useState<SavedMiner[]>([]);
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("miners-view-mode");
    return saved === "grid" ? "grid" : "card";
  });

  // Sort state for grid view
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Filters — coin pre-filled from URL param
  const [searchText, setSearchText] = useState("");
  const [filterCoin, setFilterCoin] = useState(() => searchParams.get("coin") ?? "All");
  const [filterMfr, setFilterMfr] = useState("All");
  const [filterModel, setFilterModel] = useState("All");
  const [filterPool, setFilterPool] = useState("All");

  // Selection + bulk apply
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
  const [poolProfiles, setPoolProfiles] = useState<PoolProfile[]>([]);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkProfileId, setBulkProfileId] = useState("");
  const [applyResults, setApplyResults] = useState<
    Record<string, { state: ApplyState; msg: string }>
  >({});
  const [bulkRunning, setBulkRunning] = useState(false);

  // Remove miner(s) state
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeTargetIps, setRemoveTargetIps] = useState<string[]>([]);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [allUptimeStats, setAllUptimeStats] = useState<Record<string, UptimeStats>>({});

  const [showAddPanel, setShowAddPanel] = useState(false);

  // Sync coin filter if URL param changes
  useEffect(() => {
    const coinParam = searchParams.get("coin");
    if (coinParam) setFilterCoin(coinParam);
  }, [searchParams]);

  useEffect(() => {
    invoke<Record<string, UptimeStats>>("get_all_uptime_stats", { hours: 24 })
      .then(setAllUptimeStats)
      .catch(console.error);
  }, []);

  const fetchAllStatuses = useCallback(
    async (saved: SavedMiner[]) => {
      if (saved.length === 0) return;
      const results = await Promise.allSettled(
        saved.map((s) =>
          invoke<MinerInfo>("get_miner_status", { ip: s.ip, manufacturer: s.manufacturer ?? "unknown" }).then((info) => ({ info, saved: s }))
        )
      );
      const data: MinerWithSaved[] = results
        .filter(
          (r): r is PromiseFulfilledResult<{ info: MinerInfo; saved: SavedMiner }> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value);

      results.forEach((r, i) => {
        if (r.status === "rejected") {
          const s = saved[i];
          data.push({
            info: {
              ip: s.ip,
              hostname: s.label,
              mac: "",
              model: "Unknown",
              status: "offline",
              firmware: "",
              software: "",
              online: false,
              rtHashrate: 0,
              avgHashrate: 0,
              hashrateUnit: "G",
              runtime: "--",
              runtimeSecs: 0,
              fans: [],
              boards: [],
              pools: [],
              hashrateHistory: [],
              health: { power: false, network: false, fan: false, temp: false },
              lastSeen: new Date().toISOString(),
              defaultWattage: 100,
            },
            saved: s,
          });
        }
      });

      setMinerData(data);
      setLastRefresh(new Date().toLocaleTimeString());

      const snapshots: MinerSnapshot[] = data.map(({ info, saved: s }) => ({
        ip: info.ip,
        label: resolveDisplayName(info, s),
        online: info.online,
        rtHashrate: info.rtHashrate,
        boards: info.boards.map((b) => ({ inTmp: b.inTmp, outTmp: b.outTmp })),
        acceptedShares: info.pools.reduce((sum, p) => sum + (p.accepted || 0), 0),
      }));
      checkAlerts(snapshots);
    },
    [checkAlerts]
  );

  useEffect(() => {
    Promise.all([
      invoke<SavedMiner[]>("get_saved_miners"),
      invoke<CoinConfig[]>("get_coins"),
      invoke<PoolProfile[]>("get_saved_pools"),
    ])
      .then(([miners, coinList, profiles]) => {
        setSavedMiners(miners);
        setCoins(coinList);
        setPoolProfiles(profiles);
        // Populate with saved data immediately so the page renders before live polls complete
        setMinerData(
          miners.map((s) => ({
            info: {
              ip: s.ip,
              hostname: s.label,
              mac: "",
              model: "...",
              status: "unknown" as const,
              firmware: "",
              software: "",
              online: false,
              rtHashrate: 0,
              avgHashrate: 0,
              hashrateUnit: "G",
              runtime: "--",
              runtimeSecs: 0,
              fans: [],
              boards: [],
              pools: [],
              hashrateHistory: [],
              health: { power: false, network: false, fan: false, temp: false },
              lastSeen: new Date().toISOString(),
              defaultWattage: s.wattage ?? 100,
            },
            saved: s,
          }))
        );
        setLoading(false);
        fetchAllStatuses(miners);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [fetchAllStatuses]);

  useEffect(() => {
    if (savedMiners.length === 0) return;
    const id = setInterval(() => fetchAllStatuses(savedMiners), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [savedMiners, fetchAllStatuses]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await fetchAllStatuses(savedMiners);
    } finally {
      setRefreshing(false);
    }
  }

  // ── Derived filter options ──────────────────────────────────────────────────

  const miners = minerData.map((d) => d.info);

  const uniqueCoins = useMemo(() => {
    const ids = new Set(
      savedMiners.map((s) => {
        const live = minerData.find((d) => d.info.ip === s.ip);
        const activePoolAddr = live?.info.pools.find((p) => p.connect || p.state === 1)?.addr;
        return getMinerCoinId(activePoolAddr, poolProfiles, s.coin_id);
      })
    );
    return ["All", ...Array.from(ids)];
  }, [savedMiners, minerData, poolProfiles]);

  const uniqueManufacturers = useMemo(() => {
    const s = new Set(miners.map((m) => extractManufacturer(m.model)));
    return ["All", ...Array.from(s).sort()];
  }, [miners]);

  const uniqueModels = useMemo(() => {
    const s = new Set(miners.map((m) => m.model));
    return ["All", ...Array.from(s).sort()];
  }, [miners]);

  const uniquePools = useMemo(() => {
    const s = new Set(
      miners.flatMap((m) => m.pools.filter((p) => p.addr).map((p) => p.addr))
    );
    return ["All", ...Array.from(s).sort()];
  }, [miners]);

  // ── Filter + sort ───────────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    const q = searchText.toLowerCase();
    return minerData.filter(({ info, saved }) => {
      if (q) {
        const displayName = resolveDisplayName(info, saved).toLowerCase();
        const poolUser = info.pools.find((p) => p.connect)?.user ?? "";
        const worker = extractWorkerName(poolUser)?.toLowerCase() ?? "";
        const matches =
          displayName.includes(q) ||
          info.ip.includes(q) ||
          info.hostname.toLowerCase().includes(q) ||
          worker.includes(q);
        if (!matches) return false;
      }
      if (filterCoin !== "All") {
        const savedEntry = savedMiners.find((s) => s.ip === info.ip);
        const liveEntry = minerData.find((d) => d.info.ip === info.ip);
        const activePoolAddr = liveEntry?.info.pools.find((p) => p.connect || p.state === 1)?.addr;
        const minerCoinId = getMinerCoinId(activePoolAddr, poolProfiles, savedEntry?.coin_id);
        if (minerCoinId !== filterCoin) return false;
      }
      if (filterMfr !== "All" && extractManufacturer(info.model) !== filterMfr) return false;
      if (filterModel !== "All" && info.model !== filterModel) return false;
      if (filterPool !== "All") {
        const hasPool = info.pools.some((p) => p.addr === filterPool);
        if (!hasPool) return false;
      }
      return true;
    });
  }, [minerData, searchText, filterCoin, filterMfr, filterModel, filterPool, savedMiners]);

  const sortedData = useMemo(() => {
    if (!sortCol) return filteredData;
    return [...filteredData].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortCol) {
        case "name":
          aVal = resolveDisplayName(a.info, a.saved).toLowerCase();
          bVal = resolveDisplayName(b.info, b.saved).toLowerCase();
          break;
        case "ip":
          aVal = a.info.ip;
          bVal = b.info.ip;
          break;
        case "status":
          aVal = a.info.status;
          bVal = b.info.status;
          break;
        case "hashrate":
          aVal = a.info.rtHashrate;
          bVal = b.info.rtHashrate;
          break;
        case "temp":
          aVal = a.info.boards.length ? Math.max(...a.info.boards.map((bd) => bd.inTmp)) : -1;
          bVal = b.info.boards.length ? Math.max(...b.info.boards.map((bd) => bd.inTmp)) : -1;
          break;
        case "pool":
          aVal = a.info.pools.find((p) => p.connect)?.addr ?? "";
          bVal = b.info.pools.find((p) => p.connect)?.addr ?? "";
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortCol, sortDir]);

  const coinIconByIp = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const { info, saved } of sortedData) {
      const activePoolAddr = info.pools.find((p) => p.connect || p.state === 1)?.addr;
      const coinId = getMinerCoinId(activePoolAddr, poolProfiles, saved?.coin_id);
      map[info.ip] = getCoinIcon(coinId);
    }
    return map;
  }, [sortedData, poolProfiles]);

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
    localStorage.setItem("miners-view-mode", mode);
    setSelectedIps(new Set());
    setSelectionMode(false);
    setApplyResults({});
  }

  // ── Selection helpers ───────────────────────────────────────────────────────

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedIps(new Set());
    setApplyResults({});
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

  function selectAll() {
    setSelectedIps(new Set(filteredData.map((d) => d.info.ip)));
  }

  // ── Bulk apply ──────────────────────────────────────────────────────────────

  function openBulkModal() {
    setBulkProfileId(poolProfiles[0]?.id ?? "");
    setApplyResults({});
    setShowBulkModal(true);
  }

  function closeBulkModal() {
    if (bulkRunning) return;
    setShowBulkModal(false);
    setApplyResults({});
  }

  async function runBulkApply() {
    if (!bulkProfileId || bulkRunning) return;
    const profile = poolProfiles.find((p) => p.id === bulkProfileId);
    if (!profile) return;

    const ips = Array.from(selectedIps);
    const initial: Record<string, { state: ApplyState; msg: string }> = {};
    for (const ip of ips) {
      initial[ip] = { state: "idle", msg: "" };
    }
    setApplyResults(initial);
    setBulkRunning(true);

    for (const ip of ips) {
      setApplyResults((prev) => ({ ...prev, [ip]: { state: "applying", msg: "Sending..." } }));
      try {
        const msg = await invoke<string>("set_miner_pools", {
          ip,
          pools: profileToPayload(profile),
        });
        setApplyResults((prev) => ({ ...prev, [ip]: { state: "success", msg } }));
      } catch (err) {
        setApplyResults((prev) => ({ ...prev, [ip]: { state: "error", msg: String(err) } }));
      }
    }

    setBulkRunning(false);
  }

  // ── Remove miner(s) ─────────────────────────────────────────────────────────

  function openRemoveModal(ips: string[]) {
    setRemoveTargetIps(ips);
    setRemoveError(null);
    setShowRemoveModal(true);
  }

  function closeRemoveModal() {
    if (removing) return;
    setShowRemoveModal(false);
    setRemoveTargetIps([]);
    setRemoveError(null);
  }

  async function handleConfirmRemove() {
    if (removeTargetIps.length === 0) return;
    setRemoving(true);
    try {
      let updated: SavedMiner[] = savedMiners;
      for (const ip of removeTargetIps) {
        try {
          updated = await invoke<SavedMiner[]>("remove_miner", { ip });
        } catch (err) {
          console.error(`Failed to remove ${ip}:`, err);
        }
      }
      setSavedMiners(updated);
      // Rebuild minerData from the new savedMiners list
      setMinerData((prev) => prev.filter((d) => updated.some((s) => s.ip === d.info.ip)));
      setSelectedIps(new Set());
      setShowRemoveModal(false);
      setRemoveTargetIps([]);
      // Trigger a fresh poll so statuses are accurate
      fetchAllStatuses(updated);
    } catch (err) {
      console.error("Bulk remove failed:", err);
      setRemoveError(String(err));
    } finally {
      setRemoving(false);
    }
  }

  const bulkDone = !bulkRunning && Object.keys(applyResults).length > 0;
  const effectiveSelectionMode = viewMode === "grid" ? true : selectionMode;

  async function handleExportCSV() {
    try {
      const filePath = await save({ filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (filePath) {
        const csv = await invoke<string>("export_miners_csv");
        await writeTextFile(filePath, csv);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  const hasFilters =
    searchText ||
    filterCoin !== "All" ||
    filterMfr !== "All" ||
    filterModel !== "All" ||
    filterPool !== "All";

  function clearFilters() {
    setSearchText("");
    setFilterCoin("All");
    setFilterMfr("All");
    setFilterModel("All");
    setFilterPool("All");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Miners</h2>
          <p className="text-slate-400 mt-1">All saved miners — click to view details</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <p className="text-xs text-slate-500">Last updated: {lastRefresh}</p>
          )}
          <button
            onClick={() => setShowAddPanel((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {showAddPanel ? "Hide" : "Add Device"}
          </button>
          <button
            onClick={handleExportCSV}
            disabled={savedMiners.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-slate-700/50 hover:border-primary-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing || savedMiners.length === 0}
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

      {showAddPanel && (
        <div className="mb-6">
          <AsicAddDevicePanel
            onClose={() => setShowAddPanel(false)}
            onMinersAdded={() => {
              invoke<SavedMiner[]>("get_saved_miners")
                .then((miners) => {
                  setSavedMiners(miners);
                  fetchAllStatuses(miners);
                })
                .catch(console.error);
            }}
          />
        </div>
      )}

      {/* Search + Filters + View Toggle */}
      {(minerData.length > 0 || loading) && (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-3">
            {/* Search */}
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
                placeholder="Search by name, IP, hostname, or worker..."
                className="w-full bg-dark-800 border border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary-500/70"
              />
            </div>

            {/* View toggle */}
            <div className="flex items-center bg-dark-800 border border-slate-700/50 rounded-lg p-0.5">
              <button
                onClick={() => handleViewModeChange("card")}
                title="Card view"
                className={`p-2 rounded-md transition-colors ${
                  viewMode === "card" ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white"
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
                  viewMode === "grid" ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white"
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

          {/* Filter dropdowns */}
          <div className="flex gap-3 flex-wrap">
            {[
              {
                label: "Coin",
                value: filterCoin,
                options: uniqueCoins.map((id) => {
                  const coin = coins.find((c) => c.id === id);
                  return { value: id, label: coin ? `${coin.name} (${coin.ticker})` : id };
                }),
                set: setFilterCoin,
              },
              {
                label: "Manufacturer",
                value: filterMfr,
                options: uniqueManufacturers.map((o) => ({ value: o, label: o })),
                set: setFilterMfr,
              },
              {
                label: "Model",
                value: filterModel,
                options: uniqueModels.map((o) => ({ value: o, label: o })),
                set: setFilterModel,
              },
              {
                label: "Pool",
                value: filterPool,
                options: uniquePools.map((o) => ({ value: o, label: o })),
                set: setFilterPool,
              },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{f.label}:</span>
                <select
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="bg-dark-800 border border-slate-700/50 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-primary-500/70 cursor-pointer"
                >
                  {f.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
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
      {minerData.length > 0 && (
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
                selectionMode || (viewMode === "grid" && selectedIps.size > 0)
                  ? "px-4 py-2 bg-primary-900/30 border border-primary-500/30 rounded-xl"
                  : ""
              }`}
            >
              <span className="text-sm text-primary-300">
                {selectedIps.size === 0
                  ? viewMode === "card"
                    ? "Click miners to select them"
                    : "Check rows to select miners"
                  : `${selectedIps.size} miner${selectedIps.size > 1 ? "s" : ""} selected`}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {filteredData.length > 0 && selectedIps.size < filteredData.length && (
                  <button
                    onClick={selectAll}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    Select all ({filteredData.length})
                  </button>
                )}
                {selectedIps.size > 0 && (
                  <>
                    <button
                      onClick={() => setSelectedIps(new Set())}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={openBulkModal}
                      disabled={poolProfiles.length === 0}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
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
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      Apply Pool Profile
                    </button>
                    <button
                      onClick={() => openRemoveModal(Array.from(selectedIps))}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Remove
                    </button>
                    {poolProfiles.length === 0 && (
                      <span className="text-xs text-slate-500">
                        (No profiles — go to Settings to create one)
                      </span>
                    )}
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
      ) : minerData.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <svg
            className="w-12 h-12 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
            />
          </svg>
          <p className="text-lg font-medium">No miners found</p>
          <p className="text-sm mt-1">Click "Add Device" above to scan your network or add a miner manually</p>
        </div>
      ) : filteredData.length === 0 ? (
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
        <MinerTable
          data={sortedData}
          selectedIps={selectedIps}
          onToggleSelect={toggleSelect}
          onRowClick={(ip) => navigate(`/miner/${encodeURIComponent(ip)}`)}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
          uptimeStats={allUptimeStats}
          coinIconByIp={coinIconByIp}
          onRemove={(ip) => openRemoveModal([ip])}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredData.map((d) => (
            <MinerCard
              key={d.info.ip}
              miner={d.info}
              displayName={resolveDisplayName(d.info, d.saved)}
              onClick={() => navigate(`/miner/${encodeURIComponent(d.info.ip)}`)}
              selectionMode={selectionMode}
              selected={selectedIps.has(d.info.ip)}
              onSelect={() => toggleSelect(d.info.ip)}
              uptimeStats={allUptimeStats[d.info.ip]}
              coinIcon={coinIconByIp[d.info.ip]}
              onRemove={() => openRemoveModal([d.info.ip])}
            />
          ))}
        </div>
      )}

      {/* Bulk Apply Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeBulkModal}
          />

          <div className="relative z-10 bg-dark-800 border border-slate-700/50 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Apply Pool Profile</h3>
              <button
                onClick={closeBulkModal}
                disabled={bulkRunning}
                className="text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {!bulkRunning && !bulkDone && (
              <div className="mb-5">
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Pool Profile
                </label>
                <select
                  value={bulkProfileId}
                  onChange={(e) => setBulkProfileId(e.target.value)}
                  className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                >
                  {poolProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {bulkProfileId &&
                  (() => {
                    const p = poolProfiles.find((x) => x.id === bulkProfileId);
                    if (!p || !p.pool1addr) return null;
                    return (
                      <div className="mt-2 text-xs text-slate-500">Primary: {p.pool1addr}</div>
                    );
                  })()}
              </div>
            )}

            <div className="space-y-1.5 mb-5 max-h-64 overflow-y-auto">
              {Array.from(selectedIps).map((ip) => {
                const d = minerData.find((x) => x.info.ip === ip);
                const name = d ? resolveDisplayName(d.info, d.saved) : ip;
                const result = applyResults[ip];
                return (
                  <div
                    key={ip}
                    className="flex items-center justify-between px-3 py-2 bg-dark-900 rounded-lg"
                  >
                    <div>
                      <span className="text-sm text-white font-medium">{name}</span>
                      <span className="text-xs text-slate-500 ml-2">{ip}</span>
                    </div>
                    <div className="text-xs ml-2 flex-shrink-0">
                      {!result && <span className="text-slate-500">Pending</span>}
                      {result?.state === "applying" && (
                        <span className="text-amber-400 flex items-center gap-1">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Applying...
                        </span>
                      )}
                      {result?.state === "success" && (
                        <span className="text-emerald-400">✓ Done</span>
                      )}
                      {result?.state === "error" && (
                        <span className="text-red-400" title={result.msg}>
                          ✗ Error
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {bulkRunning && (
              <p className="text-xs text-amber-400 mb-4">
                Applying sequentially — each miner takes 30+ seconds to restart...
              </p>
            )}

            <div className="flex items-center gap-3">
              {!bulkDone && (
                <button
                  onClick={runBulkApply}
                  disabled={bulkRunning || !bulkProfileId}
                  className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {bulkRunning
                    ? `Applying (${
                        Object.values(applyResults).filter(
                          (r) => r.state === "success" || r.state === "error"
                        ).length
                      }/${selectedIps.size})...`
                    : `Apply to ${selectedIps.size} Miner${selectedIps.size > 1 ? "s" : ""}`}
                </button>
              )}
              {bulkDone && (
                <button
                  onClick={closeBulkModal}
                  className="flex-1 px-4 py-2 bg-dark-900 border border-slate-600 hover:border-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Close
                </button>
              )}
              {!bulkRunning && !bulkDone && (
                <button
                  onClick={closeBulkModal}
                  className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remove Miner(s) Confirmation Modal */}
      {showRemoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeRemoveModal}
          />
          <div className="relative z-10 bg-dark-800 border border-red-900/40 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-3">
              Remove {removeTargetIps.length === 1 ? "this miner" : `${removeTargetIps.length} miners`}?
            </h3>
            <div className="text-sm text-slate-300 space-y-3 mb-5">
              <p>Are you sure you want to remove the selected miner{removeTargetIps.length > 1 ? "s" : ""} from PoPManager?</p>
              {removeTargetIps.length <= 10 && (
                <ul className="text-xs text-slate-400 bg-dark-900 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                  {removeTargetIps.map((ip) => {
                    const entry = minerData.find((d) => d.info.ip === ip);
                    const name = entry ? resolveDisplayName(entry.info, entry.saved) : ip;
                    return (
                      <li key={ip} className="font-mono">
                        {name} <span className="text-slate-500">({ip})</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {removeTargetIps.length > 10 && (
                <p className="text-xs text-slate-500">
                  ({removeTargetIps.length} miners will be removed)
                </p>
              )}
              <p className="text-amber-400 text-xs border-l-2 border-amber-500/50 pl-3">
                This only removes the miners from PoPManager's monitoring list. The physical miners themselves are not affected and will continue mining. You can re-add them later via Add Device.
              </p>
            </div>
            {removeError && (
              <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {removeError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={closeRemoveModal}
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
                {removing ? "Removing..." : `Remove ${removeTargetIps.length === 1 ? "Miner" : `${removeTargetIps.length} Miners`}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
