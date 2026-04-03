import { useState, useEffect } from "react";
import type { MinerInfo } from "../types/miner";

function MinerCard({ miner }: { miner: MinerInfo }) {
  const statusColor = {
    online: "bg-emerald-500",
    offline: "bg-red-500",
    warning: "bg-amber-500",
    unknown: "bg-slate-500",
  }[miner.status];

  return (
    <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white">{miner.hostname || miner.ip}</h3>
          <p className="text-sm text-slate-400">{miner.ip} · {miner.model}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${statusColor}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          {miner.status}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Hashrate</p>
          <p className="text-lg font-bold text-white">{(miner.totalHashrate / 1000).toFixed(2)}</p>
          <p className="text-xs text-slate-500">TH/s</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Temp</p>
          <p className="text-lg font-bold text-white">
            {miner.boards.length > 0
              ? Math.max(...miner.boards.map((b) => b.temperature))
              : "--"}
          </p>
          <p className="text-xs text-slate-500">°C</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Pool</p>
          <p className="text-xs font-medium text-white truncate">
            {miner.pools.length > 0 ? miner.pools[0].status : "--"}
          </p>
          <p className="text-xs text-slate-500">active</p>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [miners, setMiners] = useState<MinerInfo[]>([]);

  // Placeholder: load miners on mount
  useEffect(() => {
    // Will call invoke("get_all_miners") once backend is wired up
    setMiners([]);
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-slate-400 mt-1">Monitor all your ASIC miners at a glance</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Miners", value: miners.length, unit: "" },
          { label: "Online", value: miners.filter((m) => m.status === "online").length, unit: "" },
          {
            label: "Total Hashrate",
            value: (miners.reduce((s, m) => s + m.totalHashrate, 0) / 1000).toFixed(2),
            unit: "TH/s",
          },
          {
            label: "Avg Temp",
            value:
              miners.length > 0
                ? (
                    miners.reduce(
                      (s, m) =>
                        s +
                        (m.boards.length > 0
                          ? m.boards.reduce((bs, b) => bs + b.temperature, 0) / m.boards.length
                          : 0),
                      0
                    ) / miners.length
                  ).toFixed(1)
                : "--",
            unit: "°C",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
            <p className="text-sm text-slate-400">{stat.label}</p>
            <p className="text-3xl font-bold text-white mt-1">
              {stat.value}
              {stat.unit && <span className="text-lg text-slate-400 ml-1">{stat.unit}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* Miner cards */}
      {miners.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          <p className="text-lg font-medium">No miners found</p>
          <p className="text-sm mt-1">Go to Miners to scan your network</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {miners.map((m) => (
            <MinerCard key={m.ip} miner={m} />
          ))}
        </div>
      )}
    </div>
  );
}
