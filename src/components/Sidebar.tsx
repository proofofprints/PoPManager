import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import popIcon from "../assets/icon.png";
import { useAlerts } from "../context/AlertContext";

export default function Sidebar() {
  const { unacknowledgedCount } = useAlerts();
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <aside className="w-64 bg-dark-900 border-r border-slate-700/50 flex flex-col">
      <div className="p-6 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <img src={popIcon} alt="PoPManager" className="w-8 h-8" />
          <h1 className="text-xl font-bold text-white">PoPManager</h1>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
          </svg>
          Dashboard
        </NavLink>

        <NavLink
          to="/miners"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}>
            <rect x="2" y="5" width="20" height="14" rx="1.5" />
            <line x1="5" y1="9"  x2="19" y2="9"  />
            <line x1="5" y1="12" x2="19" y2="12" />
            <line x1="5" y1="15" x2="19" y2="15" />
            <circle cx="18" cy="8"  r="0.75" fill="currentColor" stroke="none" />
            <circle cx="18" cy="11" r="0.75" fill="currentColor" stroke="none" />
          </svg>
          ASIC Miners
        </NavLink>

        <NavLink
          to="/mobile-miners"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}>
            <rect x="6" y="2" width="12" height="20" rx="2" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          Mobile Miners
        </NavLink>

        <NavLink
          to="/pools"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}>
            <ellipse cx="12" cy="7" rx="9" ry="3" />
            <path d="M3 7v5c0 1.657 4.03 3 9 3s9-1.343 9-3V7" />
            <path d="M3 12v5c0 1.657 4.03 3 9 3s9-1.343 9-3v-5" />
          </svg>
          Pools
        </NavLink>

        <NavLink
          to="/alerts"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          <span className="flex-1">Alerts</span>
          {unacknowledgedCount > 0 && (
            <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold bg-red-500 text-white leading-none">
              {unacknowledgedCount > 99 ? "99+" : unacknowledgedCount}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </NavLink>
      </nav>
      <div className="p-4 border-t border-slate-700/50">
        <p className="text-xs text-slate-500">Version v{version}</p>
      </div>
    </aside>
  );
}
