import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { PoolProfile, SavedMiner, MinerInfo, CoinConfig, MobileMiner } from "../types/miner";
import { getCoinIcon } from "../utils/coinIcon";
import { formatMobileHashrate } from "./MobileMinerList";

type MinerKind = "asic" | "mobile";

interface PoolMinerMatch {
  kind: MinerKind;
  id: string;
  label: string;
  subtitle: string;
  coinId: string;
  coinTicker: string;
  online: boolean;
  hashrateDisplay: string;
  hashrateRaw: number; // normalized to GH/s
  matchedSlot: 1 | 2 | 3;
  onClick: () => void;
}

function hashrateUnitToGhsMultiplier(unit: string): number {
  switch ((unit || "").toUpperCase()) {
    case "K": return 1e-6;
    case "M": return 1e-3;
    case "G": return 1;
    case "T": return 1e3;
    case "P": return 1e6;
    default: return 1;
  }
}

const COIN_TICKER_TO_ID: Record<string, string> = {
  KAS: "kaspa",
  BTC: "bitcoin",
};

function coinIdFromTicker(ticker: string): string {
  if (!ticker) return "kaspa";
  return COIN_TICKER_TO_ID[ticker.toUpperCase()] ?? ticker.toLowerCase();
}

function splitWalletWorker(combined: string): { wallet: string; worker: string } {
  if (!combined) return { wallet: "", worker: "" };
  const lastDot = combined.lastIndexOf(".");
  if (lastDot === -1) return { wallet: combined, worker: "" };
  return {
    wallet: combined.slice(0, lastDot),
    worker: combined.slice(lastDot + 1),
  };
}

const EMPTY_FORM = {
  name: "",
  coin_id: "kaspa",
  pool1addr: "",
  pool1miner: "",
  pool1pwd: "x",
  pool2addr: "",
  pool2miner: "",
  pool2pwd: "x",
  pool3addr: "",
  pool3miner: "",
  pool3pwd: "x",
  fee_percent: "1",
};

type FormState = typeof EMPTY_FORM;

function extractHostname(addr: string): string {
  if (!addr) return "";
  try {
    const withProtocol = addr.includes("://") ? addr : "tcp://" + addr;
    return new URL(withProtocol).hostname;
  } catch {
    return addr.split(":")[0];
  }
}

/** Extract hostname:port from a pool address for matching.
 *  e.g. "stratum+tcp://pool.example.com:5559" → "pool.example.com:5559"
 *  Falls back to extractHostname if port can't be parsed. */
