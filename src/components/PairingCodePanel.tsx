import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";

function formatPairingCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

interface PairingCodePanelProps {
  serverUrl: string;
  onClose?: () => void;
  pollIntervalMs?: number;
  title?: string;
  subtitle?: string;
}

export default function PairingCodePanel({
  serverUrl,
  onClose,
  pollIntervalMs = 3000,
  title = "Pair a New Device",
  subtitle = "In the PoPMobile app, enter these values to register your device.",
}: PairingCodePanelProps) {
  const [code, setCode] = useState<string>("");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = await invoke<string>("get_mobile_auth_code");
      setCode(c);
    } catch (err) {
      console.error("Failed to load pairing code:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const c = await invoke<string>("regenerate_mobile_auth_code");
      setCode(c);
    } catch (err) {
      console.error("Failed to regenerate pairing code:", err);
    } finally {
      setRegenerating(false);
    }
  }

  function handleCopyUrl() {
    navigator.clipboard.writeText(serverUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  return (
    <div className="bg-dark-800 rounded-xl border border-primary-500/30 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 -mr-1 -mt-1"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Server URL */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Server URL</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={serverUrl}
              className="flex-1 bg-dark-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-200 text-sm font-mono"
            />
            <button
              onClick={handleCopyUrl}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg min-w-[64px] transition-colors"
            >
              {copiedUrl ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* Pairing Code */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Pairing Code</label>
          <div className="flex gap-2">
            <div className="flex-1 bg-dark-900 border border-slate-700 rounded-lg px-4 py-3 text-center">
              <span className="text-3xl font-mono font-bold text-white tracking-[0.15em]">
                {code ? formatPairingCode(code) : "— — —   — — —"}
              </span>
            </div>
            <button
              onClick={handleCopyCode}
              disabled={!code}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-xs rounded-lg min-w-[64px] transition-colors"
            >
              {copiedCode ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* QR Code */}
        {serverUrl && code && (
          <div className="flex flex-col items-center gap-2 py-3">
            <div className="bg-white p-3 rounded-lg">
              <QRCodeSVG
                value={JSON.stringify({
                  v: 1,
                  type: "popmanager-register",
                  url: serverUrl,
                  code: code,
                })}
                size={180}
                level="M"
              />
            </div>
            <p className="text-xs text-slate-500">
              Scan with PoPMobile to auto-fill server URL and pairing code
            </p>
          </div>
        )}

        <p className="text-xs text-amber-400/80 flex items-start gap-1.5">
          <svg
            className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>Single-use code. A new one is generated automatically after a successful pairing.</span>
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="px-3 py-1.5 bg-dark-900 border border-slate-700 hover:border-primary-500/50 text-slate-300 text-xs rounded-lg transition-colors disabled:opacity-40"
          >
            {regenerating ? "Generating..." : "Generate New Code"}
          </button>
        </div>
      </div>
    </div>
  );
}
