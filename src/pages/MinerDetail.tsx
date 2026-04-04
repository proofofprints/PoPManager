import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { invoke } from "@tauri-apps/api/core";
import type { MinerInfo } from "../types/miner";

const POLL_INTERVAL_MS = 45_000;

const HEALTH_COLORS: Record<string, string> = {
  ok: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  fail: "bg-red-500/20 text-red-400 border-red-500/30",
};

function HealthBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        ok ? HEALTH_COLORS.ok : HEALTH_COLORS.fail
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
      {label}
    </span>
  );
}

// BOARD_COLORS for multi-board chart lines
const BOARD_COLORS = ["#06b6d4", "#6366f1", "#f59e0b", "#10b981"];

function HashrateDetailChart({ miner }: { miner: MinerInfo }) {
  if (!miner.hashrateHistory.length) return null;

  // Build combined chart data keyed by label index
  const maxLen = Math.max(...miner.hashrateHistory.map((h) => h.values.length));
  const labels = miner.hashrateHistory[0].labels;

  const chartData = Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, string | number> = { label: labels[i] ?? `${i * 5} mins` };
    miner.hashrateHistory.forEach((h) => {
      point[h.board] = h.values[i] ?? 0;
    });
    return point;
  });

  return (
    <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Hashrate History ({miner.hashrateUnit}H/s)
      </h3>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData}>
          <defs>
            {miner.hashrateHistory.map((h, i) => (
              <linearGradient key={h.board} id={`grad-${h.board}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={BOARD_COLORS[i % BOARD_COLORS.length]} stopOpacity={0.25} />
                <stop offset="95%" stopColor={BOARD_COLORS[i % BOARD_COLORS.length]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={["auto", "auto"]}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid rgba(148,163,184,0.15)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(v: number, name: string) => [`${v} ${miner.hashrateUnit}H/s`, name]}
          />
          {miner.hashrateHistory.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {miner.hashrateHistory.map((h, i) => (
            <Area
              key={h.board}
              type="monotone"
              dataKey={h.board}
              stroke={BOARD_COLORS[i % BOARD_COLORS.length]}
              strokeWidth={2}
              fill={`url(#grad-${h.board})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MinerDetail() {
  const { ip } = useParams<{ ip: string }>();
  const navigate = useNavigate();
  const [miner, setMiner] = useState<MinerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const decodedIp = ip ? decodeURIComponent(ip) : "";

  const fetchStatus = useCallback(async () => {
    if (!decodedIp) return;
    try {
      const info = await invoke<MinerInfo>("get_miner_status", { ip: decodedIp });
      setMiner(info);
      setError(null);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      setError(String(err));
    }
  }, [decodedIp]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  if (error && !miner) {
    return (
      <div className="p-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="text-center py-20 text-slate-500">
          <p className="text-lg font-medium text-red-400">Could not reach miner</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            onClick={fetchStatus}
            className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!miner) {
    return (
      <div className="p-8 flex items-center justify-center py-32">
        <div className="text-slate-400 text-sm">Loading miner data...</div>
      </div>
    );
  }

  const statusColor = {
    online: "bg-emerald-500",
    offline: "bg-red-500",
    warning: "bg-amber-500",
    unknown: "bg-slate-500",
  }[miner.status] ?? "bg-slate-500";

  const activePool = miner.pools.find((p) => p.connect || p.state === 1);

  return (
    <div className="p-8 space-y-6">
      {/* Back button + header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white">{miner.hostname || miner.ip}</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {miner.ip} · {miner.model}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <p className="text-xs text-slate-500">Updated: {lastRefresh}</p>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white ${statusColor}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
            {miner.status}
          </span>
        </div>
      </div>

      {/* Health badges */}
      <div className="flex flex-wrap gap-2">
        <HealthBadge ok={miner.health.power} label="Power" />
        <HealthBadge ok={miner.health.network} label="Network" />
        <HealthBadge ok={miner.health.fan} label="Fan" />
        <HealthBadge ok={miner.health.temp} label="Temperature" />
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "RT Hashrate", value: `${miner.rtHashrate} ${miner.hashrateUnit}H/s` },
          { label: "Avg Hashrate", value: `${miner.avgHashrate} ${miner.hashrateUnit}H/s` },
          { label: "Uptime", value: miner.runtime },
          { label: "MAC Address", value: miner.mac || "--" },
        ].map((s) => (
          <div key={s.label} className="bg-dark-800 rounded-xl border border-slate-700/50 p-4">
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className="text-base font-semibold text-white mt-1 font-mono">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Firmware & Software */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
          Firmware
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Firmware Version</p>
            <p className="text-slate-200 mt-0.5 font-mono">{miner.firmware || "--"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Software Version</p>
            <p className="text-slate-200 mt-0.5 font-mono">{miner.software || "--"}</p>
          </div>
        </div>
      </div>

      {/* Board details */}
      {miner.boards.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/50">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Boards ({miner.boards.length})
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700/50">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-6 py-3">Board</th>
                <th className="text-right px-6 py-3">Chips</th>
                <th className="text-right px-6 py-3">Freq (MHz)</th>
                <th className="text-right px-6 py-3">Hashrate</th>
                <th className="text-right px-6 py-3">Inlet °C</th>
                <th className="text-right px-6 py-3">Outlet °C</th>
                <th className="text-center px-6 py-3">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {miner.boards.map((b) => (
                <tr key={b.no} className="hover:bg-slate-800/30">
                  <td className="px-6 py-3 font-medium text-white">Board {b.no}</td>
                  <td className="px-6 py-3 text-right text-slate-300">{b.chipNum}</td>
                  <td className="px-6 py-3 text-right text-slate-300">{b.freq}</td>
                  <td className="px-6 py-3 text-right text-slate-300">{b.rtPow}</td>
                  <td className="px-6 py-3 text-right">
                    <span className={b.inTmp > 75 ? "text-amber-400" : "text-slate-300"}>
                      {b.inTmp}°
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className={b.outTmp > 85 ? "text-red-400" : "text-slate-300"}>
                      {b.outTmp}°
                    </span>
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        b.state ? "bg-emerald-400" : "bg-red-400"
                      }`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fan speeds */}
      {miner.fans.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Fan Speeds
          </h3>
          <div className="flex gap-4 flex-wrap">
            {miner.fans.map((rpm, i) => (
              <div key={i} className="bg-dark-900 rounded-lg px-4 py-3 text-center min-w-[80px]">
                <p className="text-xs text-slate-500 mb-1">Fan {i + 1}</p>
                <p className="text-base font-bold text-white">{rpm > 0 ? rpm : "--"}</p>
                <p className="text-xs text-slate-500">RPM</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pool details */}
      {miner.pools.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/50">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Pool Configuration
            </h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {miner.pools.map((pool) => {
              const isActive = pool.connect || pool.state === 1;
              return (
                <div key={pool.no} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-300">
                      Pool {pool.no}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                    <div>
                      <span className="text-slate-500">Address: </span>
                      <span className="text-slate-300 break-all">{pool.addr || "--"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Worker: </span>
                      <span className="text-slate-300">{pool.user || "--"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Accepted: </span>
                      <span className="text-emerald-400 font-medium">
                        {pool.accepted.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Rejected: </span>
                      <span className={pool.rejected > 0 ? "text-red-400 font-medium" : "text-slate-300"}>
                        {pool.rejected.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Difficulty: </span>
                      <span className="text-slate-300">{pool.diff || "--"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hashrate history chart */}
      <HashrateDetailChart miner={miner} />
    </div>
  );
}
