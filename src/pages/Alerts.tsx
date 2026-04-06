import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { AlertEvent, AlertRule, RuleType } from "../types/alerts";
import type { SavedMiner } from "../types/miner";
import { useAlerts } from "../context/AlertContext";

// ─── Alert Rules helpers ──────────────────────────────────────────────────────

const EMPTY_RULE: Omit<AlertRule, "id"> = {
  name: "",
  enabled: true,
  ruleType: "HashrateDrop",
  threshold: 10,
  appliesTo: [],
  notifyDesktop: true,
  notifyEmail: false,
  cooldownMinutes: 30,
};

function thresholdLabel(ruleType: RuleType): string {
  switch (ruleType) {
    case "HashrateDrop":
      return "Drop threshold (GH/s)";
    case "TempAbove":
      return "Temperature threshold (°C)";
    case "MinerOffline":
      return "Offline duration (# polls)";
    case "NoShares":
      return "Minutes without new shares";
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = "history" | "rules";

export default function Alerts() {
  const [tab, setTab] = useState<Tab>("history");

  // History state
  const [history, setHistory] = useState<AlertEvent[]>([]);
  const [filterMiner, setFilterMiner] = useState("All");
  const [historyLoading, setHistoryLoading] = useState(true);
  const { refreshHistory } = useAlerts();

  // Search + sort state for history
  const [alertSearch, setAlertSearch] = useState("");
  const [alertSortCol, setAlertSortCol] = useState<"time" | "miner" | "rule">("time");
  const [alertSortDir, setAlertSortDir] = useState<"asc" | "desc">("desc");

  // Rules state
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [savedMiners, setSavedMiners] = useState<SavedMiner[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<Omit<AlertRule, "id">>(EMPTY_RULE);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  // ── History handlers ──────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    try {
      const events = await invoke<AlertEvent[]>("get_alert_history");
      setHistory([...events].reverse());
    } catch (err) {
      console.error("Failed to load alert history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    invoke<AlertRule[]>("get_alert_rules").then(setRules).catch(console.error);
    invoke<SavedMiner[]>("get_saved_miners").then(setSavedMiners).catch(console.error);
  }, [loadHistory]);

  async function handleAcknowledge(id: string) {
    try {
      await invoke("acknowledge_alert", { id });
      setHistory((prev) =>
        prev.map((e) => (e.id === id ? { ...e, acknowledged: true } : e))
      );
      refreshHistory();
    } catch (err) {
      console.error("Acknowledge failed:", err);
    }
  }

  async function handleAcknowledgeAll() {
    const unacked = history.filter((e) => !e.acknowledged);
    for (const e of unacked) {
      await invoke("acknowledge_alert", { id: e.id }).catch(console.error);
    }
    setHistory((prev) => prev.map((e) => ({ ...e, acknowledged: true })));
    refreshHistory();
  }

  async function handleClearHistory() {
    try {
      await invoke("clear_alert_history");
      setHistory([]);
      refreshHistory();
    } catch (err) {
      console.error("Clear failed:", err);
    }
  }

  async function handleExportCSV() {
    try {
      const filePath = await save({ filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (filePath) {
        const csv = await invoke<string>("export_alert_history_csv");
        await writeTextFile(filePath, csv);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  // ── Rule handlers ─────────────────────────────────────────────────────────

  function updateRuleForm<K extends keyof Omit<AlertRule, "id">>(
    field: K,
    value: Omit<AlertRule, "id">[K]
  ) {
    setRuleForm((prev) => ({ ...prev, [field]: value }));
  }

  function startAddRule() {
    setEditingRuleId(null);
    setRuleForm(EMPTY_RULE);
    setRuleError(null);
    setShowRuleForm(true);
  }

  function startEditRule(r: AlertRule) {
    setEditingRuleId(r.id);
    setRuleForm({
      name: r.name,
      enabled: r.enabled,
      ruleType: r.ruleType,
      threshold: r.threshold,
      appliesTo: r.appliesTo,
      notifyDesktop: r.notifyDesktop,
      notifyEmail: r.notifyEmail,
      cooldownMinutes: r.cooldownMinutes,
    });
    setRuleError(null);
    setShowRuleForm(true);
  }

  function cancelRuleForm() {
    setShowRuleForm(false);
    setEditingRuleId(null);
    setRuleError(null);
  }

  async function handleSaveRule() {
    if (!ruleForm.name.trim()) {
      setRuleError("Rule name is required.");
      return;
    }
    setRuleSaving(true);
    setRuleError(null);
    try {
      let updated: AlertRule[];
      if (editingRuleId) {
        updated = await invoke<AlertRule[]>("update_alert_rule", {
          rule: { id: editingRuleId, ...ruleForm },
        });
      } else {
        updated = await invoke<AlertRule[]>("add_alert_rule", { rule: ruleForm });
      }
      setRules(updated);
      setShowRuleForm(false);
      setEditingRuleId(null);
    } catch (err) {
      setRuleError(String(err));
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleDeleteRule(id: string) {
    try {
      const updated = await invoke<AlertRule[]>("remove_alert_rule", { id });
      setRules(updated);
    } catch (err) {
      console.error("Delete rule failed:", err);
    }
  }

  async function handleToggleRule(rule: AlertRule) {
    try {
      const updated = await invoke<AlertRule[]>("update_alert_rule", {
        rule: { ...rule, enabled: !rule.enabled },
      });
      setRules(updated);
    } catch (err) {
      console.error("Toggle rule failed:", err);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const uniqueMiners = [
    "All",
    ...Array.from(new Set(history.map((e) => e.minerLabel || e.minerIp))),
  ];

  const filtered = history
    .filter((e) => {
      if (filterMiner !== "All" && (e.minerLabel || e.minerIp) !== filterMiner) return false;
      if (alertSearch) {
        const q = alertSearch.toLowerCase();
        const minerStr = (e.minerLabel || e.minerIp || "").toLowerCase();
        const ipStr = (e.minerIp || "").toLowerCase();
        const ruleStr = (e.ruleName || "").toLowerCase();
        if (!minerStr.includes(q) && !ipStr.includes(q) && !ruleStr.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      if (alertSortCol === "time") {
        aVal = new Date(a.timestamp).getTime();
        bVal = new Date(b.timestamp).getTime();
      } else if (alertSortCol === "miner") {
        aVal = (a.minerLabel || a.minerIp || "").toLowerCase();
        bVal = (b.minerLabel || b.minerIp || "").toLowerCase();
      } else {
        aVal = (a.ruleName || "").toLowerCase();
        bVal = (b.ruleName || "").toLowerCase();
      }
      if (aVal < bVal) return alertSortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return alertSortDir === "asc" ? 1 : -1;
      return 0;
    });

  const unackedCount = history.filter((e) => !e.acknowledged).length;

  function handleAlertSort(col: "time" | "miner" | "rule") {
    if (alertSortCol === col) {
      setAlertSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setAlertSortCol(col);
      setAlertSortDir(col === "time" ? "desc" : "asc");
    }
  }

  function AlertSortIcon({ col }: { col: "time" | "miner" | "rule" }) {
    if (alertSortCol !== col) {
      return (
        <svg className="w-3 h-3 text-slate-600 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return alertSortDir === "asc" ? (
      <svg className="w-3 h-3 text-primary-400 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-primary-400 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Alerts</h2>
        <p className="text-slate-400 mt-1">Monitor alert history and manage alert rules</p>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-6 bg-dark-800 border border-slate-700/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "history"
              ? "bg-primary-600 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          History
          {unackedCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[1.1rem] h-4 px-1 rounded-full text-xs font-bold bg-red-500 text-white leading-none">
              {unackedCount > 99 ? "99+" : unackedCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("rules")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "rules"
              ? "bg-primary-600 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Rules
          <span className="ml-2 text-xs text-slate-500">{rules.length}</span>
        </button>
      </div>

      {/* ── HISTORY TAB ───────────────────────────────────────────────────── */}
      {tab === "history" && (
        <>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <input
              type="text"
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
              placeholder="Search by miner or rule..."
              className="bg-dark-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 w-56"
            />
            <select
              value={filterMiner}
              onChange={(e) => setFilterMiner(e.target.value)}
              className="bg-dark-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
            >
              {uniqueMiners.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className="flex-1" />
            {unackedCount > 0 && (
              <button
                onClick={handleAcknowledgeAll}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-800 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors"
              >
                Acknowledge All ({unackedCount})
              </button>
            )}
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-800 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={handleClearHistory}
              className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 bg-dark-800 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors"
            >
              Clear History
            </button>
          </div>

          <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
            {historyLoading ? (
              <div className="text-center py-12 text-slate-500 text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                No alerts yet. Configure alert rules to get started.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th
                      className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors"
                      onClick={() => handleAlertSort("time")}
                    >
                      Time <AlertSortIcon col="time" />
                    </th>
                    <th
                      className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors"
                      onClick={() => handleAlertSort("miner")}
                    >
                      Miner <AlertSortIcon col="miner" />
                    </th>
                    <th
                      className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors"
                      onClick={() => handleAlertSort("rule")}
                    >
                      Rule <AlertSortIcon col="rule" />
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Message</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => (
                    <tr
                      key={event.id}
                      className={`border-b border-slate-700/30 last:border-0 transition-colors ${
                        event.acknowledged
                          ? "opacity-50 bg-gray-900/20"
                          : "border-l-2 border-l-amber-500/60"
                      }`}
                    >
                      <td className="px-5 py-3 text-slate-400 whitespace-nowrap text-xs">
                        {new Date(event.timestamp).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-white font-medium">
                        {event.minerLabel || event.minerIp}
                        <span className="text-slate-500 text-xs ml-1.5">({event.minerIp})</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary-600/20 text-primary-400 border border-primary-600/30">
                          {event.ruleName}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-300">{event.message}</td>
                      <td className="px-5 py-3 text-right">
                        {event.acknowledged ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Done
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAcknowledge(event.id)}
                            className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── RULES TAB ─────────────────────────────────────────────────────── */}
      {tab === "rules" && (
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-slate-400">
              Get notified when miners drop in performance or go offline.
            </p>
            {!showRuleForm && (
              <button
                onClick={startAddRule}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Rule
              </button>
            )}
          </div>

          {rules.length === 0 && !showRuleForm && (
            <p className="text-slate-500 text-sm text-center py-6 bg-dark-800 rounded-xl border border-slate-700/50">
              No alert rules. Add one to start monitoring your miners.
            </p>
          )}

          {rules.length > 0 && (
            <div className="space-y-2 mb-5">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`border rounded-lg px-4 py-3 flex items-center justify-between gap-3 bg-dark-800 ${
                    rule.enabled ? "border-slate-700/40" : "border-slate-700/20 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => handleToggleRule(rule)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        rule.enabled ? "bg-primary-600" : "bg-slate-600"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ${
                          rule.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{rule.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {rule.ruleType} · threshold: {rule.threshold} · cooldown: {rule.cooldownMinutes}m
                        {rule.appliesTo.length > 0
                          ? ` · ${rule.appliesTo.length} miner(s)`
                          : " · all miners"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                      onClick={() => startEditRule(rule)}
                      className="text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showRuleForm && (
            <div className="border border-primary-500/30 rounded-lg p-5 bg-dark-800 space-y-4">
              <h4 className="text-sm font-semibold text-primary-400">
                {editingRuleId ? "Edit Rule" : "New Alert Rule"}
              </h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Rule Name</label>
                  <input
                    type="text"
                    value={ruleForm.name}
                    onChange={(e) => updateRuleForm("name", e.target.value)}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    placeholder="e.g. Low hashrate warning"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Rule Type</label>
                  <select
                    value={ruleForm.ruleType}
                    onChange={(e) => updateRuleForm("ruleType", e.target.value as RuleType)}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                  >
                    <option value="HashrateDrop">Hashrate Drop</option>
                    <option value="TempAbove">Temperature Above</option>
                    <option value="MinerOffline">Miner Offline</option>
                    <option value="NoShares">No Shares</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {thresholdLabel(ruleForm.ruleType)}
                  </label>
                  <input
                    type="number"
                    value={ruleForm.threshold}
                    onChange={(e) => updateRuleForm("threshold", Number(e.target.value))}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    min={0}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Cooldown (minutes)</label>
                  <input
                    type="number"
                    value={ruleForm.cooldownMinutes}
                    onChange={(e) => updateRuleForm("cooldownMinutes", Number(e.target.value))}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    min={1}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Applies To</label>
                  <select
                    multiple
                    value={ruleForm.appliesTo}
                    onChange={(e) =>
                      updateRuleForm(
                        "appliesTo",
                        Array.from(e.target.selectedOptions, (o) => o.value)
                      )
                    }
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 h-20"
                  >
                    {savedMiners.map((m) => (
                      <option key={m.ip} value={m.ip}>
                        {m.label || m.ip}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Hold Ctrl/Cmd to select multiple. Leave empty for all miners.
                  </p>
                </div>

                <div className="space-y-3 pt-1">
                  <label className="block text-xs font-medium text-slate-400 mb-2">Notifications</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ruleForm.notifyDesktop}
                      onChange={(e) => updateRuleForm("notifyDesktop", e.target.checked)}
                      className="rounded border-slate-600 bg-dark-900 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-slate-300">Desktop notification</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ruleForm.notifyEmail}
                      onChange={(e) => updateRuleForm("notifyEmail", e.target.checked)}
                      className="rounded border-slate-600 bg-dark-900 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-slate-300">Email notification</span>
                  </label>
                </div>
              </div>

              {ruleError && <p className="text-red-400 text-xs">{ruleError}</p>}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveRule}
                  disabled={ruleSaving}
                  className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {ruleSaving ? "Saving..." : "Save Rule"}
                </button>
                <button
                  onClick={cancelRuleForm}
                  className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
