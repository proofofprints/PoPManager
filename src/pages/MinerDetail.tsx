import { useState, useEffect, useCallback, useMemo } from "react";
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
import { open as openUrl } from "@tauri-apps/plugin-shell";
import type { MinerInfo, CoinEarnings, PoolProfile, SavedMiner, UptimeStats, CoinConfig } from "../types/miner";
import { profileToPayload } from "../types/miner";
import { useProfitability } from "../context/ProfitabilityContext";
import { getMinerCoinId } from "../utils/coinLookup";
import { getCoinIcon } from "../utils/coinIcon";

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
  const { currency, poolFeePercent: defaultFeePercent, electricityCostPerKwh, minerWattage } = useProfitability();
  const currencyCode = currency.toUpperCase();
  const [miner, setMiner] = useState<MinerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<CoinEarnings | null>(null);
  const [savedCoinId, setSavedCoinId] = useState<string>("kaspa");
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const [poolFeePercent, setPoolFeePercent] = useState(defaultFeePercent);
  const [poolProfiles, setPoolProfiles] = useState<PoolProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [applyingPool, setApplyingPool] = useState(false);
  const [applyStatus, setApplyStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [thisWattage, setThisWattage] = useState<number>(minerWattage);
  const [wattageEditing, setWattageEditing] = useState(false);
  const [wattageInput, setWattageInput] = useState<string>("");
  const [uptime24h, setUptime24h] = useState<UptimeStats | null>(null);
  const [uptime7d, setUptime7d] = useState<UptimeStats | null>(null);
  const [uptime30d, setUptime30d] = useState<UptimeStats | null>(null);

  const decodedIp = ip ? decodeURIComponent(ip) : "";

  const coinId = useMemo(() => {
    if (!miner) return savedCoinId;
    const activePoolAddr = miner.pools.find((p) => p.connect || p.state === 1)?.addr;
    return getMinerCoinId(activePoolAddr, poolProfiles, savedCoinId);
  }, [miner, poolProfiles, savedCoinId]);

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

  useEffect(() => {
    setPoolFeePercent(defaultFeePercent);
  }, [defaultFeePercent]);

  useEffect(() => {
    invoke<PoolProfile[]>("get_saved_pools")
      .then(setPoolProfiles)
      .catch(console.error);
  }, []);

  useEffect(() => {
    invoke<SavedMiner[]>("get_saved_miners").then((miners) => {
      const found = miners.find((m) => m.ip === decodedIp);
      if (found) {
        setThisWattage(found.wattage ?? minerWattage);
        setSavedCoinId(found.coin_id ?? "kaspa");
      }
    }).catch(console.error);
  }, [decodedIp, minerWattage]);

  useEffect(() => {
    invoke<CoinConfig[]>("get_coins").then(setCoins).catch(console.error);
  }, []);

  useEffect(() => {
    if (!decodedIp) return;
    invoke<UptimeStats>("get_uptime_stats", { ip: decodedIp, hours: 24 }).then(setUptime24h).catch(console.error);
    invoke<UptimeStats>("get_uptime_stats", { ip: decodedIp, hours: 168 }).then(setUptime7d).catch(console.error);
    invoke<UptimeStats>("get_uptime_stats", { ip: decodedIp, hours: 720 }).then(setUptime30d).catch(console.error);
  }, [decodedIp]);

  async function handleApplyPool() {
    if (!selectedProfileId || !decodedIp) return;
    const profile = poolProfiles.find((p) => p.id === selectedProfileId);
    if (!profile) return;
    setApplyingPool(true);
    setApplyStatus(null);
    try {
      const msg = await invoke<string>("set_miner_pools", {
        ip: decodedIp,
        pools: profileToPayload(profile),
      });
      setApplyStatus({ ok: true, msg });
      // Refresh miner data after a short delay to let it come back online
      setTimeout(fetchStatus, 3000);
    } catch (err) {
      setApplyStatus({ ok: false, msg: String(err) });
    } finally {
      setApplyingPool(false);
    }
  }

  useEffect(() => {
    if (!miner || !miner.online) return;
    invoke<CoinEarnings>("calculate_coin_earnings", {
      coinId,
      hashrateGhs: miner.rtHashrate,
      poolFeePercent,
      currency,
    })
      .then(setEarnings)
      .catch(console.error);
  }, [miner, poolFeePercent, currency, coinId]);

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
          <button
            onClick={() => openUrl(`http://${decodedIp}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-slate-700/50 hover:border-primary-500/50 text-slate-300 hover:text-white text-xs font-medium rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Miner UI
          </button>
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

      {/* Uptime Stats */}
      {(uptime24h || uptime7d || uptime30d) && (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
            Uptime Statistics
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: "24h Uptime", stats: uptime24h },
              { label: "7d Uptime", stats: uptime7d },
              { label: "30d Uptime", stats: uptime30d },
            ].map(({ label, stats }) => (
              <div key={label} className="bg-dark-900 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className="text-2xl font-bold text-white">
                  {stats ? stats.uptime_percent.toFixed(1) : "--"}
                  {stats && <span className="text-sm text-slate-400 ml-1">%</span>}
                </p>
                {stats && (
                  <p className="text-xs text-slate-500 mt-1">
                    {stats.online_polls}/{stats.total_polls} polls online
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs text-slate-400">
            <div>
              <span className="text-slate-500">Last Downtime: </span>
              {uptime24h?.last_downtime ? (
                <span className="text-white">
                  {Math.round((Date.now() / 1000 - uptime24h.last_downtime) / 3600)} hours ago
                </span>
              ) : (
                <span className="text-emerald-400">No downtime recorded</span>
              )}
            </div>
            <div>
              <span className="text-slate-500">Current Streak: </span>
              {uptime24h ? (
                <span className={uptime24h.is_online ? "text-emerald-400" : "text-red-400"}>
                  {Math.floor(uptime24h.current_streak_minutes / 60)}h {uptime24h.current_streak_minutes % 60}m {uptime24h.is_online ? "online" : "offline"}
                </span>
              ) : (
                <span className="text-slate-500">--</span>
              )}
            </div>
          </div>
          <p className="text-xs italic text-slate-500 mt-3">
            Uptime tracked while PoPManager is running
          </p>
        </div>
      )}

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

      {/* Estimated Earnings */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            {getCoinIcon(coinId) && (
              <img src={getCoinIcon(coinId)!} alt={coinId} className="w-4 h-4 rounded-full" />
            )}
            Estimated Earnings
          </h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Pool fee:</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={poolFeePercent}
              onChange={(e) => setPoolFeePercent(parseFloat(e.target.value) || 0)}
              className="w-16 bg-dark-900 border border-slate-700/50 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-primary-500/70"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
        </div>
        {earnings ? (() => {
          const coin = coins.find((c) => c.id === coinId);
          const ticker = coin?.ticker ?? coinId.toUpperCase();
          const coinDecimals = ticker === "BTC" ? 6 : 2;
          const weeklyCoins = earnings.dailyCoins * 7;
          const weeklyFiat = earnings.dailyFiat * 7;
          const dailyPowerKwh = thisWattage / 1000 * 24;
          const dailyPowerCost = dailyPowerKwh * electricityCostPerKwh;
          const dailyNet = earnings.dailyFiat - dailyPowerCost;
          const monthlyNet = dailyNet * 30;
          return (
            <>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Daily", coins: earnings.dailyCoins, fiat: earnings.dailyFiat, net: dailyNet },
                  { label: "Weekly", coins: weeklyCoins, fiat: weeklyFiat, net: dailyNet * 7 },
                  { label: "Monthly", coins: earnings.monthlyCoins, fiat: earnings.monthlyFiat, net: monthlyNet },
                ].map((row) => (
                  <div key={row.label} className="bg-dark-900 rounded-lg p-4">
                    <p className="text-xs text-slate-400 mb-1">{row.label}</p>
                    <p className="text-xl font-bold text-emerald-400">
                      {row.coins.toFixed(coinDecimals)}
                      <span className="text-sm text-slate-400 ml-1">{ticker}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{row.fiat.toFixed(2)} {currencyCode} gross</p>
                    <p className={`text-xs font-medium mt-1 ${row.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {row.net.toFixed(2)} {currencyCode} net
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700/30 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                <span>Power: {dailyPowerKwh.toFixed(1)} kWh/day · {dailyPowerCost.toFixed(3)} {currencyCode}/day</span>
                <span>{ticker}: {earnings.coinPrice.toFixed(4)} {currencyCode}</span>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-slate-500">Wattage:</span>
                  {wattageEditing ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={wattageInput}
                        onChange={(e) => setWattageInput(e.target.value)}
                        className="w-20 bg-dark-800 border border-primary-500/50 rounded px-2 py-0.5 text-xs text-white focus:outline-none"
                      />
                      <button
                        onClick={async () => {
                          const w = parseFloat(wattageInput) || thisWattage;
                          await invoke("update_miner_wattage", { ip: decodedIp, wattage: w });
                          setThisWattage(w);
                          setWattageEditing(false);
                        }}
                        className="text-xs text-emerald-400 hover:text-emerald-300"
                      >Save</button>
                      <button onClick={() => setWattageEditing(false)} className="text-xs text-slate-500">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-300">{thisWattage}W</span>
                      <button
                        onClick={() => { setWattageInput(String(thisWattage)); setWattageEditing(true); }}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >Edit</button>
                    </>
                  )}
                </div>
              </div>
            </>
          );
        })() : (
          <p className="text-xs text-slate-500">
            {miner.online ? "Fetching earnings data..." : "Miner is offline"}
          </p>
        )}
      </div>

      {/* Hashrate history chart */}
      <HashrateDetailChart miner={miner} />

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

      {/* Apply Pool Configuration */}
      <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
          Apply Pool Configuration
        </h3>
        {poolProfiles.length === 0 ? (
          <p className="text-xs text-slate-500">
            No pool profiles saved. Go to Settings to create one.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={selectedProfileId}
                onChange={(e) => {
                  setSelectedProfileId(e.target.value);
                  setApplyStatus(null);
                }}
                className="flex-1 min-w-[200px] bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
              >
                <option value="">Select a profile...</option>
                {poolProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleApplyPool}
                disabled={!selectedProfileId || applyingPool}
                className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
              >
                {applyingPool ? "Applying..." : "Apply"}
              </button>
            </div>

            {applyingPool && (
              <p className="text-xs text-amber-400">
                Sending config — miner will restart mining process (may take 30+ seconds)...
              </p>
            )}

            {applyStatus && (
              <p className={`text-xs ${applyStatus.ok ? "text-emerald-400" : "text-red-400"}`}>
                {applyStatus.ok ? "✓ " : "✗ "}{applyStatus.msg}
              </p>
            )}

            {selectedProfileId && (() => {
              const p = poolProfiles.find((x) => x.id === selectedProfileId);
              if (!p || !p.pool1addr) return null;
              return (
                <div className="bg-dark-900 rounded-lg px-3 py-2 text-xs space-y-1">
                  {[1, 2, 3].map((n) => {
                    const addr = p[`pool${n}addr` as keyof PoolProfile];
                    if (!addr) return null;
                    return (
                      <div key={n}>
                        <span className="text-slate-500">Pool {n}: </span>
                        <span className="text-slate-300">{addr}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </div>

    </div>
  );
}
