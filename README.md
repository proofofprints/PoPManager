# PoPManager

Open-source ASIC miner management software by **Proof of Prints**.

Manage and monitor your Iceriver KS0 miners from a single cross-platform desktop application built with Tauri v2, React, and Rust.

## Features

- **Network Scanner** — Auto-discover Iceriver miners on your LAN
- **Live Dashboard** — Hashrate, temperature, fan speed, and pool status at a glance
- **Pool Configuration** — Push pool settings to all miners in one click
- **Adaptive Polling** — 30-60 second intervals to avoid triggering the Iceriver KS0 firmware memory leak

## Supported Hardware

| Model | Status |
|-------|--------|
| Iceriver KS0 | Supported |

## Setup

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- npm

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

The built installer will be in `src-tauri/target/release/bundle/`.

## Architecture

- **Frontend** — React 18 + TypeScript + Tailwind CSS + React Router + Recharts
- **Backend** — Rust (Tauri v2) with async HTTP via `reqwest` and network scanning via `ipnetwork`
- **Miner API** — Iceriver custom HTTP API on port 80 (`GET /user/userpanel?post=4`)

## License

MIT (c) Proof of Prints
