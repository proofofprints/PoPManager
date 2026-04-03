export type MinerStatus = "online" | "offline" | "warning" | "unknown";

export interface PoolInfo {
  url: string;
  user: string;
  status: string;
}

export interface HashrateBoard {
  id: number;
  hashrate: number; // in GH/s
  temperature: number; // in Celsius
  fanSpeed: number; // RPM
}

export interface MinerInfo {
  ip: string;
  hostname: string;
  model: string;
  status: MinerStatus;
  totalHashrate: number; // in GH/s
  boards: HashrateBoard[];
  pools: PoolInfo[];
  uptime: number; // in seconds
  lastSeen: string; // ISO timestamp
}

export interface ScanResult {
  found: MinerInfo[];
  scannedRange: string;
  duration: number; // ms
}

export interface PoolConfig {
  url: string;
  user: string;
  password: string;
}
