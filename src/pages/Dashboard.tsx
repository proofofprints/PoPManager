import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { debug } from "../utils/logger";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { MinerInfo, SavedMiner, CoinEarnings, CoinConfig, FarmSnapshot, UptimeStats, MobileMiner } from "../types/miner";
import { getMinerCoinId } from "../utils/coinLookup";
import { getCoinIcon } from "../utils/coinIcon";
import { useAlerts } from "../context/AlertContext";
import { useProfitability } from "../context/ProfitabilityContext";
import type { MinerSnapshot, MobileMinerSnapshot } from "../types/alerts";
import { formatMobileHashrate } from "./MobileMinerList";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

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

type CoinViewMode = "card" | "list";

interface MinerWithSaved {
  info: MinerInfo;
  saved: SavedMiner | undefined;
}

interface CoinGroup {
  coinId: string;
  coin: CoinConfig | undefined;
  count: number;
  onlineCount: number;
  offlineCount: number;
  totalHashrate: number;
  hashrateUnit: string;
  asicCount: number;
  mobileCount: number;
}

const COIN_TICKER_TO_ID: Record<string, string> = { KAS: "kaspa", BTC: "bitcoin" };
function coinIdFromTicker(ticker: string): string {
  if (!ticker) return "kaspa";
  return COIN_TICKER_TO_ID[ticker.toUpperCase()] ?? ticker.toLowerCase();
}

type ProfitRange = 1 | 6 | 24 | 168 | 720;
type ChartRange = 1 | 6 | 24 | 168 | 720;

