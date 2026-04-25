import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { appLogDir } from "@tauri-apps/api/path";
import type { SmtpConfig } from "../types/alerts";
import popLogo from "../assets/PopLogo.png";
import { useProfitability } from "../context/ProfitabilityContext";

const EMPTY_SMTP: SmtpConfig = {
  smtpHost: "",
  smtpPort: 587,
  username: "",
  password: "",
  fromAddress: "",
  toAddresses: [],
  useTls: true,
};

export default function Settings() {
  const { refreshPrefs, currency } = useProfitability();

  // Preferences state
  const [prefsCurrency, setPrefsCurrency] = useState("usd");
  const [prefsFee, setPrefsFee] = useState(1.0);
  const [prefsElectricityCost, setPrefsElectricityCost] = useState(0.10);
  const [prefsMinerWattage, setPrefsMinerWattage] = useState(100.0);
  const [prefsMinimizeToTray, setPrefsMinimizeToTray] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsSuccess, setPrefsSuccess] = useState<string | null>(null);

  // SMTP config state
  const [smtp, setSmtp] = useState<SmtpConfig>(EMPTY_SMTP);

  // Log level state
  const [logLevel, setLogLevel] = useState("info");
  const [logLevelSaving, setLogLevelSaving] = useState(false);
  const [logLevelMsg, setLogLevelMsg] = useState<string | null>(null);
  const [logExporting, setLogExporting] = useState(false);

  // Mobile miner server state
  const [mobileConfig, setMobileConfig] = useState<{ enabled: boolean; port: number; requireApiKey: boolean; reportIntervalSeconds: number }>({ enabled: true, port: 8787, requireApiKey: true, reportIntervalSeconds: 30 });
  const [mobileServerUrl, setMobileServerUrl] = useState<string>("");
  const [mobileSaving, setMobileSaving] = useState(false);
  const [mobileMsg, setMobileMsg] = useState<string | null>(null);
  const [mobileCopied, setMobileCopied] = useState(false);

  // Update state
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<{ version: string } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [smtpSuccess, setSmtpSuccess] = useState<string | null>(null);
  const [smtpLoaded, setSmtpLoaded] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  useEffect(() => {
    invoke<SmtpConfig | null>("get_smtp_config")
      .then((cfg) => {
        if (cfg) setSmtp(cfg);
        setSmtpLoaded(true);
      })
      .catch(() => setSmtpLoaded(true));

    invoke<{ currency: string; poolFeePercent: number; electricityCostPerKwh: number; minerWattage: number; logLevel?: string; minimizeToTray?: boolean }>("get_preferences")
      .then((p) => {
        setPrefsCurrency(p.currency);
        setPrefsFee(p.poolFeePercent);
        setPrefsElectricityCost(p.electricityCostPerKwh);
        setPrefsMinerWattage(p.minerWattage);
        if (p.logLevel) setLogLevel(p.logLevel);
        if (p.minimizeToTray !== undefined) setPrefsMinimizeToTray(p.minimizeToTray);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    invoke<{ enabled: boolean; port: number; requireApiKey: boolean; reportIntervalSeconds: number }>("get_mobile_server_config")
      .then(setMobileConfig)
      .catch(console.error);
    invoke<string>("get_mobile_server_url")
      .then(setMobileServerUrl)
      .catch(console.error);
  }, []);

  // ---- Mobile miner handlers ----
  async function handleSaveMobileConfig() {
    setMobileSaving(true);
    setMobileMsg(null);
    try {
      await invoke("save_mobile_server_config", { config: mobileConfig });
      const url = await invoke<string>("get_mobile_server_url");
      setMobileServerUrl(url);
      setMobileMsg("Configuration saved. Restart the app to apply port changes.");
    } catch (err) {
      setMobileMsg(`Error: ${err}`);
    } finally {
      setMobileSaving(false);
    }
  }

  // ---- Preferences handlers ----
  async function handleSavePrefs() {
    setPrefsSaving(true);
    setPrefsError(null);
    setPrefsSuccess(null);
    try {
      await invoke("save_preferences", { prefs: { currency: prefsCurrency, poolFeePercent: prefsFee, electricityCostPerKwh: prefsElectricityCost, minerWattage: prefsMinerWattage, logLevel, minimizeToTray: prefsMinimizeToTray } });
      setPrefsSuccess("Preferences saved.");
      refreshPrefs();
    } catch (err) {
      setPrefsError(String(err));
    } finally {
      setPrefsSaving(false);
    }
  }

  // ---- SMTP handlers ----
  async function handleSaveSmtp() {
    setSmtpSaving(true);
    setSmtpError(null);
    setSmtpSuccess(null);
    try {
      await invoke("save_smtp_config", { config: smtp });
      setSmtpSuccess("SMTP configuration saved.");
    } catch (err) {
      setSmtpError(String(err));
    } finally {
      setSmtpSaving(false);
    }
  }

  // ---- Export handlers ----
  async function handleExport(command: string, filename: string, extraArgs?: Record<string, unknown>) {
    try {
      const filePath = await save({ filters: [{ name: "CSV", extensions: ["csv"] }], defaultPath: filename });
      if (filePath) {
        const csv = await invoke<string>(command, extraArgs ?? {});
        await writeTextFile(filePath, csv);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  // ---- Update handlers ----
  async function handleCheckForUpdates() {
    setCheckingUpdate(true);
    setUpdateError(null);
    setUpdateSuccess(null);
    try {
      const update = await check();
      if (update) {
        setAvailableUpdate({ version: update.version });
      } else {
        setUpdateSuccess("You are on the latest version.");
      }
    } catch (err) {
      setUpdateError(String(err));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    if (!availableUpdate) return;
    setUpdateInstalling(true);
    setUpdateError(null);
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
      }
    } catch (err) {
      setUpdateError(String(err));
      setUpdateInstalling(false);
    }
  }

  async function handleTestEmail() {
    setTestingEmail(true);
    setSmtpError(null);
    setSmtpSuccess(null);
    try {
      await invoke("test_smtp_config");
      setSmtpSuccess("Test email sent successfully.");
    } catch (err) {
      setSmtpError(String(err));
    } finally {
      setTestingEmail(false);
    }
  }

  // ---- Log level handlers ----
  async function handleSetLogLevel(level: string) {
    setLogLevel(level);
    setLogLevelSaving(true);
    setLogLevelMsg(null);
    try {
      await invoke("set_log_level", { level });
      await invoke("save_preferences", { prefs: { currency: prefsCurrency, poolFeePercent: prefsFee, electricityCostPerKwh: prefsElectricityCost, minerWattage: prefsMinerWattage, logLevel: level, minimizeToTray: prefsMinimizeToTray } });
      setLogLevelMsg("Log level updated.");
    } catch (err) {
      setLogLevelMsg(`Error: ${err}`);
    } finally {
      setLogLevelSaving(false);
    }
  }

  async function handleOpenLogDir() {
    try {
      await invoke("open_log_directory");
    } catch (err) {
      console.error("Failed to open log directory:", err);
    }
  }

  async function handleExportLog() {
    setLogExporting(true);
    try {
      const dir = await appLogDir();
      const logPath = dir + "/popmanager.log";
      const content = await readTextFile(logPath);
      const filePath = await save({ filters: [{ name: "Log", extensions: ["log", "txt"] }], defaultPath: "popmanager.log" });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Log export failed:", err);
    } finally {
      setLogExporting(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <p className="text-slate-400 mt-1">Preferences, email, and application settings</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Preferences */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-white">Preferences</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Display currency and default pool fee for earnings calculations.
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Display Currency</label>
              <select
                value={prefsCurrency}
                onChange={(e) => setPrefsCurrency(e.target.value)}
                className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
              >
                {[
                  { code: "usd", name: "USD" },
                  { code: "cad", name: "CAD" },
                  { code: "eur", name: "EUR" },
                  { code: "gbp", name: "GBP" },
                  { code: "aud", name: "AUD" },
                  { code: "jpy", name: "JPY" },
                  { code: "chf", name: "CHF" },
                  { code: "cny", name: "CNY" },
                  { code: "krw", name: "KRW" },
                  { code: "brl", name: "BRL" },
                  { code: "inr", name: "INR" },
                  { code: "mxn", name: "MXN" },
                ].map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Default Pool Fee %</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={prefsFee}
                  onChange={(e) => setPrefsFee(parseFloat(e.target.value) || 0)}
                  className="w-28 bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Electricity Cost (per kWh)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  value={prefsElectricityCost}
                  onChange={(e) => setPrefsElectricityCost(parseFloat(e.target.value) || 0)}
                  className="w-28 bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                />
                <span className="text-sm text-slate-400">{prefsCurrency.toUpperCase()}/kWh</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Default Miner Wattage (W)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={prefsMinerWattage}
                  onChange={(e) => setPrefsMinerWattage(parseFloat(e.target.value) || 0)}
                  className="w-28 bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                />
                <span className="text-sm text-slate-400">W per miner</span>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={prefsMinimizeToTray}
                onChange={(e) => setPrefsMinimizeToTray(e.target.checked)}
                className="rounded border-slate-600 bg-dark-900 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-slate-300">Minimize to tray on close</span>
            </label>
            {prefsError && <p className="text-red-400 text-xs">{prefsError}</p>}
            {prefsSuccess && <p className="text-emerald-400 text-xs">{prefsSuccess}</p>}
            <button
              onClick={handleSavePrefs}
              disabled={prefsSaving}
              className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {prefsSaving ? "Saving..." : "Save Preferences"}
            </button>
          </div>
        </div>

        {/* Email Configuration */}
        {smtpLoaded && (
          <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
            <div className="mb-5">
              <h3 className="text-lg font-semibold text-white">Email Configuration</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure SMTP to receive alert emails.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-400 mb-1">SMTP Host</label>
                  <input
                    type="text"
                    value={smtp.smtpHost}
                    onChange={(e) => setSmtp((s) => ({ ...s, smtpHost: e.target.value }))}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    placeholder="smtp.gmail.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={smtp.smtpPort}
                    onChange={(e) => setSmtp((s) => ({ ...s, smtpPort: Number(e.target.value) }))}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    min={1}
                    max={65535}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={smtp.username}
                    onChange={(e) => setSmtp((s) => ({ ...s, username: e.target.value }))}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
                  <input
                    type="password"
                    value={smtp.password}
                    onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">From Address</label>
                <input
                  type="email"
                  value={smtp.fromAddress}
                  onChange={(e) => setSmtp((s) => ({ ...s, fromAddress: e.target.value }))}
                  className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                  placeholder="alerts@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  To Addresses <span className="text-slate-500 font-normal">(one per line)</span>
                </label>
                <textarea
                  value={smtp.toAddresses.join("\n")}
                  onChange={(e) =>
                    setSmtp((s) => ({
                      ...s,
                      toAddresses: e.target.value
                        .split("\n")
                        .map((a) => a.trim())
                        .filter(Boolean),
                    }))
                  }
                  rows={3}
                  className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 resize-none"
                  placeholder="you@example.com"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtp.useTls}
                  onChange={(e) => setSmtp((s) => ({ ...s, useTls: e.target.checked }))}
                  className="rounded border-slate-600 bg-dark-900 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-slate-300">Use TLS</span>
              </label>

              <div className="flex items-center gap-2 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg">
                <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs text-yellow-400">
                  SMTP password is stored in plain text in the app data directory.
                </p>
              </div>

              {smtpError && <p className="text-red-400 text-xs">{smtpError}</p>}
              {smtpSuccess && <p className="text-emerald-400 text-xs">{smtpSuccess}</p>}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveSmtp}
                  disabled={smtpSaving}
                  className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {smtpSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleTestEmail}
                  disabled={testingEmail}
                  className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-900 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testingEmail ? "Sending..." : "Test Email"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Data Export */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-white">Data Export</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Export your data to CSV files for use in spreadsheets.
            </p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => handleExport("export_miners_csv", "miners.csv")}
              className="w-full flex items-center justify-between px-4 py-3 bg-dark-900 border border-slate-700/40 rounded-lg text-sm text-slate-300 hover:text-white hover:border-primary-500/50 transition-colors"
            >
              <span>Export Miner List</span>
              <span className="text-xs text-slate-500">CSV</span>
            </button>
            <button
              onClick={() => handleExport("export_alert_history_csv", "alert_history.csv")}
              className="w-full flex items-center justify-between px-4 py-3 bg-dark-900 border border-slate-700/40 rounded-lg text-sm text-slate-300 hover:text-white hover:border-primary-500/50 transition-colors"
            >
              <span>Export Alert History</span>
              <span className="text-xs text-slate-500">CSV</span>
            </button>
            <button
              onClick={() => handleExport("export_profitability_csv", "profitability.csv", { currency })}
              className="w-full flex items-center justify-between px-4 py-3 bg-dark-900 border border-slate-700/40 rounded-lg text-sm text-slate-300 hover:text-white hover:border-primary-500/50 transition-colors"
            >
              <span>Export Profitability Report</span>
              <span className="text-xs text-slate-500">CSV</span>
            </button>
            <button
              onClick={() => handleExport("export_farm_history_csv", "farm_history.csv", { hours: 168 })}
              className="w-full flex items-center justify-between px-4 py-3 bg-dark-900 border border-slate-700/40 rounded-lg text-sm text-slate-300 hover:text-white hover:border-primary-500/50 transition-colors"
            >
              <span>Export Farm History (7d)</span>
              <span className="text-xs text-slate-500">CSV</span>
            </button>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-white">Troubleshooting</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Log settings and diagnostic tools for debugging issues.
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Log Level</label>
              <div className="flex items-center gap-3">
                <select
                  value={logLevel}
                  onChange={(e) => handleSetLogLevel(e.target.value)}
                  disabled={logLevelSaving}
                  className="bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 disabled:opacity-50"
                >
                  <option value="error">Error</option>
                  <option value="warn">Warn</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
                {logLevelMsg && (
                  <span className={`text-xs ${logLevelMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                    {logLevelMsg}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Changes take effect immediately. Debug logs are verbose — use Info for normal operation.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleOpenLogDir}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-900 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors"
              >
                Open Log Folder
              </button>
              <button
                onClick={handleExportLog}
                disabled={logExporting}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-900 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {logExporting ? "Exporting..." : "Export Log File"}
              </button>
            </div>
          </div>
        </div>

        {/* Updates */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-white">Updates</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Check for new releases of PoPManager.
            </p>
          </div>
          <div className="space-y-4">
            <div className="text-sm text-slate-500">
              Current Version{currentVersion ? `: v${currentVersion}` : ""}
            </div>
            {availableUpdate && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Available Version</span>
                <span className="text-emerald-400 font-mono">{availableUpdate.version}</span>
              </div>
            )}
            {updateError && <p className="text-red-400 text-xs">{updateError}</p>}
            {updateSuccess && <p className="text-emerald-400 text-xs">{updateSuccess}</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={handleCheckForUpdates}
                disabled={checkingUpdate || updateInstalling}
                className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {checkingUpdate ? "Checking..." : "Check for Updates"}
              </button>
              {availableUpdate && (
                <button
                  onClick={handleInstallUpdate}
                  disabled={updateInstalling}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {updateInstalling ? "Installing..." : "Update Now"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Miner Server */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-white">Mobile Miner Server</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Allow PoPMobile Android app to push telemetry to PoPManager over HTTP.
            </p>
          </div>
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mobileConfig.enabled}
                onChange={(e) => setMobileConfig((c) => ({ ...c, enabled: e.target.checked }))}
                className="rounded border-slate-600 bg-dark-900 text-primary-600"
              />
              <span className="text-sm text-slate-300">Enable mobile miner server</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Port</label>
                <input
                  type="number"
                  value={mobileConfig.port}
                  onChange={(e) => setMobileConfig((c) => ({ ...c, port: Number(e.target.value) }))}
                  className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                  min={1024}
                  max={65535}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Report Interval (seconds)
                </label>
                <input
                  type="number"
                  value={mobileConfig.reportIntervalSeconds}
                  onChange={(e) =>
                    setMobileConfig((c) => ({
                      ...c,
                      reportIntervalSeconds: Number(e.target.value),
                    }))
                  }
                  className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                  min={10}
                  max={300}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mobileConfig.requireApiKey}
                onChange={(e) =>
                  setMobileConfig((c) => ({ ...c, requireApiKey: e.target.checked }))
                }
                className="rounded border-slate-600 bg-dark-900 text-primary-600"
              />
              <span className="text-sm text-slate-300">Require API key authentication</span>
            </label>
            {mobileServerUrl && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Server URL</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={mobileServerUrl}
                    className="flex-1 bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-300 text-sm font-mono"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(mobileServerUrl);
                      setMobileCopied(true);
                      setTimeout(() => setMobileCopied(false), 2000);
                    }}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
                  >
                    {mobileCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Windows Firewall may prompt to allow PoPManager on this port.
                </p>
              </div>
            )}
            {mobileMsg && <p className="text-xs text-amber-400">{mobileMsg}</p>}
            <button
              onClick={handleSaveMobileConfig}
              disabled={mobileSaving}
              className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {mobileSaving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </div>

        {/* About Section */}
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
          <h3 className="text-lg font-semibold text-white mb-5">About</h3>

          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-700/50">
            <img
              src={popLogo}
              alt="PoPManager Logo"
              className="w-14 h-14 rounded-xl object-contain flex-shrink-0"
            />
            <div>
              <h4 className="text-xl font-bold text-white">PoPManager</h4>
              <p className="text-xs text-slate-500 mt-0.5">Open-source ASIC miner management</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Created by</span>
              <span className="text-slate-200 font-medium">Proof of Prints</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Support</span>
              <a
                href="mailto:support@proofofprints.com"
                className="text-primary-400 hover:text-primary-300 transition-colors"
              >
                support@proofofprints.com
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">License</span>
              <span className="text-slate-200">MIT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Supported Hardware</span>
              <span className="text-slate-200">Iceriver KS0-KS5, Whatsminer M50/M56/M60/M66, Antminer S19/S21</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="text-slate-500">GitHub</span>
              <button
                onClick={() => openUrl("https://github.com/proofofprints/PoPManager")}
                className="text-primary-400 hover:text-primary-300 transition-colors text-sm"
              >
                github.com/proofofprints/PoPManager
              </button>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              Profitability estimates are calculated based on current network difficulty, block rewards, coin prices, and configured pool fees. Actual earnings may vary due to pool luck, network difficulty changes, miner uptime, hardware efficiency, and market volatility. These figures are estimates only and should not be considered financial advice.
            </p>

            <details className="group">
              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-300 transition-colors list-none flex items-center gap-1">
                <svg className="w-3 h-3 transform transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Legal & License Information
              </summary>
              <div className="mt-3 space-y-3 text-xs text-slate-500 leading-relaxed">
                <div>
                  <p className="text-slate-400 font-medium mb-1">No Warranty</p>
                  <p>
                    PoPManager is provided "AS IS", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium mb-1">No Support Guarantee</p>
                  <p>
                    PoPManager is an open-source project maintained on a best-effort basis. No support, service level agreement, or uptime guarantee is provided. Bug reports and feature requests may be submitted through the project's GitHub repository, but the maintainers make no commitment to respond or resolve issues within any specific timeframe.
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium mb-1">Use at Your Own Risk</p>
                  <p>
                    Cryptocurrency mining carries inherent risks including but not limited to hardware damage, electrical hazards, financial loss, regulatory changes, and market volatility. PoPManager provides monitoring and management tools only — it does not control hardware safety, electrical installation, or financial outcomes. Users are solely responsible for their mining operations, hardware configuration, electrical safety, regulatory compliance, tax obligations, and any financial consequences.
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium mb-1">Third-Party Services</p>
                  <p>
                    PoPManager may communicate with third-party services including cryptocurrency price APIs, network statistics providers, and mining pools. The maintainers are not responsible for the availability, accuracy, terms of service, or privacy practices of any third-party service. Data displayed from external sources is provided on an "as is" basis with no guarantees of accuracy or timeliness.
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium mb-1">Trademarks</p>
                  <p>
                    "Iceriver," "Antminer," "Whatsminer," and other hardware model names referenced throughout this software are trademarks of their respective owners. Use of these names is solely for hardware identification purposes and does not imply endorsement or affiliation. PoPManager is not affiliated with, sponsored by, or endorsed by any cryptocurrency project, hardware manufacturer, or mining pool mentioned within the software.
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium mb-1">MIT License</p>
                  <p>
                    Copyright (c) 2026 Proof of Prints. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the conditions of the MIT License. Full license text available in the project's LICENSE file on GitHub.
                  </p>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
