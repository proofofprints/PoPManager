import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AlertEvent } from "../types/alerts";

interface AlertContextValue {
  unacknowledgedCount: number;
  refreshHistory: () => Promise<void>;
}

const AlertContext = createContext<AlertContextValue>({
  unacknowledgedCount: 0,
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

  useEffect(() => {
    refreshHistory();

    // The background poller now evaluates alerts and emits "alerts-updated"
    // whenever new events are appended to the history. Listen so the badge
    // count stays current without polling.
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen("alerts-updated", () => {
      refreshHistory();
    }).then((h) => {
      if (cancelled) h();
      else unlisten = h;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [refreshHistory]);

  return (
    <AlertContext.Provider value={{ unacknowledgedCount, refreshHistory }}>
      {children}
    </AlertContext.Provider>
  );
}

export function useAlerts() {
  return useContext(AlertContext);
}
