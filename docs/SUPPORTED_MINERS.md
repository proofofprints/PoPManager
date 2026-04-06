# PoPManager Supported Miners

## Fully Supported

### IceRiver (Kaspa / kHeavyHash)
All IceRiver KAS-series miners use the same HTTP REST API and are fully supported for both monitoring and control.

| Model | Algorithm | Hashrate | Power | Features |
|-------|-----------|----------|-------|----------|
| KS0 | kHeavyHash | 100 GH/s | 65W | Monitor + Control |
| KS0 Pro | kHeavyHash | 200 GH/s | 100W | Monitor + Control |
| KS1 | kHeavyHash | 1 TH/s | 600W | Monitor + Control |
| KS2 | kHeavyHash | 2 TH/s | 1200W | Monitor + Control |
| KS3 | kHeavyHash | 8 TH/s | 3200W | Monitor + Control |
| KS3L | kHeavyHash | 5 TH/s | 3200W | Monitor + Control |
| KS3M | kHeavyHash | 6 TH/s | 3400W | Monitor + Control |
| KS5L | kHeavyHash | 12 TH/s | 3400W | Monitor + Control |

**Supported features:**
- Real-time hashrate, temperature, fan speed monitoring
- Pool configuration (view and change)
- Network discovery (auto-scan)
- Model auto-detection

**Connection:** HTTP REST API on port 80

---

## Planned Support

### Whatsminer / MicroBT (Bitcoin / SHA-256)
Coming soon. Official API documentation available.

| Model | Algorithm | Hashrate | Power | Planned Features |
|-------|-----------|----------|-------|-----------------|
| M50S | SHA-256 | 126 TH/s | 3276W | Monitor + Control |
| M56S | SHA-256 | 212 TH/s | 5550W | Monitor + Control |
| M60 | SHA-256 | 186 TH/s | 3420W | Monitor + Control |
| M66 | SHA-256 | 282 TH/s | 5500W | Monitor + Control |

**Connection:** TCP port 4028, JSON protocol

### Bitmain Antminer (Bitcoin / SHA-256)
Coming soon. Read-only monitoring on stock firmware; full control with Braiins OS.

| Model | Algorithm | Hashrate | Power | Planned Features |
|-------|-----------|----------|-------|-----------------|
| S19 | SHA-256 | 95 TH/s | 3250W | Monitor (stock) / Full (Braiins) |
| S19 Pro | SHA-256 | 110 TH/s | 3250W | Monitor (stock) / Full (Braiins) |
| S19 XP | SHA-256 | 140 TH/s | 3010W | Monitor (stock) / Full (Braiins) |
| S21 | SHA-256 | 200 TH/s | 3500W | Monitor (stock) / Full (Braiins) |
| S21 Pro | SHA-256 | 234 TH/s | 3510W | Monitor (stock) / Full (Braiins) |

**Connection:** CGMiner API on TCP port 4028

---

## Adding Support for New Miners

PoPManager's modular architecture makes it straightforward to add support for new miner manufacturers. See [ADD_NEW_COIN.md](ADD_NEW_COIN.md) for adding new cryptocurrency support.

For adding a new miner manufacturer's API, the following is needed:
1. API protocol documentation (HTTP REST, TCP/JSON, gRPC, etc.)
2. Command format for reading: hashrate, temperature, fan speed, pool info, device status
3. Command format for writing: pool configuration, reboot (if available)
4. Model detection method
5. Default wattage per model

Community contributions welcome! If you have a miner model not listed here, please open an issue on GitHub.
