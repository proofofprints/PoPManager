import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AlertEvent, MinerSnapshot, MobileMinerSnapshot } from "../types/alerts";
import { info, warn } from "../utils/logger";

interface AlertContextValue {
  unacknowledgedCount: number;
  checkAlerts: (snapshots: MinerSnapshot[]) => Promise<void>;
  checkMobileAlerts: (snapshots: MobileMinerSnapshot[]) => Promise<void>;
  refreshHistory: () => Promise<void>;
}

const AlertContext = createContext<AlertContextValue>({
  unacknowledgedCount: 0,
  checkAlerts: async () => {},
  checkMobileAlerts: async () => {},
  refreshHistory: async () => {},
});

export function AlertProvider({ children }: { children: ReactNode }) {
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);

  const refreshHistory = useCallback(async () => {
    try {
      const events = await invoke<AlertEvent[]>("get_alert_history");
      setUnacknowledgedCount(events.filter((e) => !e.acknowledged).length);
    } catch (err) {
      console.error("Failed to refresh alert history:", err);
    }
  }, []);

  const checkAlerts = useCallback(
    async (snapshots: MinerSnapshot[]) => {
      if (snapshots.length === 0) return;
      try {
        const triggered = await invoke<AlertEvent[]>("check_alerts", {
          miners: snapshots,
        });
        if (triggered.length > 0) {
          info(`Alert check: ${triggered.length} alert(s) triggered`).catch(() => {});
        }

        for (const event of triggered) {
          if (event.notifyDesktop) {
            try {
              await invoke("send_desktop_notification", {
                title: `Alert: ${event.ruleName}`,
                body: `${event.minerLabel}: ${event.message}`,
              });
            } catch (err) {
              console.error("Desktop notification failed:", err);
            }
          }

          if (event.notifyEmail) {
            invoke("send_alert_email", {
              subject: `PoPManager Alert: ${event.ruleName}`,
              body: `Miner: ${event.minerLabel} (${event.minerIp})\n\n${event.message}\n\nTime: ${new Date(event.timestamp).toLocaleString()}`,
            }).catch((err) => console.error("Alert email failed:", err));
          }
        }

        if (triggered.length > 0) {
          await refreshHistory();
        }
      } catch (err) {
        warn(`Alert check failed: ${err}`).catch(() => {});
        console.error("Failed to check alerts:", err);
      }
    },
    [refreshHistory]
  );

  const checkMobileAlerts = useCallback(
    async (snapshots: MobileMinerSnapshot[]) => {
      if (snapshots.length === 0) return;
      try {
        const triggered = await invoke<AlertEvent[]>("check_mobile_alerts", {
          miners: snapshots,
        });
        if (triggered.length > 0) {
          info(`Mobile alert check: ${triggered.length} alert(s) triggered`).catch(() => {});
        }

        for (const event of triggered) {
          if (event.notifyDesktop) {
            try {
              await invoke("send_desktop_notification", {
                title: `Alert: ${event.ruleName}`,
                body: `${event.minerLabel}: ${event.message}`,
              });
            } catch (err) {
              console.error("Desktop notification failed:", err);
            }
          }

          if (event.notifyEmail) {
            invoke("send_alert_email", {
              subject: `PoPManager Alert: ${event.ruleName}`,
              body: `Mobile Miner: ${event.minerLabel} (${event.minerIp})\n\n${event.message}\n\nTime: ${new Date(event.timestamp).toLocaleString()}`,
            }).catch((err) => console.error("Alert email failed:", err));
          }
        }

        if (triggered.length > 0) {
          await refreshHistory();
        }
      } catch (err) {
        warn(`Mobile alert check failed: ${err}`).catch(() => {});
        console.error("Failed to check mobile alerts:", err);
      }
    },
    [refreshHistory]
  );

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  return (
    <AlertContext.Provider
      value={{ unacknowledgedCount, checkAlerts, checkMobileAlerts, refreshHistory }}
    >
      {children}
    </AlertContext.Provider>
  );
}

export function useAlerts() {
  return useContext(AlertContext);
}
