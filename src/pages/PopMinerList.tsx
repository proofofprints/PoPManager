import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import type { PopMinerDevice } from "../types/miner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHashrate(hs: number): string {
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`;
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(2)} KH/s`;
  return `${hs.toFixed(0)} H/s`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function PopMinerCard({
  device,
  onClick,
}: {
  device: PopMinerDevice;
  onClick: () => void;
}) {
  const statusColor = !device.online
    ? "bg-slate-500"
    : device.mining
    ? "bg-emerald-500"
    : "bg-amber-500";

  const statusText = !device.online
    ? "offline"
    : device.mining
    ? "mining"
    : "idle";

  return (
    <div
      className="bg-dark-800 rounded-xl border border-slate-700/50 p-5 cursor-pointer hover:border-primary-500/50 hover:bg-dark-800/80 transition-all"
      onClick={onClick}
    >
      {/* Header: name + status */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white flex items-center gap-2">
            {/* Microchip icon */}
            <svg
              className="w-4 h-4 text-cyan-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
              <line x1="9" y1="2" x2="9" y2="6" />
              <line x1="15" y1="2" x2="15" y2="6" />
              <line x1="9" y1="18" x2="9" y2="22" />
              <line x1="15" y1="18" x2="15" y2="22" />
              <line x1="2" y1="9" x2="6" y2="9" />
              <line x1="2" y1="15" x2="6" y2="15" />
              <line x1="18" y1="9" x2="22" y2="9" />
              <line x1="18" y1="15" x2="22" y2="15" />
            </svg>
            {device.name || device.hostname}
          </h3>
          <p className="text-sm text-slate-400">
            {device.hostname}.local &middot; {device.ip}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            FW v{device.fw} &middot; {device.model}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${statusColor}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          {statusText}
        </span>
      </div>

      {/* Stats grid */}
      {device.online ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-dark-900 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Hashrate</p>
              <p className="text-sm font-bold text-white">
                {formatHashrate(device.hashrate)}
              </p>
            </div>
            <div className="bg-dark-900 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Shares</p>
              <p className="text-sm font-bold text-white">
                {device.accepted}/{device.submitted}
                {device.rejected > 0 && (
                  <span className="text-red-400 text-xs ml-1">
                    ({device.rejected}r)
                  </span>
                )}
              </p>
            </div>
            <div className="bg-dark-900 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Uptime</p>
              <p className="text-sm font-bold text-white">
                {formatUptime(device.uptimeS)}
              </p>
            </div>
          </div>
          {device.pool && (
            <div className="bg-dark-900 rounded-lg px-3 py-2 mb-3">
              <p className="text-xs text-slate-400">Pool</p>
              <p className="text-xs text-slate-300 font-mono truncate">
                {device.pool}
              </p>
              <p className="text-xs text-slate-500">
                Diff:{" "}
                {device.difficulty < 0.01
                  ? device.difficulty.toPrecision(4)
                  : device.difficulty.toFixed(4)}
                {device.blocks > 0 && (
                  <span className="text-amber-400 ml-2">
                    {device.blocks} block{device.blocks !== 1 ? "s" : ""}
                  </span>
                )}
              </p>
            </div>
          )}
          {/* Health dots */}
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  device.poolConnected ? "bg-emerald-400" : "bg-red-500"
                }`}
              />
              <span
                className={
                  device.poolConnected ? "text-slate-400" : "text-red-400"
                }
              >
                Pool
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  device.authorized ? "bg-emerald-400" : "bg-red-500"
                }`}
              />
              <span
                className={
                  device.authorized ? "text-slate-400" : "text-red-400"
                }
              >
                Auth
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  device.mining ? "bg-emerald-400" : "bg-amber-500"
                }`}
              />
              <span
                className={
                  device.mining ? "text-slate-400" : "text-amber-400"
                }
              >
                {device.mining ? "Mining" : "Idle"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-4 text-slate-500 text-sm">
          Device offline — last seen at {device.ip}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PopMinerList() {
  const [devices, setDevices] = useState<Map<string, PopMinerDevice>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<PopMinerDevice[]>("get_popminer_devices");
      const map = new Map<string, PopMinerDevice>();
      for (const d of list) map.set(d.mac, d);
      setDevices(map);
    } catch (err) {
      console.error("Failed to load PoPMiner devices:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const unlisteners: (() => void)[] = [];

    listen<PopMinerDevice>("popminer-device-discovered", (event) => {
      setDevices((prev) =>
        new Map(prev).set(event.payload.mac, event.payload)
      );
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<PopMinerDevice>("popminer-device-stats", (event) => {
      setDevices((prev) => {
        const next = new Map(prev);
        const existing = next.get(event.payload.mac);
        if (existing) {
          next.set(event.payload.mac, { ...existing, ...event.payload });
        } else {
          next.set(event.payload.mac, event.payload);
        }
        return next;
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<{ mac: string }>("popminer-device-lost", (event) => {
      setDevices((prev) => {
        const next = new Map(prev);
        next.delete(event.payload.mac);
        return next;
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [refresh]);

  const deviceList = Array.from(devices.values());

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">PoPMiner Devices</h2>
          <p className="text-sm text-slate-400 mt-1">
            Auto-discovered PoPMiner devices on your local network via mDNS.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {deviceList.length > 0 && (
            <p className="text-xs text-slate-500">
              {deviceList.filter((d) => d.online).length}/{deviceList.length}{" "}
              online
            </p>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-slate-700/50 hover:border-primary-500/50 text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
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
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-500 text-sm">
          Loading...
        </div>
      ) : deviceList.length === 0 ? (
        <div className="text-center py-20">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.25}
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
            <line x1="9" y1="2" x2="9" y2="6" />
            <line x1="15" y1="2" x2="15" y2="6" />
            <line x1="9" y1="18" x2="9" y2="22" />
            <line x1="15" y1="18" x2="15" y2="22" />
            <line x1="2" y1="9" x2="6" y2="9" />
            <line x1="2" y1="15" x2="6" y2="15" />
            <line x1="18" y1="9" x2="22" y2="9" />
            <line x1="18" y1="15" x2="22" y2="15" />
          </svg>
          <p className="text-lg font-medium text-slate-300">
            No PoPMiner devices found
          </p>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            PoPMiner devices are discovered automatically via mDNS. Make sure
            your PoPMiner Nano (or other PoPMiner device) is powered on and
            connected to the same network as this computer.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {deviceList.map((d) => (
            <PopMinerCard
              key={d.mac}
              device={d}
              onClick={() => openUrl(`http://${d.ip}/`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
