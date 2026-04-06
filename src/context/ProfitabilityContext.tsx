import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PoolProfile, CoinConfig } from "../types/miner";
import { info, warn } from "../utils/logger";

interface ProfitabilityContextValue {
  kasPrice: number | null;
  coinPrices: Record<string, number>;
  getCoinPrice: (coinId: string) => number | null;
  currency: string;
  poolFeePercent: number;
  electricityCostPerKwh: number;
  minerWattage: number;
  poolProfiles: PoolProfile[];
  refreshPrefs: () => void;
}

const ProfitabilityContext = createContext<ProfitabilityContextValue>({
  kasPrice: null,
  coinPrices: {},
  getCoinPrice: () => null,
  currency: 'usd',
  poolFeePercent: 1.0,
  electricityCostPerKwh: 0.10,
  minerWattage: 100.0,
  poolProfiles: [],
  refreshPrefs: () => {},
});

const POLL_INTERVAL_MS = 45_000;

export function ProfitabilityProvider({ children }: { children: ReactNode }) {
  const [coinPrices, setCoinPrices] = useState<Record<string, number>>({});
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const [currency, setCurrency] = useState('usd');
  const [poolFeePercent, setPoolFeePercent] = useState(1.0);
  const [electricityCostPerKwh, setElectricityCostPerKwh] = useState(0.10);
  const [minerWattage, setMinerWattage] = useState(100.0);
  const [poolProfiles, setPoolProfiles] = useState<PoolProfile[]>([]);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  function loadPrefs() {
    invoke<{ currency: string; poolFeePercent: number; electricityCostPerKwh: number; minerWattage: number }>("get_preferences")
      .then((prefs) => {
        setCurrency(prefs.currency);
        setPoolFeePercent(prefs.poolFeePercent);
        setElectricityCostPerKwh(prefs.electricityCostPerKwh);
        setMinerWattage(prefs.minerWattage);
        setPrefsLoaded(true);
      })
      .catch(() => setPrefsLoaded(true));

    invoke<PoolProfile[]>("get_saved_pools")
      .then(setPoolProfiles)
      .catch(console.error);

    invoke<CoinConfig[]>("get_coins")
      .then(setCoins)
      .catch(console.error);
  }

  useEffect(() => {
    loadPrefs();
  }, []);

  const fetchAllPrices = useCallback((coinList: CoinConfig[], curr: string) => {
    coinList.forEach((coin) => {
      invoke<number>("get_coin_price", { coingeckoId: coin.coingeckoId, currency: curr })
        .then((price) => {
          setCoinPrices((prev) => ({ ...prev, [coin.id]: price }));
          info(`${coin.ticker} price: ${price} ${curr.toUpperCase()}`).catch(() => {});
        })
        .catch((err) => {
          warn(`${coin.ticker} price fetch failed: ${err}`).catch(() => {});
        });
    });
  }, []);

  useEffect(() => {
    if (!prefsLoaded || coins.length === 0) return;

    fetchAllPrices(coins, currency);
    const id = setInterval(() => fetchAllPrices(coins, currency), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [currency, prefsLoaded, coins, fetchAllPrices]);

  const getCoinPrice = useCallback((coinId: string): number | null => {
    return coinPrices[coinId] ?? null;
  }, [coinPrices]);

  const kasPrice = coinPrices["kaspa"] ?? null;

  return (
    <ProfitabilityContext.Provider
      value={{
        kasPrice,
        coinPrices,
        getCoinPrice,
        currency,
        poolFeePercent,
        electricityCostPerKwh,
        minerWattage,
        poolProfiles,
        refreshPrefs: loadPrefs,
      }}
    >
      {children}
    </ProfitabilityContext.Provider>
  );
}

export function useProfitability() {
  return useContext(ProfitabilityContext);
}
