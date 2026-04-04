export type MinerStatus = "online" | "offline" | "warning" | "unknown";

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
}
