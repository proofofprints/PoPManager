import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { PoolProfile, SavedMiner, MinerInfo, CoinConfig } from "../types/miner";

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

interface MinerMatch {
  ip: string;
  label: string;
  model: string;
  coinId: string;
  online: boolean;
  hashrate: number;
  hashrateUnit: string;
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

  useEffect(() => {
    invoke<PoolProfile[]>("get_saved_pools").then(setProfiles).catch(console.error);
    invoke<CoinConfig[]>("get_coins").then(setCoins).catch(console.error);

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

  function getMinersForProfile(profile: PoolProfile): MinerMatch[] {
    const profileHostname = extractHostname(profile.pool1addr);
    return savedMiners
      .map((saved): MinerMatch | null => {
        const info = minerData.get(saved.ip);
        if (!info) return null;
        const activePool = info.pools.find((p) => p.connect) ?? info.pools[0];
        if (!activePool) return null;
        const minerHostname = extractHostname(activePool.addr);
        if (!profileHostname || !minerHostname || minerHostname !== profileHostname) return null;
        const label =
          saved.label && saved.label !== saved.ip
            ? saved.label
            : info.hostname || saved.ip;
        return {
          ip: saved.ip,
          label,
          model: info.model,
          coinId: saved.coin_id,
          online: info.online,
          hashrate: info.rtHashrate,
          hashrateUnit: info.hashrateUnit,
        };
      })
      .filter((m): m is MinerMatch => m !== null);
  }

  function getTotalHashrate(profile: PoolProfile): { value: number; unit: string } {
    const miners = getMinersForProfile(profile);
    if (miners.length === 0) return { value: 0, unit: "TH" };
    const total = miners.filter((m) => m.online).reduce((sum, m) => sum + m.hashrate, 0);
    return { value: total, unit: miners[0].hashrateUnit };
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
              {selectedProfile.coin_id && (
                <p className="text-slate-400 text-sm">
                  Coin: {coins.find(c => c.id === selectedProfile.coin_id)?.name ?? selectedProfile.coin_id}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Name / IP</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Coin</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Hashrate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {miners.map((m) => (
                      <tr
                        key={m.ip}
                        onClick={() => navigate(`/miner/${m.ip}`)}
                        className="hover:bg-dark-700 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${m.online ? "bg-emerald-400" : "bg-red-500"}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-white font-medium">{m.label}</div>
                          <div className="text-xs text-slate-500 font-mono">{m.ip}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-300">{m.model || "—"}</td>
                        <td className="px-4 py-3 text-sm text-slate-300 uppercase">{m.coinId || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {m.online ? (
                            <span className="text-sm text-slate-200">
                              {m.hashrate.toFixed(2)} {m.hashrateUnit}H/s
                            </span>
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
                        <span className="text-sm text-slate-300">
                          {coins.find(c => c.id === p.coin_id)?.ticker ?? (p.coin_id || "—")}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {loadingMiners ? (
                          <span className="text-xs text-slate-500">…</span>
                        ) : totalHash > 0 ? (
                          <span className="text-sm text-slate-200">
                            {totalHash.toFixed(2)} {unit}H/s
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
