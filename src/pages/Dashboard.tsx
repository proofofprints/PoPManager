import { useState, useEffect, useCallback, useMemo } from "react";
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
import type { MinerInfo, SavedMiner } from "../types/miner";

const POLL_INTERVAL_MS = 45_000;

/** Extract worker name from pool user string like "kaspa:addr.KS0_2" → "KS0_2" */
function extractWorkerName(user: string): string | null {
  const dot = user.lastIndexOf(".");
  if (dot !== -1 && dot < user.length - 1) {
    return user.slice(dot + 1);
  }
  return null;
}

/** Resolve display name using priority: custom label → worker name → hostname → IP */
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

/** First word of model string as manufacturer (e.g. "Iceriver KS0" → "Iceriver") */
function extractManufacturer(model: string): string {
  return model.split(" ")[0] || model;
}

function HealthDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-500"}`}
      />
      <span className={`text-xs ${ok ? "text-slate-400" : "text-red-400"}`}>
        {label}
      </span>
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
            contentStyle={{ background: "#1e293b", border: "none", borderRadius: 6, fontSize: 11 }}
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
}: {
  miner: MinerInfo;
  displayName: string;
  onClick: () => void;
}) {
  const statusColor = {
    online: "bg-emerald-500",
    offline: "bg-red-500",
    warning: "bg-amber-500",
    unknown: "bg-slate-500",
  }[miner.status] ?? "bg-slate-500";

  const maxInTmp = miner.boards.length
    ? Math.max(...miner.boards.map((b) => b.inTmp))
    : null;
  const maxOutTmp = miner.boards.length
    ? Math.max(...miner.boards.map((b) => b.outTmp))
    : null;
  const activeFans = miner.fans.filter((f) => f > 0);
  const activePool = miner.pools.find((p) => p.connect);

  return (
    <div
      className="bg-dark-800 rounded-xl border border-slate-700/50 p-5 cursor-pointer hover:border-primary-500/50 hover:bg-dark-800/80 transition-all"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white">{displayName}</h3>
          <p className="text-sm text-slate-400">
            {miner.ip} · {miner.model}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{miner.firmware}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${statusColor}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          {miner.status}
        </span>
      </div>

      {/* Stats grid */}
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

      {/* Pool info */}
      {activePool && (
        <div className="bg-dark-900 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-slate-400">Active Pool</p>
          <p className="text-xs text-slate-300 truncate mt-0.5">{activePool.addr}</p>
          <p className="text-xs text-slate-500">
            Accepted: {activePool.accepted.toLocaleString()} · Diff: {activePool.diff}
          </p>
        </div>
      )}

      {/* Health indicators */}
      <div className="flex gap-3 mb-2">
        <HealthDot ok={miner.health.power} label="Power" />
        <HealthDot ok={miner.health.network} label="Net" />
        <HealthDot ok={miner.health.fan} label="Fan" />
        <HealthDot ok={miner.health.temp} label="Temp" />
      </div>

      {/* Runtime */}
      <p className="text-xs text-slate-500">Runtime: {miner.runtime}</p>

      {/* Hashrate chart */}
      <HashrateChart miner={miner} />
    </div>
  );
}

