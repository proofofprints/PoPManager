import type { PoolProfile } from "../types/miner";

function extractHostname(addr: string): string {
  if (!addr) return "";
  try {
    const withProtocol = addr.includes("://") ? addr : "tcp://" + addr;
    return new URL(withProtocol).hostname;
  } catch {
    return addr.split(":")[0];
  }
}

export function getMinerCoinId(
  minerPoolAddr: string | undefined,
  poolProfiles: PoolProfile[],
  savedMinerCoinId?: string
): string {
  if (minerPoolAddr) {
    const minerHost = extractHostname(minerPoolAddr);
    if (minerHost) {
      const matchingProfile = poolProfiles.find((p) => {
        const profileHost = extractHostname(p.pool1addr);
        return profileHost && profileHost === minerHost;
      });
      if (matchingProfile?.coin_id) return matchingProfile.coin_id;
    }
  }
  return savedMinerCoinId || "other";
}
