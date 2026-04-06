import kaspaIcon from '../assets/coins/kaspa.png';
import bitcoinIcon from '../assets/coins/bitcoin.png';

const COIN_ICONS: Record<string, string> = {
  kaspa: kaspaIcon,
  bitcoin: bitcoinIcon,
};

export function getCoinIcon(coinId: string): string | null {
  return COIN_ICONS[coinId] ?? null;
}
