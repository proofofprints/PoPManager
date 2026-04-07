# PoPManager

**Open-source, cross-platform ASIC miner management software**

Built by [Proof of Prints](https://proofofprints.com) | [Support: support@proofofprints.com](mailto:support@proofofprints.com)

## Overview
PoPManager is a free, open-source desktop application for monitoring and managing your ASIC mining operation. Built with Tauri (Rust + React), it runs on Windows, Linux, and macOS without requiring a dedicated mining OS. Monitor hashrates, temperatures, profitability, and manage pool configurations — all from one dashboard.

## Screenshots

![Dashboard Overview](docs/screenshots/Dashboard.png)

## Features

### Multi-Manufacturer Support
- **IceRiver** — Full monitoring and control (KS0, KS0 Pro, KS1, KS2, KS3, KS5)
- **Whatsminer/MicroBT** — Monitoring support (M50, M56, M60, M66 series)
- **Bitmain Antminer** — Read-only monitoring on stock firmware (S19, S21 series)
- Auto-detection of miner manufacturer during network scanning

### Multi-Coin Support
- Built-in support for **Kaspa (KAS)** and **Bitcoin (BTC)**
- Modular coin registry — easily add new cryptocurrencies
- Per-coin profitability calculations using live market data

### Dashboard
- Farm-level overview with total profitability (gross, power costs, net profit)
- Per-coin earnings breakdown
- Fleet hashrate chart with historical data (1h to 30 days)
- Real-time miner status across your entire operation

### Miner Management
- Network scanner with auto-discovery across all supported manufacturers
- Card and data grid views with search, sort, and filter
- Per-miner detail pages with hashrate charts, board temps, fan speeds
- Bulk pool configuration — apply pool profiles to multiple miners at once
- Open miner web UI directly from the app

![Miners Grid View](docs/screenshots/Miner%20Page%20Grid.png)
![Miners Card View](docs/screenshots/Miner%20Page%20Card.png)
![Miner Detail](docs/screenshots/Miner%20Detail.png)

### Profitability Tracking
- Live coin prices via CoinGecko (12+ fiat currencies supported)
- Electricity cost calculation with per-model wattage
- Pool fee configuration (per-pool or global default)
- Daily/monthly gross, power cost, and net profit estimates

### Alerts & Notifications
- Configurable alert rules: hashrate drop, high temperature, miner offline, no shares submitted
- Desktop notifications (branded PoPManager alerts on Windows)
- Email alerts via SMTP (SendGrid, Gmail, or any SMTP provider)
- Alert history with acknowledge/dismiss workflow
- Default alert rules created automatically on first launch

![Alert Desktop Notification](docs/screenshots/Alert%20Desktop%20Notification.png)
![Alert Page](docs/screenshots/Alert%20Screen.png)

### Pool Management
- Saved pool profiles with per-pool fee percentages
- Coin association via pool profiles
- View which miners are on each pool
- Bulk apply pool configurations

### Data & Export
- CSV export: miner list, alert history, profitability reports, farm history
- Uptime tracking (24h/7d/30d per miner and fleet-wide)
- Historical farm data with auto-pruning (7-day retention)
- Troubleshooting logs with configurable log levels

### Desktop Integration
- System tray mode — minimize to tray for background monitoring
- Auto-update support via GitHub Releases
- Native Windows notifications

![System Tray Icon](docs/screenshots/Systray%20icon.png)

## Installation

### Windows
1. Download the latest `.msi` installer from [Releases](https://github.com/proofofprints/PoPManager/releases)
2. Run the installer and follow the prompts
3. Launch PoPManager from the Start Menu

### Building from Source
Prerequisites:
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable toolchain)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (Windows, with C++ workload)

```bash
git clone https://github.com/proofofprints/PoPManager.git
cd PoPManager
npm install
npm run tauri dev
```

To create a production build:
```bash
npm run tauri build
```

## Quick Start

1. **Launch PoPManager** and navigate to the **Monitoring** tab
2. Click **Scan Network** — PoPManager will automatically find miners on your local network
3. Select discovered miners and click **Add to Monitored**
4. Go to **Pools** to create a pool profile with your pool address and wallet
5. Apply the pool profile to your miners
6. Check the **Dashboard** for your farm overview and profitability estimates

## Adding New Coins

PoPManager is designed to be modular. See [docs/ADD_NEW_COIN.md](docs/ADD_NEW_COIN.md) for instructions on adding support for new cryptocurrencies.

## Supported Miners

See [docs/SUPPORTED_MINERS.md](docs/SUPPORTED_MINERS.md) for the full list of supported miner models and features.

## Configuration

All configuration is stored locally in your app data directory:
- **Windows:** `%APPDATA%/com.proofofprints.popmanager/`
- **Linux:** `~/.config/com.proofofprints.popmanager/`
- **macOS:** `~/Library/Application Support/com.proofofprints.popmanager/`

## Disclaimer

Profitability estimates are calculated based on current network difficulty, block rewards, coin prices, and configured pool fees. Actual earnings may vary due to pool luck, network difficulty changes, miner uptime, hardware efficiency, and market volatility. These figures are estimates only and should not be considered financial advice.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! If you have a miner model not currently supported, please open an issue with your miner's API details. See [docs/SUPPORTED_MINERS.md](docs/SUPPORTED_MINERS.md) for guidance.

## Contact

- **Website:** [proofofprints.com](https://proofofprints.com)
- **Email:** [support@proofofprints.com](mailto:support@proofofprints.com)
- **GitHub:** [github.com/proofofprints/PoPManager](https://github.com/proofofprints/PoPManager)
