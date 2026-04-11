export type RuleType =
  | "HashrateDrop"
  | "TempAbove"
  | "MinerOffline"
  | "NoShares"
  | "MobileBatteryLow"
  | "MobileCpuTempAbove"
  | "MobileThrottle"
  | "MobileOffline";

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  ruleType: RuleType;
  threshold: number;
  appliesTo: string[];
  notifyDesktop: boolean;
  notifyEmail: boolean;
  cooldownMinutes: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  minerIp: string;
  minerLabel: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  notifyDesktop: boolean;
  notifyEmail: boolean;
}

export interface SmtpConfig {
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  fromAddress: string;
  toAddresses: string[];
  useTls: boolean;
}

export interface MinerSnapshot {
  ip: string;
  label: string;
  online: boolean;
  rtHashrate: number;
  boards: { inTmp: number; outTmp: number }[];
  acceptedShares?: number;
}

export interface MobileMinerSnapshot {
  deviceId: string;
  name: string;
  isOnline: boolean;
  batteryLevel: number;
  batteryCharging: boolean;
  cpuTemp: number;
  throttleState: string;
}