function StatCard({
  label,
  value,
  unit,
  subline,
}: {
  label: string;
  value: string | number;
  unit?: string;
  subline?: string;
}) {
  return (
    <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="text-3xl font-bold text-white mt-1">
        {value}
        {unit && <span className="text-lg text-slate-400 ml-1">{unit}</span>}
      </p>
      {subline && <p className="text-xs text-emerald-400 mt-1">{subline}</p>}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { checkAlerts, checkMobileAlerts } = useAlerts();
  const { currency, poolFeePercent, electricityCostPerKwh, minerWattage, poolProfiles } = useProfitability();
  const currencyCode = currency.toUpperCase();
  const [minerData, setMinerData] = useState<MinerWithSaved[]>([]);
  const [mobileMiners, setMobileMiners] = useState<MobileMiner[]>([]);
  const [savedMiners, setSavedMiners] = useState<SavedMiner[]>([]);
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [coinEarnings, setCoinEarnings] = useState<Record<string, CoinEarnings>>({});
  const [coinViewMode, setCoinViewMode] = useState<CoinViewMode>(() => {
    const saved = localStorage.getItem("dashboard-coin-view");
    return saved === "list" ? "list" : "card";
  });
  const [farmHistory, setFarmHistory] = useState<FarmSnapshot[]>([]);
  const [chartRange, setChartRange] = useState<ChartRange>(24);
  const [profitRange, setProfitRange] = useState<ProfitRange>(24);
  const [fleetUptime, setFleetUptime] = useState<number | null>(null);
  const pollCycleRef = useRef(0);

  function getPoolFeeForMiner(info: MinerInfo): number {
    const activePool = info.pools.find((p) => p.connect || p.state === 1);
    if (activePool && activePool.addr) {
      for (const profile of poolProfiles) {
        if (
          profile.pool1addr === activePool.addr ||
          profile.pool2addr === activePool.addr ||
          profile.pool3addr === activePool.addr
        ) {
          return profile.fee_percent ?? poolFeePercent;
        }
      }
    }
    return poolFeePercent;
  }

  const fetchAllStatuses = useCallback(async (saved: SavedMiner[]) => {
    if (saved.length === 0) return;
    debug(`Poll cycle start: ${saved.length} miner(s)`).catch(() => {});
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

    const onlineCount = data.filter((d) => d.info.online).length;
    debug(`Poll cycle complete: ${onlineCount}/${data.length} online`).catch(() => {});
    setMinerData(data);
    setLastRefresh(new Date().toLocaleTimeString());

    // Record uptime for each miner
    data.forEach(({ info }) => {
      invoke("record_uptime", { ip: info.ip, online: info.status === "online" }).catch(console.error);
    });

    // Fetch fleet uptime stats
    invoke<Record<string, UptimeStats>>("get_all_uptime_stats", { hours: 24 })
      .then((stats) => {
        const values = Object.values(stats);
        if (values.length > 0) {
          const avg = values.reduce((s, v) => s + v.uptime_percent, 0) / values.length;
          setFleetUptime(avg);
        }
      })
      .catch(console.error);

    pollCycleRef.current += 1;
    if (pollCycleRef.current % 5 === 1) {
      const onlineData = data.filter((d) => d.info.online);
      const totalHashrate = onlineData.reduce((s, d) => s + d.info.rtHashrate, 0);
      const coinDataMap: Record<string, { hashrate: number; minerCount: number }> = {};
      for (const { info, saved: s } of onlineData) {
        const activePoolAddr = info.pools.find((p) => p.connect || p.state === 1)?.addr;
        const cid = getMinerCoinId(activePoolAddr, poolProfiles, s?.coin_id);
        if (!coinDataMap[cid]) coinDataMap[cid] = { hashrate: 0, minerCount: 0 };
        coinDataMap[cid].hashrate += info.rtHashrate;
        coinDataMap[cid].minerCount += 1;
      }
      const coinData: FarmSnapshot["coinData"] = {};
      for (const [cid, d] of Object.entries(coinDataMap)) {
        coinData[cid] = { hashrate: d.hashrate, minerCount: d.minerCount, dailyEarningsCoins: 0, dailyEarningsFiat: 0 };
      }
      const snapshot: FarmSnapshot = {
        timestamp: Math.floor(Date.now() / 1000),
        totalHashrate,
        onlineCount: onlineData.length,
        totalMiners: data.length,
        coinData,
      };
      invoke("add_farm_snapshot", { snapshot }).catch(console.error);
      invoke<FarmSnapshot[]>("get_farm_history", { hours: 720 })
        .then(setFarmHistory)
        .catch(console.error);
    }

    const snapshots: MinerSnapshot[] = data.map(({ info, saved: s }) => ({
      ip: info.ip,
      label: resolveDisplayName(info, s),
      online: info.online,
      rtHashrate: info.rtHashrate,
      boards: info.boards.map((b) => ({ inTmp: b.inTmp, outTmp: b.outTmp })),
      acceptedShares: info.pools.reduce((sum, p) => sum + (p.accepted || 0), 0),
    }));
    checkAlerts(snapshots);

    // Fetch mobile miners + evaluate mobile alerts
    try {
      const mobileList = await invoke<MobileMiner[]>("get_mobile_miners");
      setMobileMiners(mobileList);
      const mobileSnapshots: MobileMinerSnapshot[] = mobileList.map((m) => ({
        deviceId: m.deviceId,
        name: m.name,
        isOnline: m.isOnline,
        batteryLevel: m.batteryLevel,
        batteryCharging: m.batteryCharging,
        cpuTemp: m.cpuTemp,
        throttleState: m.throttleState,
      }));
      checkMobileAlerts(mobileSnapshots);
    } catch (err) {
      console.error("Failed to load mobile miners:", err);
    }
  }, [checkAlerts, checkMobileAlerts, poolProfiles]);

  const fetchCoinEarnings = useCallback((groups: CoinGroup[], allMinerData: MinerWithSaved[]) => {
    groups.forEach(({ coinId, totalHashrate }) => {
      if (totalHashrate <= 0) return;
      const coinMiners = allMinerData.filter((d) => {
        if (!d.info.online) return false;
        const activePoolAddr = d.info.pools.find((p) => p.connect || p.state === 1)?.addr;
        return getMinerCoinId(activePoolAddr, poolProfiles, d.saved?.coin_id) === coinId;
      });
      let weightedFee = poolFeePercent;
      if (coinMiners.length > 0) {
        const totalH = coinMiners.reduce((s, d) => s + d.info.rtHashrate, 0);
        if (totalH > 0) {
          weightedFee = coinMiners.reduce((s, d) => {
            const fee = getPoolFeeForMiner(d.info);
            return s + fee * (d.info.rtHashrate / totalH);
          }, 0);
        }
      }
      invoke<CoinEarnings>("calculate_coin_earnings", {
        coinId,
        hashrateGhs: totalHashrate,
        poolFeePercent: weightedFee,
        currency,
      })
        .then((est) => setCoinEarnings((prev) => ({ ...prev, [coinId]: est })))
        .catch(console.error);
    });
  }, [poolFeePercent, currency, poolProfiles]);

  useEffect(() => {
    invoke<SavedMiner[]>("get_saved_miners")
      .then((saved) => {
        setSavedMiners(saved);
        setInitialLoaded(true);
        fetchAllStatuses(saved);
      })
      .catch(() => setInitialLoaded(true));
    invoke<CoinConfig[]>("get_coins").then(setCoins).catch(console.error);
    invoke<FarmSnapshot[]>("get_farm_history", { hours: 720 })
      .then(setFarmHistory)
      .catch(console.error);
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

  const miners = minerData.map((d) => d.info);
  const onlineMiners = minerData.filter((d) => d.info.online);
  const totalRtHashrate = miners.reduce((s, m) => s + m.rtHashrate, 0);
  const onlineCount = miners.filter((m) => m.online).length;
  const unit = miners.find((m) => m.online)?.hashrateUnit ?? "G";

  // Mobile miner stats
  const asicCount = miners.length;
  const mobileCount = mobileMiners.length;
  const totalCount = asicCount + mobileCount;
  const onlineAsicCount = onlineCount;
  const onlineMobileCount = mobileMiners.filter((m) => m.isOnline).length;
  const totalOnline = onlineAsicCount + onlineMobileCount;

  const asicHashrateGhs = totalRtHashrate;
  const mobileHashrateHs = mobileMiners
    .filter((m) => m.isOnline)
    .reduce((s, m) => s + m.hashrateHs, 0);
  const mobileHashrateGhs = mobileHashrateHs / 1e9;
  const totalHashrateGhs = asicHashrateGhs + mobileHashrateGhs;
  const totalFarmWattage = useMemo(() => {
    return onlineMiners.reduce((sum, { saved }) => sum + (saved?.wattage ?? minerWattage), 0);
  }, [onlineMiners, minerWattage]);

  const coinGroups = useMemo<CoinGroup[]>(() => {
    // Track ASIC miners per coin
    const asicByCoin = new Map<string, MinerWithSaved[]>();
    for (const saved of savedMiners) {
      const live = minerData.find((d) => d.info.ip === saved.ip);
      const activePoolAddr = live?.info.pools.find((p) => p.connect || p.state === 1)?.addr;
      const coinId = getMinerCoinId(activePoolAddr, poolProfiles, saved.coin_id);
      if (!asicByCoin.has(coinId)) asicByCoin.set(coinId, []);
      asicByCoin.get(coinId)!.push(
        live ?? {
          info: {
            ip: saved.ip,
            hostname: saved.label,
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
          saved,
        }
      );
    }

    // Track mobile miners per coin
    const mobileByCoin = new Map<string, MobileMiner[]>();
    for (const m of mobileMiners) {
      const coinId = coinIdFromTicker(m.coin);
      if (!mobileByCoin.has(coinId)) mobileByCoin.set(coinId, []);
      mobileByCoin.get(coinId)!.push(m);
    }

    // Merge all coin IDs from both ASIC and mobile
    const allCoinIds = new Set([...asicByCoin.keys(), ...mobileByCoin.keys()]);

    return Array.from(allCoinIds).map((coinId) => {
      const coin = coins.find((c) => c.id === coinId);
      const asicGroup = asicByCoin.get(coinId) ?? [];
      const mobileGroup = mobileByCoin.get(coinId) ?? [];

      const asicOnline = asicGroup.filter((g) => g.info.online);
      const mobileOnline = mobileGroup.filter((m) => m.isOnline);

      // ASIC hashrate is in the miner's native unit (typically GH/s)
      const asicHashrate = asicGroup.reduce((s, g) => s + g.info.rtHashrate, 0);
      const hashrateUnit = asicOnline[0]?.info.hashrateUnit ?? "G";

      // Mobile hashrate is raw H/s — convert to the ASIC unit for display
      const mobileHashrateHs = mobileGroup.filter((m) => m.isOnline).reduce((s, m) => s + m.hashrateHs, 0);
      const unitMultiplier: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 };
      const mobileInUnit = mobileHashrateHs / (unitMultiplier[hashrateUnit] ?? 1e9);

      const totalHashrate = asicHashrate + mobileInUnit;

      return {
        coinId,
        coin,
        count: asicGroup.length + mobileGroup.length,
        onlineCount: asicOnline.length + mobileOnline.length,
        offlineCount: (asicGroup.length - asicOnline.length) + (mobileGroup.length - mobileOnline.length),
        totalHashrate,
        hashrateUnit,
        asicCount: asicGroup.length,
        mobileCount: mobileGroup.length,
      };
    });
  }, [savedMiners, minerData, coins, poolProfiles, mobileMiners]);

  useEffect(() => {
    setCoinEarnings({});
  }, [currency]);

  useEffect(() => {
    fetchCoinEarnings(coinGroups, minerData);
  }, [totalRtHashrate, coinGroups, minerData, fetchCoinEarnings]);

  function handleCoinViewChange(mode: CoinViewMode) {
    setCoinViewMode(mode);
    localStorage.setItem("dashboard-coin-view", mode);
  }

  const farmTotals = useMemo(() => {
    const dailyGross = Object.values(coinEarnings).reduce((s, e) => s + e.dailyFiat, 0);
    const dailyPowerKwh = totalFarmWattage / 1000 * 24;
    const dailyPowerCost = dailyPowerKwh * electricityCostPerKwh;
    const dailyNet = dailyGross - dailyPowerCost;

    // Scale by the chosen time window. profitRange is in hours (1, 6, 24, 168, 720).
    const windowScale = profitRange / 24;

    return {
      // Daily/monthly (unchanged — used elsewhere if needed)
      dailyGross,
      monthlyGross: dailyGross * 30,
      dailyPowerCost,
      monthlyPowerCost: dailyPowerCost * 30,
      dailyNet,
      monthlyNet: dailyNet * 30,
      dailyPowerKwh,

      // Windowed (NEW — for the selected profitRange)
      windowGross: dailyGross * windowScale,
      windowPowerCost: dailyPowerCost * windowScale,
      windowNet: dailyNet * windowScale,
      windowPowerKwh: dailyPowerKwh * windowScale,
    };
  }, [coinEarnings, totalFarmWattage, electricityCostPerKwh, profitRange]);

  const profitRangeLabel = (r: ProfitRange) => {
    if (r === 168) return "7d";
    if (r === 720) return "30d";
    return `${r}h`;
  };

  const profitRangeUnitLabel = (r: ProfitRange) => {
    if (r === 1) return `${currencyCode}/hour`;
    if (r === 6) return `${currencyCode}/6h`;
    if (r === 24) return `${currencyCode}/day`;
    if (r === 168) return `${currencyCode}/week`;
    if (r === 720) return `${currencyCode}/month`;
    return currencyCode;
  };

  const hasEarnings = Object.keys(coinEarnings).length > 0;

  async function handleExportProfitability() {
    try {
      const filePath = await save({ filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (filePath) {
        const csv = await invoke<string>("export_profitability_csv", { currency });
        await writeTextFile(filePath, csv);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-slate-400 mt-1">Farm overview at a glance</p>
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

      {!initialLoaded ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <svg className="w-8 h-8 mx-auto mb-3 text-slate-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-slate-500">Loading miners...</p>
          </div>
        </div>
      ) : totalCount === 0 && mobileCount === 0 ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="bg-dark-800 rounded-2xl border border-slate-700/50 p-10 max-w-lg text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-primary-500/10 border border-primary-500/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Welcome to PoPManager</h3>
            <p className="text-sm text-slate-400 mb-8 leading-relaxed">
              Get started by adding your first miner. PoPManager supports Iceriver, Whatsminer, and Antminer ASICs via automatic network discovery, plus mobile miners running the PoPMobile Android app.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate("/miners")}
                className="px-5 py-3 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors flex flex-col items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                </svg>
                Add ASIC Miner
              </button>
              <button
                onClick={() => navigate("/mobile-miners")}
                className="px-5 py-3 bg-dark-900 hover:bg-dark-700 border border-slate-700 text-white text-sm font-medium rounded-lg transition-colors flex flex-col items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Add Mobile Miner
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-6">
              New to PoPManager? See the <button onClick={() => navigate("/settings")} className="text-primary-400 hover:text-primary-300 underline">Settings → About</button> panel for the GitHub link and documentation.
            </p>
          </div>
        </div>
      ) : (
        <>
      {/* Summary stats — Miners breakdown */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Total Miners"
          value={totalCount}
          subline={`${totalOnline} online`}
        />
        <StatCard
          label="ASIC Miners"
          value={asicCount}
          subline={`${onlineAsicCount} online`}
        />
        <StatCard
          label="Mobile Miners"
          value={mobileCount}
          subline={`${onlineMobileCount} online`}
        />
      </div>

      {/* Hashrate breakdown + uptime */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Hashrate"
          value={totalHashrateGhs.toFixed(1)}
          unit={`${unit}H/s`}
        />
        <StatCard
          label="ASIC Hashrate"
          value={asicHashrateGhs.toFixed(1)}
          unit={`${unit}H/s`}
        />
        <StatCard
          label="Mobile Hashrate"
          value={formatMobileHashrate(mobileHashrateHs)}
        />
        <StatCard
          label="Fleet Uptime (24h)"
          value={fleetUptime !== null ? fleetUptime.toFixed(1) : "--"}
          unit={fleetUptime !== null ? "%" : ""}
        />
      </div>

      {fleetUptime !== null && (
        <p className="text-xs italic text-slate-500 -mt-4 mb-2">
          Uptime tracked while PoPManager is running
        </p>
      )}

      {/* Profitability summary */}
      <div className="mb-6 bg-dark-800 rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Farm Profitability
            </h3>
            <span className="text-xs italic text-slate-500">Estimated</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportProfitability}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-900 border border-slate-700/50 hover:border-primary-500/50 text-slate-300 text-xs font-medium rounded-lg transition-colors"
            >
              Export CSV
            </button>
          <div className="flex items-center gap-1">
            {([1, 6, 24, 168, 720] as ProfitRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setProfitRange(r)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  profitRange === r
                    ? "bg-primary-600 text-white"
                    : "text-slate-400 hover:text-white bg-dark-900"
                }`}
              >
                {profitRangeLabel(r)}
              </button>
            ))}
          </div>
          </div>
        </div>
        {hasEarnings ? (
          <div className="grid grid-cols-3 gap-4">
            {/* Gross Earnings */}
            <div className="bg-dark-900 rounded-lg p-4">
              <p className="text-xs text-slate-400 mb-1">Gross Earnings</p>
              <p className="text-2xl font-bold text-emerald-400">
                {farmTotals.windowGross.toFixed(2)}
                <span className="text-sm text-slate-400 ml-1">{profitRangeUnitLabel(profitRange)}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Daily rate: {farmTotals.dailyGross.toFixed(2)} {currencyCode}
              </p>
            </div>
            {/* Power Cost */}
            <div className="bg-dark-900 rounded-lg p-4">
              <p className="text-xs text-slate-400 mb-1">Power Cost</p>
              <p className="text-2xl font-bold text-amber-400">
                {farmTotals.windowPowerCost.toFixed(2)}
                <span className="text-sm text-slate-400 ml-1">{profitRangeUnitLabel(profitRange)}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Daily rate: {farmTotals.dailyPowerCost.toFixed(2)} {currencyCode}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">{farmTotals.dailyPowerKwh.toFixed(1)} kWh/day</p>
            </div>
            {/* Net Profit */}
            <div className="bg-dark-900 rounded-lg p-4">
              <p className="text-xs text-slate-400 mb-1">Net Profit</p>
              <p className={`text-2xl font-bold ${farmTotals.windowNet >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {farmTotals.windowNet.toFixed(2)}
                <span className="text-sm text-slate-400 ml-1">{profitRangeUnitLabel(profitRange)}</span>
              </p>
              <p className={`text-xs mt-1 ${farmTotals.dailyNet >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                Daily rate: {farmTotals.dailyNet.toFixed(2)} {currencyCode}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {totalRtHashrate > 0 ? "Fetching profitability data..." : "No miners online"}
          </p>
        )}
      </div>

      {/* Farm Hashrate Chart */}
      {farmHistory.length > 1 && (() => {
        const cutoffSecs = Math.floor(Date.now() / 1000) - chartRange * 3600;
        const filtered = farmHistory.filter((s) => s.timestamp > cutoffSecs);
        const chartData = filtered.map((s) => ({
          time: new Date(s.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          hashrate: parseFloat(s.totalHashrate.toFixed(2)),
        }));
        return (
          <div className="mb-6 bg-dark-800 rounded-xl border border-slate-700/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Total Farm Hashrate
              </h3>
              <div className="flex items-center gap-1">
                {([1, 6, 24, 168, 720] as ChartRange[]).map((h) => (
                  <button
                    key={h}
                    onClick={() => setChartRange(h)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      chartRange === h
                        ? "bg-primary-600 text-white"
                        : "text-slate-400 hover:text-white bg-dark-900"
                    }`}
                  >
                    {h === 168 ? "7d" : h === 720 ? "30d" : `${h}h`}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="hashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  domain={["auto", "auto"]}
                  width={45}
                  tickFormatter={(v: number) => `${v}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148,163,184,0.15)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(v: number) => [`${v} GH/s`, "Hashrate"]}
                />
                <Area
                  type="monotone"
                  dataKey="hashrate"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#hashGrad)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* Mining by Coin section */}
      {savedMiners.length === 0 ? (
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
          <p className="text-sm mt-1">Go to ASIC Miners → Add Device</p>
        </div>
      ) : (
        <>
          {/* Section header + view toggle */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Mining by Coin
            </h3>
            <div className="flex items-center bg-dark-800 border border-slate-700/50 rounded-lg p-0.5">
              <button
                onClick={() => handleCoinViewChange("card")}
                title="Card view"
                className={`p-2 rounded-md transition-colors ${
                  coinViewMode === "card"
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
                onClick={() => handleCoinViewChange("list")}
                title="List view"
                className={`p-2 rounded-md transition-colors ${
                  coinViewMode === "list"
                    ? "bg-primary-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Card view */}
          {coinViewMode === "card" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {coinGroups.map(
                ({ coinId, coin, count, offlineCount, totalHashrate, hashrateUnit, asicCount, mobileCount }) => {
                  const color = coin?.color ?? "#6366f1";
                  const displayName = coin ? `${coin.name} (${coin.ticker})` : coinId;
                  const earnings = coinEarnings[coinId];
                  const ticker = coin?.ticker ?? coinId.toUpperCase();
                  const coinDecimals = ticker === "BTC" ? 6 : 2;
                  return (
                    <div
                      key={coinId}
                      onClick={() => navigate(`/miners?coin=${encodeURIComponent(coinId)}`)}
                      className="bg-dark-800 rounded-xl border border-slate-700/50 p-5 cursor-pointer hover:border-primary-500/50 transition-all"
                      style={{ borderLeftWidth: 3, borderLeftColor: color }}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h4 className="font-semibold text-white flex items-center gap-1.5">
                            {getCoinIcon(coinId) && (
                              <img src={getCoinIcon(coinId)!} alt={ticker} className="w-5 h-5 rounded-full flex-shrink-0" />
                            )}
                            {displayName}
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {count} miner{count !== 1 ? "s" : ""}
                            {asicCount > 0 && mobileCount > 0 && (
                              <span className="text-slate-500"> ({asicCount} ASIC, {mobileCount} mobile)</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `${color}20`, color }}
                          >
                            {ticker}
                          </span>
                          {earnings && (
                            <p className="text-xs text-slate-500 mt-1">
                              {earnings.coinPrice.toFixed(4)} {currencyCode}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Total Miners</p>
                          <p className="text-xl font-bold text-white">{count}</p>
                        </div>
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">ASIC</p>
                          <p className="text-xl font-bold text-white">{asicCount}</p>
                        </div>
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Mobile</p>
                          <p className="text-xl font-bold text-white">{mobileCount}</p>
                        </div>
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Offline</p>
                          <p className={`text-xl font-bold ${offlineCount > 0 ? "text-red-400" : "text-slate-500"}`}>
                            {offlineCount}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-3 mt-3">
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Hashrate</p>
                          <p className="text-xl font-bold text-white">{totalHashrate.toFixed(1)}</p>
                          <p className="text-xs text-slate-500">{hashrateUnit}H/s</p>
                        </div>
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Price</p>
                          <p className="text-xl font-bold text-white">{earnings ? earnings.coinPrice.toFixed(4) : "--"}</p>
                          <p className="text-xs text-slate-500">{currencyCode}</p>
                        </div>
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Daily</p>
                          <p className="text-lg font-bold text-emerald-400">
                            {earnings ? `${earnings.dailyCoins.toFixed(coinDecimals)} ${ticker}` : "--"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {earnings ? `${earnings.dailyFiat.toFixed(2)} ${currencyCode}` : ""}
                          </p>
                        </div>
                        <div className="bg-dark-900 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">Monthly</p>
                          <p className="text-lg font-bold text-emerald-400">
                            {earnings ? `${earnings.monthlyCoins.toFixed(coinDecimals)} ${ticker}` : "--"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {earnings ? `${earnings.monthlyFiat.toFixed(2)} ${currencyCode}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            /* List view */
            <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700/50">
                  <tr className="text-slate-400">
                    <th className="text-left px-5 py-3">Coin</th>
                    <th className="text-right px-5 py-3">Price</th>
                    <th className="text-right px-5 py-3">Miners</th>
                    <th className="text-right px-5 py-3">Online</th>
                    <th className="text-right px-5 py-3">Offline</th>
                    <th className="text-right px-5 py-3">Hashrate</th>
                    <th className="text-right px-5 py-3">Daily</th>
                    <th className="text-right px-5 py-3">Monthly</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {coinGroups.map(
                    ({
                      coinId,
                      coin,
                      count,
                      onlineCount,
                      offlineCount,
                      totalHashrate,
                      hashrateUnit,
                    }) => {
                      const color = coin?.color ?? "#6366f1";
                      const displayName = coin ? `${coin.name} (${coin.ticker})` : coinId;
                      const earnings = coinEarnings[coinId];
                      const ticker = coin?.ticker ?? coinId.toUpperCase();
                      const coinDecimals = ticker === "BTC" ? 6 : 2;
                      return (
                        <tr
                          key={coinId}
                          onClick={() => navigate(`/miners?coin=${encodeURIComponent(coinId)}`)}
                          className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              {getCoinIcon(coinId) ? (
                                <img src={getCoinIcon(coinId)!} alt={ticker} className="w-4 h-4 rounded-full flex-shrink-0" />
                              ) : (
                                <span
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                              )}
                              <span className="text-white font-medium">{displayName}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-slate-400 text-xs">
                            {earnings ? `${earnings.coinPrice.toFixed(4)} ${currencyCode}` : "—"}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-300">{count}</td>
                          <td className="px-5 py-3 text-right text-emerald-400">{onlineCount}</td>
                          <td className="px-5 py-3 text-right">
                            <span className={offlineCount > 0 ? "text-red-400" : "text-slate-500"}>
                              {offlineCount}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right text-white">
                            {totalHashrate.toFixed(1)}{" "}
                            <span className="text-xs text-slate-500">{hashrateUnit}H/s</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {earnings ? (
                              <div>
                                <p className="text-sm font-semibold text-emerald-400">
                                  {earnings.dailyCoins.toFixed(coinDecimals)} {ticker}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {earnings.dailyFiat.toFixed(2)} {currencyCode}
                                </p>
                              </div>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {earnings ? (
                              <div>
                                <p className="text-sm font-semibold text-emerald-400">
                                  {earnings.monthlyCoins.toFixed(coinDecimals)} {ticker}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {earnings.monthlyFiat.toFixed(2)} {currencyCode}
                                </p>
                              </div>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}
