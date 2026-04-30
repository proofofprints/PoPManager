export type MinerStatus = "online" | "offline" | "warning" | "unknown";

export interface UptimeStats {
  total_polls: number;
  online_polls: number;
  uptime_percent: number;
  last_downtime: number | null;
  current_streak_minutes: number;
  is_online: boolean;
}

export interface CoinConfig {
  id: string;
  name: string;
  ticker: string;
  algorithm: string;
  coingeckoId: string;
  color: string;
  networkHashrateUrl: string;
  networkHashrateUnit: string;
  blockRewardUrl: string;
  blockRewardDivisor: number;
  blockTimeSeconds: number;
  defaultHashrateUnit: string;
}

export interface PoolInfo {
  no: number;
  addr: string;
  user: string;
  pass: string;
  connect: boolean;
  diff: string;
  accepted: number;
  rejected: number;
  state: number; // 1 = active
}

export interface BoardInfo {
  no: number;
  chipNum: number;
  freq: number;
  rtPow: string;
  rtPowValue: number;
  inTmp: number;
  outTmp: number;
  state: boolean;
}

export interface HashrateHistory {
  board: string;
  values: number[];
  labels: string[];
}

export interface HealthState {
  power: boolean;
  network: boolean;
  fan: boolean;
  temp: boolean;
}

export interface MinerInfo {
  ip: string;
  hostname: string;
  mac: string;
  model: string;
  status: MinerStatus;
  firmware: string;
  software: string;
  online: boolean;
  rtHashrate: number;
  avgHashrate: number;
  hashrateUnit: string;
  runtime: string;
  runtimeSecs: number;
  fans: number[];
  boards: BoardInfo[];
  pools: PoolInfo[];
  hashrateHistory: HashrateHistory[];
  health: HealthState;
  lastSeen: string;
  defaultWattage: number;
  manufacturer?: string;
  hwErrors?: number;
}

export interface ScanResult {
  found: MinerInfo[];
  scannedRange: string;
  duration: number;
}

export interface PoolSlot {
  no: number;
  addr: string;
  user: string;
  pass: string;
}

export interface SavedMiner {
  ip: string;
  label: string;
  added_at: string;
  coin_id: string;
  wattage?: number;
  manufacturer?: string;
}

export interface EarningsEstimate {
  dailyKas: number;
  weeklyKas: number;
  monthlyKas: number;
  dailyUsd: number;
  weeklyUsd: number;
  monthlyUsd: number;
  kasPrice: number;
}

export interface NetworkStats {
  networkHashrate: number;
  blockReward: number;
}

export interface CoinNetworkStats {
  networkHashrateThs: number;
  blockReward: number;
  blockTimeSeconds: number;
}

export interface CoinEarnings {
  dailyCoins: number;
  monthlyCoins: number;
  dailyFiat: number;
  monthlyFiat: number;
  coinPrice: number;
}

export interface PoolProfile {
  id: string;
  name: string;
  pool1addr: string;
  pool1miner: string;
  pool1pwd: string;
  pool2addr: string;
  pool2miner: string;
  pool2pwd: string;
  pool3addr: string;
  pool3miner: string;
  pool3pwd: string;
  fee_percent?: number;
  coin_id?: string;
}

/** Payload for set_miner_pools — matches Iceriver machineconfig POST field names. */
export interface PoolConfigPayload {
  pool1address: string;
  pool1miner: string;
  pool1pwd: string;
  pool2address: string;
  pool2miner: string;
  pool2pwd: string;
  pool3address: string;
  pool3miner: string;
  pool3pwd: string;
}

export interface AppPreferences {
  currency: string;
  poolFeePercent: number;
  electricityCostPerKwh: number;
  minerWattage: number;
  logLevel?: string;
  minimizeToTray?: boolean;
}

export interface MobileMiner {
  deviceId: string;
  apiKey: string;
  name: string;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  coin: string;
  manufacturer: string;
  model: string;
  pool: string;
  worker: string;
  hashrateHs: number;
  acceptedShares: number;
  rejectedShares: number;
  difficulty: number;
  runtimeSeconds: number;
  cpuTemp: number;
  throttleState: string;
  batteryLevel: number;
  batteryCharging: boolean;
  threads: number;
  status: string;
  errorMessage: string | null;
  lastReportTimestamp: number;
  registeredAt: number;
  isOnline: boolean;
}

export interface MobileServerConfig {
  enabled: boolean;
  port: number;
  requireApiKey: boolean;
  reportIntervalSeconds: number;
}

export interface MobileCommand {
  id: string;
  deviceId: string;
  type: string; // "set_config" | "set_threads" | "start" | "stop" | "restart"
  params: Record<string, any> | null;
  createdAt: number;
  status: string; // "pending" | "applied" | "failed"
  ackedAt: number | null;
  error: string | null;
}

export interface CoinSnapshot {
  hashrate: number;
  minerCount: number;
  dailyEarningsCoins: number;
  dailyEarningsFiat: number;
}

export interface FarmSnapshot {
  timestamp: number;
  totalHashrate: number;
  onlineCount: number;
  totalMiners: number;
  coinData: Record<string, CoinSnapshot>;
}

export interface PopMinerDevice {
  mac: string;
  name: string;
  model: string;
  hostname: string;
  ip: string;
  fw: string;
  sdk: string;
  mining: boolean;
  poolConnected: boolean;
  authorized: boolean;
  hashrate: number;
  difficulty: number;
  submitted: number;
  accepted: number;
  rejected: number;
  blocks: number;
  jobs: number;
  totalHashes: number;
  pool: string;
  uptimeS: number;
  heap: number;
  online: boolean;
  consecutiveFailures: number;
}

/** Convert a saved PoolProfile to the API payload format. */
export function profileToPayload(p: PoolProfile): PoolConfigPayload {
  return {
    pool1address: p.pool1addr,
    pool1miner: p.pool1miner,
    pool1pwd: p.pool1pwd,
    pool2address: p.pool2addr,
    pool2miner: p.pool2miner,
    pool2pwd: p.pool2pwd,
    pool3address: p.pool3addr,
    pool3miner: p.pool3miner,
    pool3pwd: p.pool3pwd,
  };
}