interface MinerWithSaved {
  info: MinerInfo;
  saved: SavedMiner | undefined;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [minerData, setMinerData] = useState<MinerWithSaved[]>([]);
  const [savedMiners, setSavedMiners] = useState<SavedMiner[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Search & filter state
  const [searchText, setSearchText] = useState("");
  const [filterMfr, setFilterMfr] = useState("All");
  const [filterModel, setFilterModel] = useState("All");
  const [filterPool, setFilterPool] = useState("All");

  const fetchAllStatuses = useCallback(async (saved: SavedMiner[]) => {
    if (saved.length === 0) return;
    const results = await Promise.allSettled(
      saved.map((s) =>
        invoke<MinerInfo>("get_miner_status", { ip: s.ip })
          .then((info) => ({ info, saved: s }))
      )
    );
    const data: MinerWithSaved[] = results
      .filter((r): r is PromiseFulfilledResult<MinerWithSaved> => r.status === "fulfilled")
      .map((r) => r.value);

    // For miners that failed (offline), create a minimal offline entry
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
          },
          saved: s,
        });
      }
    });

    setMinerData(data);
    setLastRefresh(new Date().toLocaleTimeString());
  }, []);

  // Load saved miners and fetch statuses on mount
  useEffect(() => {
    invoke<SavedMiner[]>("get_saved_miners")
      .then((saved) => {
        setSavedMiners(saved);
        fetchAllStatuses(saved);
      })
      .catch(console.error);
  }, [fetchAllStatuses]);

  // Auto-refresh every 45 seconds
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

  const miners = minerData.map((d) => d.info);
  const totalRtHashrate = miners.reduce((s, m) => s + m.rtHashrate, 0);
  const onlineCount = miners.filter((m) => m.online).length;
  const unit = miners.find((m) => m.online)?.hashrateUnit ?? "G";
  const allBoards = miners.flatMap((m) => m.boards);
  const avgInTemp =
    allBoards.length > 0
      ? (allBoards.reduce((s, b) => s + b.inTmp, 0) / allBoards.length).toFixed(1)
      : "--";

  // Unique filter options derived from actual miner data
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

  // Filtered miner list
  const filteredData = useMemo(() => {
    const q = searchText.toLowerCase();
    return minerData.filter(({ info, saved }) => {
      // Search filter
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
      // Manufacturer filter
      if (filterMfr !== "All" && extractManufacturer(info.model) !== filterMfr) return false;
      // Model filter
      if (filterModel !== "All" && info.model !== filterModel) return false;
      // Pool filter
      if (filterPool !== "All") {
        const hasPool = info.pools.some((p) => p.addr === filterPool);
        if (!hasPool) return false;
      }
      return true;
    });
  }, [minerData, searchText, filterMfr, filterModel, filterPool]);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-slate-400 mt-1">Monitor all your ASIC miners at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <p className="text-xs text-slate-500">Last updated: {lastRefresh}</p>
          )}
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

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Miners", value: miners.length, unit: "" },
          { label: "Online", value: onlineCount, unit: "" },
          { label: "Total Hashrate", value: totalRtHashrate.toFixed(1), unit: `${unit}H/s` },
          { label: "Avg Temp", value: avgInTemp, unit: avgInTemp !== "--" ? "°C" : "" },
        ].map((stat) => (
          <div key={stat.label} className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
            <p className="text-sm text-slate-400">{stat.label}</p>
            <p className="text-3xl font-bold text-white mt-1">
              {stat.value}
              {stat.unit && (
                <span className="text-lg text-slate-400 ml-1">{stat.unit}</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      {minerData.length > 0 && (
        <div className="mb-6 space-y-3">
          {/* Search bar */}
          <div className="relative">
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

          {/* Filter dropdowns */}
          <div className="flex gap-3 flex-wrap">
            {[
              { label: "Manufacturer", value: filterMfr, options: uniqueManufacturers, set: setFilterMfr },
              { label: "Model", value: filterModel, options: uniqueModels, set: setFilterModel },
              { label: "Pool", value: filterPool, options: uniquePools, set: setFilterPool },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{f.label}:</span>
                <select
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="bg-dark-800 border border-slate-700/50 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-primary-500/70 cursor-pointer"
                >
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {(searchText || filterMfr !== "All" || filterModel !== "All" || filterPool !== "All") && (
              <button
                onClick={() => {
                  setSearchText("");
                  setFilterMfr("All");
                  setFilterModel("All");
                  setFilterPool("All");
                }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Miner cards */}
      {minerData.length === 0 ? (
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
          <p className="text-sm mt-1">Go to Miners to add or scan for miners</p>
        </div>
      ) : filteredData.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-lg font-medium">No miners match your filters</p>
          <button
            onClick={() => {
              setSearchText("");
              setFilterMfr("All");
              setFilterModel("All");
              setFilterPool("All");
            }}
            className="text-sm mt-2 text-primary-400 hover:text-primary-300"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredData.map((d) => (
            <MinerCard
              key={d.info.ip}
              miner={d.info}
              displayName={resolveDisplayName(d.info, d.saved)}
              onClick={() => navigate(`/miner/${encodeURIComponent(d.info.ip)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