function extractHostPort(addr: string): string {
  if (!addr) return "";
  try {
    const withProtocol = addr.includes("://") ? addr : "tcp://" + addr;
    const url = new URL(withProtocol);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    // Fallback: strip protocol prefix and return what's left
    const stripped = addr.replace(/^[a-z+]+:\/\//, "");
    return stripped || addr;
  }
}

function truncateAddr(addr: string, max = 40): string {
  if (!addr) return "—";
  if (addr.length <= max) return addr;
  return addr.slice(0, max) + "…";
}

function PoolFormFields({
  form,
  onChange,
  coins,
}: {
  form: FormState;
  onChange: (field: keyof FormState, value: string) => void;
  coins: CoinConfig[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">Profile Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange("name", e.target.value)}
          className="w-full bg-dark-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
          placeholder="e.g. Proof of Prints Main"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">Coin</label>
        <select
          value={form.coin_id}
          onChange={(e) => onChange("coin_id", e.target.value)}
          className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
        >
          {coins.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.ticker})
            </option>
          ))}
          <option value="other">Other / Unknown</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">Pool Fee %</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={form.fee_percent}
            onChange={(e) => onChange("fee_percent", e.target.value)}
            className="w-28 bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
          />
          <span className="text-sm text-slate-400">%</span>
        </div>
      </div>

      {([1, 2, 3] as const).map((n) => {
        const addrKey = `pool${n}addr` as keyof FormState;
        const minerKey = `pool${n}miner` as keyof FormState;
        const pwdKey = `pool${n}pwd` as keyof FormState;
        return (
          <div key={n} className="border border-slate-700/40 rounded-lg p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Pool {n}{n === 1 ? " (primary)" : " (backup)"}
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Address</label>
                <input
                  type="text"
                  value={form[addrKey]}
                  onChange={(e) => onChange(addrKey, e.target.value)}
                  className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                  placeholder="stratum+tcp://pool.example.com:3333"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Worker / Wallet</label>
                  <input
                    type="text"
                    value={form[minerKey]}
                    onChange={(e) => onChange(minerKey, e.target.value)}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    placeholder="kaspa:qyp395...worker1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Password</label>
                  <input
                    type="text"
                    value={form[pwdKey]}
                    onChange={(e) => onChange(pwdKey, e.target.value)}
                    className="w-full bg-dark-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    placeholder="x"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Pools() {
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<PoolProfile[]>([]);
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [savedMiners, setSavedMiners] = useState<SavedMiner[]>([]);
  const [minerData, setMinerData] = useState<Map<string, MinerInfo>>(new Map());
  const [loadingMiners, setLoadingMiners] = useState(true);
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const [mobileMiners, setMobileMiners] = useState<MobileMiner[]>([]);

  // Push-to-mobile modal state
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushSelectedIds, setPushSelectedIds] = useState<Set<string>>(new Set());
  const [pushRunning, setPushRunning] = useState(false);
  const [pushResults, setPushResults] = useState<
    Record<string, { state: "idle" | "applying" | "success" | "error"; msg: string }>
  >({});

  useEffect(() => {
    invoke<PoolProfile[]>("get_saved_pools").then(setProfiles).catch(console.error);
    invoke<CoinConfig[]>("get_coins").then(setCoins).catch(console.error);
    invoke<MobileMiner[]>("get_mobile_miners").then(setMobileMiners).catch(console.error);

    invoke<SavedMiner[]>("get_saved_miners")
      .then(async (miners) => {
        setSavedMiners(miners);
        const results = await Promise.allSettled(
          miners.map((m) => invoke<MinerInfo>("get_miner_status", { ip: m.ip }))
        );
        const map = new Map<string, MinerInfo>();
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            map.set(miners[i].ip, r.value);
          }
        });
        setMinerData(map);
      })
      .catch(console.error)
      .finally(() => setLoadingMiners(false));
  }, []);

  // Poll mobile miners every 30s so matches stay fresh
  useEffect(() => {
    const id = setInterval(() => {
      invoke<MobileMiner[]>("get_mobile_miners").then(setMobileMiners).catch(console.error);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  function updateForm(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setShowForm(true);
  }

  function startEdit(p: PoolProfile) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      coin_id: p.coin_id ?? "kaspa",
      pool1addr: p.pool1addr,
      pool1miner: p.pool1miner,
      pool1pwd: p.pool1pwd,
      pool2addr: p.pool2addr,
      pool2miner: p.pool2miner,
      pool2pwd: p.pool2pwd,
      pool3addr: p.pool3addr,
      pool3miner: p.pool3miner,
      pool3pwd: p.pool3pwd,
      fee_percent: String(p.fee_percent ?? 1),
    });
    setSaveError(null);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setSaveError(null);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setSaveError("Profile name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let updated: PoolProfile[];
      if (editingId) {
        updated = await invoke<PoolProfile[]>("update_pool_profile", {
          id: editingId,
          name: form.name,
          pool1addr: form.pool1addr,
          pool1miner: form.pool1miner,
          pool1pwd: form.pool1pwd,
          pool2addr: form.pool2addr,
          pool2miner: form.pool2miner,
          pool2pwd: form.pool2pwd,
          pool3addr: form.pool3addr,
          pool3miner: form.pool3miner,
          pool3pwd: form.pool3pwd,
          feePercent: parseFloat(form.fee_percent) || 0,
          coinId: form.coin_id,
        });
      } else {
        updated = await invoke<PoolProfile[]>("add_pool_profile", {
          name: form.name,
          pool1addr: form.pool1addr,
          pool1miner: form.pool1miner,
          pool1pwd: form.pool1pwd,
          pool2addr: form.pool2addr,
          pool2miner: form.pool2miner,
          pool2pwd: form.pool2pwd,
          pool3addr: form.pool3addr,
          pool3miner: form.pool3miner,
          pool3pwd: form.pool3pwd,
          feePercent: parseFloat(form.fee_percent) || 0,
          coinId: form.coin_id,
        });
      }
      setProfiles(updated);
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const updated = await invoke<PoolProfile[]>("remove_pool_profile", { id });
      setProfiles(updated);
      if (selectedPool === id) setSelectedPool(null);
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  function getMinersForProfile(profile: PoolProfile): PoolMinerMatch[] {
    const slots: { slot: 1 | 2 | 3; hostport: string }[] = ([1, 2, 3] as const)
      .map((n) => ({
        slot: n,
        hostport: extractHostPort(profile[`pool${n}addr` as keyof PoolProfile] as string),
      }))
      .filter((s) => s.hostport);

    if (slots.length === 0) return [];

    const matches: PoolMinerMatch[] = [];

    // ASIC matches
    for (const saved of savedMiners) {
      const info = minerData.get(saved.ip);
      if (!info) continue;
      const activePool = info.pools.find((p) => p.connect) ?? info.pools[0];
      if (!activePool) continue;
      const minerHostPort = extractHostPort(activePool.addr);
      if (!minerHostPort) continue;
      const matched = slots.find((s) => s.hostport === minerHostPort);
      if (!matched) continue;

      const label =
        saved.label && saved.label !== saved.ip
          ? saved.label
          : info.hostname || saved.ip;

      matches.push({
        kind: "asic",
        id: saved.ip,
        label,
        subtitle: info.model || "Unknown",
        coinId: saved.coin_id,
        coinTicker: (saved.coin_id || "").toUpperCase(),
        online: info.online,
        hashrateDisplay: `${info.rtHashrate.toFixed(2)} ${info.hashrateUnit}H/s`,
        hashrateRaw: info.rtHashrate * hashrateUnitToGhsMultiplier(info.hashrateUnit),
        matchedSlot: matched.slot,
        onClick: () => navigate(`/miner/${encodeURIComponent(saved.ip)}`),
      });
    }

    // Mobile matches
    for (const m of mobileMiners) {
      if (!m.pool) continue;
      const minerHostPort = extractHostPort(m.pool);
      if (!minerHostPort) continue;
      const matched = slots.find((s) => s.hostport === minerHostPort);
      if (!matched) continue;

      matches.push({
        kind: "mobile",
        id: m.deviceId,
        label: m.name || m.deviceId.slice(0, 8),
        subtitle:
          [m.deviceModel, m.osVersion].filter(Boolean).join(" · ") || "Mobile",
        coinId: coinIdFromTicker(m.coin),
        coinTicker: (m.coin || "KAS").toUpperCase(),
        online: m.isOnline,
        hashrateDisplay: formatMobileHashrate(m.hashrateHs),
        hashrateRaw: m.hashrateHs / 1e9,
        matchedSlot: matched.slot,
        onClick: () => navigate(`/mobile-miners/${encodeURIComponent(m.deviceId)}`),
      });
    }

    return matches;
  }

  function getTotalHashrate(profile: PoolProfile): { value: number; unit: string } {
    const miners = getMinersForProfile(profile);
    if (miners.length === 0) return { value: 0, unit: "GH/s" };
    const total = miners.filter((m) => m.online).reduce((sum, m) => sum + m.hashrateRaw, 0);
    if (total >= 1000) return { value: total / 1000, unit: "TH/s" };
    if (total >= 1) return { value: total, unit: "GH/s" };
    if (total >= 0.001) return { value: total * 1000, unit: "MH/s" };
    return { value: total * 1e6, unit: "KH/s" };
  }

  async function runPushToMobile() {
    if (!selectedProfile || pushSelectedIds.size === 0 || pushRunning) return;
    const { wallet, worker } = splitWalletWorker(selectedProfile.pool1miner);
    const poolUrl = selectedProfile.pool1addr;

    const ids = Array.from(pushSelectedIds);
    const initial: Record<
      string,
      { state: "idle" | "applying" | "success" | "error"; msg: string }
    > = {};
    for (const id of ids) initial[id] = { state: "idle", msg: "" };
    setPushResults(initial);
    setPushRunning(true);

    for (const deviceId of ids) {
      setPushResults((prev) => ({
        ...prev,
        [deviceId]: { state: "applying", msg: "Queueing..." },
      }));
      try {
        await invoke("queue_mobile_command", {
          deviceId,
          commandType: "set_config",
          params: { poolUrl, wallet, worker },
        });
        setPushResults((prev) => ({
          ...prev,
          [deviceId]: { state: "success", msg: "Queued" },
        }));
      } catch (err) {
        setPushResults((prev) => ({
          ...prev,
          [deviceId]: { state: "error", msg: String(err) },
        }));
      }
    }

    setPushRunning(false);
  }

  function closePushModal() {
    if (pushRunning) return;
    setShowPushModal(false);
    setPushSelectedIds(new Set());
    setPushResults({});
  }

  const selectedProfile = profiles.find((p) => p.id === selectedPool) ?? null;

  // ── Form overlay (add / edit) ──────────────────────────────────────────────
  if (showForm) {
    return (
      <div className="p-8">
        <div className="mb-6">
          <button
            onClick={cancelForm}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {editingId ? "Back to Pool" : "Back to Pools"}
          </button>
          <h2 className="text-2xl font-bold text-white">
            {editingId ? "Edit Pool Profile" : "New Pool Profile"}
          </h2>
        </div>

        <div className="max-w-2xl">
          <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
            <PoolFormFields form={form} onChange={updateForm} coins={coins} />
            {saveError && <p className="text-red-400 text-xs mt-3">{saveError}</p>}
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? "Saving..." : "Save Profile"}
              </button>
              <button
                onClick={cancelForm}
                className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedPool && selectedProfile) {
    const miners = getMinersForProfile(selectedProfile);

    return (
      <div className="p-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => { setSelectedPool(null); setDeleteConfirmId(null); }}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Pool List
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white">{selectedProfile.name}</h2>
              {selectedProfile.fee_percent != null && (
                <p className="text-slate-400 mt-1 text-sm">Fee: {selectedProfile.fee_percent}%</p>
              )}
              {selectedProfile.coin_id && (() => {
                const coin = coins.find(c => c.id === selectedProfile.coin_id);
                const icon = getCoinIcon(selectedProfile.coin_id);
                return (
                  <p className="text-slate-400 text-sm flex items-center gap-1.5">
                    {icon && <img src={icon} alt={selectedProfile.coin_id} className="w-4 h-4 rounded-full" />}
                    Coin: {coin?.name ?? selectedProfile.coin_id}
                  </p>
                );
              })()}
            </div>
            <div className="flex items-center gap-2">
              {mobileMiners.length > 0 && (
                <button
                  onClick={() => setShowPushModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Push to Mobile Miners
                </button>
              )}
              <button
                onClick={() => startEdit(selectedProfile)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-dark-800 hover:bg-dark-700 border border-slate-600 rounded-lg transition-colors"
              >
                Edit Pool
              </button>
              {deleteConfirmId === selectedProfile.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Delete this profile?</span>
                  <button
                    onClick={() => handleDelete(selectedProfile.id)}
                    className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(selectedProfile.id)}
                  className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 bg-dark-800 hover:bg-dark-700 border border-red-900/40 rounded-lg transition-colors"
                >
                  Delete Pool
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-4xl space-y-5">
          {/* Pool Configuration */}
          <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-6">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Pool Configuration</h3>
            <div className="space-y-4">
              {([1, 2, 3] as const).map((n) => {
                const addr = selectedProfile[`pool${n}addr` as keyof PoolProfile] as string;
                const miner = selectedProfile[`pool${n}miner` as keyof PoolProfile] as string;
                const pwd = selectedProfile[`pool${n}pwd` as keyof PoolProfile] as string;
                if (!addr) return null;
                return (
                  <div key={n} className="border border-slate-700/30 rounded-lg p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                      Pool {n}{n === 1 ? " — Primary" : " — Backup"}
                    </p>
                    <div className="space-y-2 text-sm">
                      <div className="flex gap-3">
                        <span className="text-slate-500 w-20 flex-shrink-0">Address</span>
                        <span className="text-slate-200 font-mono text-xs break-all">{addr}</span>
                      </div>
                      {miner && (
                        <div className="flex gap-3">
                          <span className="text-slate-500 w-20 flex-shrink-0">Worker</span>
                          <span className="text-slate-300 font-mono text-xs break-all">{miner}</span>
                        </div>
                      )}
                      {pwd && (
                        <div className="flex gap-3">
                          <span className="text-slate-500 w-20 flex-shrink-0">Password</span>
                          <span className="text-slate-300 font-mono text-xs">{pwd}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Miners on this Pool */}
          <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/50">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Miners on this Pool
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {loadingMiners ? "Loading…" : `${miners.length} miner${miners.length !== 1 ? "s" : ""} matched`}
              </p>
            </div>

            {loadingMiners ? (
              <div className="px-6 py-8 text-center text-slate-500 text-sm">Loading miner data…</div>
            ) : miners.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-500 text-sm">
                No miners currently configured for this pool
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Slot</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Name / ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Coin</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Hashrate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {miners.map((m) => (
                      <tr
                        key={`${m.kind}-${m.id}`}
                        onClick={m.onClick}
                        className="hover:bg-dark-700 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${m.online ? "bg-emerald-400" : "bg-red-500"}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              m.matchedSlot === 1
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-amber-500/20 text-amber-400"
                            }`}
                          >
                            {m.matchedSlot === 1 ? "Primary" : `Backup ${m.matchedSlot - 1}`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {m.kind === "mobile" && (
                              <svg
                                className="w-3.5 h-3.5 text-slate-500 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                                />
                              </svg>
                            )}
                            <div>
                              <div className="text-sm text-white font-medium">{m.label}</div>
                              <div className="text-xs text-slate-500 font-mono">
                                {m.kind === "asic" ? m.id : m.id.slice(0, 8) + "..."}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-300">{m.subtitle || "—"}</td>
                        <td className="px-4 py-3 text-sm text-slate-300">
                          <div className="flex items-center gap-1.5">
                            {getCoinIcon(m.coinId) && (
                              <img src={getCoinIcon(m.coinId)!} alt={m.coinId} className="w-4 h-4 rounded-full flex-shrink-0" />
                            )}
                            <span className="uppercase">{m.coinTicker || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {m.online ? (
                            <span className="text-sm text-slate-200">{m.hashrateDisplay}</span>
                          ) : (
                            <span className="text-sm text-red-400">Offline</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {showPushModal && selectedProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closePushModal} />
            <div className="relative z-10 bg-dark-800 border border-slate-700/50 rounded-2xl p-6 w-full max-w-2xl shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    Push "{selectedProfile.name}" to Mobile Miners
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Queue a set_config command for each selected device. Changes apply on the device's next report.
                  </p>
                </div>
                <button
                  onClick={closePushModal}
                  disabled={pushRunning}
                  className="text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {(() => {
                const { wallet, worker } = splitWalletWorker(selectedProfile.pool1miner);
                return (
                  <div className="bg-dark-900 rounded-lg p-3 mb-5 text-xs font-mono space-y-1">
                    <div className="flex gap-2">
                      <span className="text-slate-500 w-16 flex-shrink-0">Pool URL</span>
                      <span className="text-slate-200 break-all">{selectedProfile.pool1addr}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-slate-500 w-16 flex-shrink-0">Wallet</span>
                      <span className="text-slate-200 break-all">{wallet || "(empty)"}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-slate-500 w-16 flex-shrink-0">Worker</span>
                      <span className="text-slate-200 break-all">{worker || "(empty)"}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-400">
                    Select Devices ({pushSelectedIds.size} / {mobileMiners.length})
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPushSelectedIds(new Set(mobileMiners.map((m) => m.deviceId)))}
                      disabled={pushRunning}
                      className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-40"
                    >
                      Select all
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      onClick={() => setPushSelectedIds(new Set())}
                      disabled={pushRunning}
                      className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="bg-dark-900 rounded-lg border border-slate-700/30 max-h-64 overflow-y-auto divide-y divide-slate-700/30">
                  {mobileMiners.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-6">No mobile miners registered</p>
                  ) : (
                    mobileMiners.map((m) => {
                      const isSelected = pushSelectedIds.has(m.deviceId);
                      const result = pushResults[m.deviceId];
                      const currentPoolHostPort = extractHostPort(m.pool);
                      const profileHostPort = extractHostPort(selectedProfile.pool1addr);
                      const alreadyOnPool = currentPoolHostPort && currentPoolHostPort === profileHostPort;

                      return (
                        <label
                          key={m.deviceId}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-dark-800 ${pushRunning ? "cursor-not-allowed" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={pushRunning}
                            onChange={() => {
                              setPushSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.deviceId)) next.delete(m.deviceId);
                                else next.add(m.deviceId);
                                return next;
                              });
                            }}
                            className="rounded border-slate-600 bg-dark-900 text-primary-600 focus:ring-primary-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white truncate">{m.name}</span>
                              {alreadyOnPool && (
                                <span className="text-xs text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                  On this pool
                                </span>
                              )}
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.isOnline ? "bg-emerald-400" : "bg-slate-500"}`} />
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              {m.deviceModel || "Mobile"} · {m.coin || "KAS"}
                              {m.pool && !alreadyOnPool && (
                                <span className="ml-2 text-slate-600">→ {extractHostname(m.pool)}</span>
                              )}
                            </div>
                          </div>
                          {result && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                result.state === "success"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : result.state === "error"
                                  ? "bg-red-500/20 text-red-400"
                                  : result.state === "applying"
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-slate-500/20 text-slate-400"
                              }`}
                            >
                              {result.state === "applying"
                                ? "..."
                                : result.state === "success"
                                ? "✓"
                                : result.state === "error"
                                ? "✗"
                                : ""}
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <p className="text-xs text-amber-400/80 mb-4 flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Commands are queued immediately but only delivered when each device reports in. Offline devices will receive the config on their next successful report.
                </span>
              </p>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={closePushModal}
                  disabled={pushRunning}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm rounded-lg"
                >
                  {Object.keys(pushResults).length > 0 ? "Close" : "Cancel"}
                </button>
                <button
                  onClick={runPushToMobile}
                  disabled={pushRunning || pushSelectedIds.size === 0}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
                >
                  {pushRunning ? "Pushing..." : `Push to ${pushSelectedIds.size} Device${pushSelectedIds.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view (default) ────────────────────────────────────────────────────
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Pool Profiles</h2>
          <p className="text-slate-400 mt-1">
            Save pool configurations to quickly apply to any miner.
          </p>
        </div>
        <button
          onClick={startAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Pool Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 p-12 text-center">
          <p className="text-slate-500 text-sm">No pool profiles yet. Create one to apply pools to miners quickly.</p>
        </div>
      ) : (
        <div className="bg-dark-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Pool Name</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Pool URL</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Fee %</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Coin</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Total Hashrate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {profiles.map((p) => {
                  const { value: totalHash, unit } = getTotalHashrate(p);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedPool(p.id)}
                      className="hover:bg-dark-700 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-4">
                        <span className="text-sm font-medium text-white">{p.name}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs text-slate-400 font-mono">{truncateAddr(p.pool1addr)}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="text-sm text-slate-300">{p.fee_percent ?? 1}%</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5">
                          {p.coin_id && getCoinIcon(p.coin_id) && (
                            <img src={getCoinIcon(p.coin_id)!} alt={p.coin_id} className="w-4 h-4 rounded-full flex-shrink-0" />
                          )}
                          <span className="text-sm text-slate-300">
                            {coins.find(c => c.id === p.coin_id)?.ticker ?? (p.coin_id || "—")}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {loadingMiners ? (
                          <span className="text-xs text-slate-500">…</span>
                        ) : totalHash > 0 ? (
                          <span className="text-sm text-slate-200">
                            {totalHash.toFixed(2)} {unit}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">No online miners</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
