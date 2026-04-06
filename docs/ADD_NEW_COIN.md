# Adding a New Coin to PoPManager

Fill out this template and give it to Claude (or a developer) to implement support for a new cryptocurrency in PoPManager.

---

## Coin Information

```
id:              <lowercase, no spaces — used as internal key, e.g. "bitcoin">
name:            <Human-readable name, e.g. "Bitcoin">
ticker:          <Exchange ticker, e.g. "BTC">
algorithm:       <Mining algorithm, e.g. "SHA-256", "Ethash", "kHeavyHash">
coingecko_id:    <CoinGecko coin ID for price lookups, e.g. "bitcoin">
color:           <Hex color for UI accents, e.g. "#F7931A">
```

## Network Hashrate API

```
url:             <Full URL that returns current network hashrate>
response_field:  <JSON field path to the hashrate value, e.g. "hashrate" or "data.hashrate">
unit:            <Unit the API returns, e.g. "TH/s", "GH/s", "H/s">
```

Example response from the API (paste a sample here):
```json
{
  "hashrate": 123456.78
}
```

## Block Reward API

```
url:             <Full URL that returns current block reward>
response_field:  <JSON field path to the reward value>
divisor:         <Divisor to convert to coin units.
                  Use 1.0 if the API returns the value in full coins.
                  Use 100_000_000.0 if the API returns satoshis/base units.>
```

Example response from the API (paste a sample here):
```json
{
  "blockreward": 146.48
}
```

## Block Time

```
block_time_seconds: <Average seconds between blocks, e.g. 600.0 for Bitcoin, 1.0 for Kaspa>
```

## Miner Hashrate Unit

```
default_hashrate_unit: <Unit miners report hashrate in, e.g. "GH/s", "TH/s", "MH/s">
```

## Miner Hardware Notes

```
hardware:       <List of ASIC miners that mine this coin, e.g. "Iceriver KS0, KS0 Pro">
api_type:       <Miner API type if known. Currently supported: "iceriver">
```

---

## Example: Kaspa (already built-in)

```
id:                    kaspa
name:                  Kaspa
ticker:                KAS
algorithm:             kHeavyHash
coingecko_id:          kaspa
color:                 #49EACB

network_hashrate_url:  https://api.kaspa.org/info/hashrate
response_field:        hashrate
unit:                  TH/s

block_reward_url:      https://api.kaspa.org/info/blockreward
response_field:        blockreward
divisor:               1.0

block_time_seconds:    1.0
default_hashrate_unit: GH/s

hardware:              Iceriver KS0, KS0 Pro, KS0 Ultra
api_type:              iceriver
```

---

## Notes for the Developer

When a filled-out template is provided, the implementation steps are:

1. **`src-tauri/src/commands/coins.rs`** — add the new coin to `builtin_coins()` (or it can be added as a user coin via `add_coin` if not yet ready to be built-in).

2. **`src-tauri/src/commands/profitability.rs`** — if the profitability calculation logic is coin-specific (different API parsing), update `get_network_stats` and `calculate_earnings` to be coin-aware.

3. **Test** — verify the hashrate API URL returns valid JSON and the field path and divisor produce correct numbers.

4. **No frontend changes needed** — the coin registry drives the UI automatically once the coin is in `get_coins()`.
