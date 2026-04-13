# Contributing to PoPManager

Thanks for your interest in contributing! PoPManager is an open-source project and we welcome contributions of all kinds — bug reports, feature requests, documentation improvements, and code.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) stable toolchain
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (Windows, with C++ workload)

### Setup

```bash
git clone https://github.com/proofofprints/PoPManager.git
cd PoPManager
npm install
npm run tauri dev
```

This launches the app in development mode with hot-reload for the React frontend.

### Project structure

```
PoPManager/
├── src/                    # React + TypeScript frontend
│   ├── pages/              # Page components (Dashboard, MinerList, etc.)
│   ├── components/         # Reusable UI components
│   ├── context/            # React context providers
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Helper functions
│   └── assets/             # Images, icons, coin logos
├── src-tauri/              # Rust + Tauri backend
│   ├── src/
│   │   ├── lib.rs          # App setup, plugin init, command registration
│   │   ├── http_server.rs  # Axum HTTP server for mobile miner telemetry
│   │   └── commands/       # Tauri command handlers
│   │       ├── miner.rs    # ASIC miner status polling
│   │       ├── mobile_miner.rs  # Mobile miner state + commands
│   │       ├── alerts.rs   # Alert rules + evaluation
│   │       ├── storage.rs  # Saved miner persistence
│   │       ├── pool_profiles.rs # Pool profile CRUD
│   │       └── ...
│   ├── Cargo.toml          # Rust dependencies
│   ├── Cargo.lock          # Pinned dependency versions (committed)
│   └── tauri.conf.json     # Tauri app configuration
├── .github/workflows/      # CI + release automation
├── docs/                   # Screenshots, supplementary docs
├── RELEASING.md            # Release procedure for maintainers
└── LICENSE                 # MIT
```

## How to contribute

### Reporting bugs

[Open an issue](https://github.com/proofofprints/PoPManager/issues/new) with:

- **What happened** — describe the bug clearly
- **What you expected** — what should have happened instead
- **Steps to reproduce** — how to trigger the bug
- **Environment** — OS, PoPManager version (Settings → About), miner model if relevant
- **Logs** — if applicable, attach the log file from Settings → Troubleshooting → Open Log Directory

### Requesting features

[Open an issue](https://github.com/proofofprints/PoPManager/issues/new) describing:

- **What** you'd like to see
- **Why** it would be useful
- **Who** benefits (all users, specific hardware owners, mobile miners, etc.)

### Submitting code

1. **Fork the repo** and create a branch from `main`:
   ```bash
   git checkout -b my-feature
   ```

2. **Make your changes.** Follow the patterns already in the codebase:
   - Rust: Tauri commands in `src-tauri/src/commands/`, registered in `lib.rs`
   - TypeScript: types in `src/types/`, pages in `src/pages/`, shared components in `src/components/`
   - All new struct fields should use `#[serde(default)]` for backward compatibility
   - Use `#[serde(rename_all = "camelCase")]` on all structs that cross the Rust ↔ TypeScript boundary
   - Match the existing Tailwind CSS class patterns for UI consistency

3. **Verify your changes compile:**
   ```bash
   npx tsc --noEmit          # TypeScript
   cd src-tauri && cargo check  # Rust
   ```
   Both must pass with no errors.

4. **Commit with a clear message:**
   ```
   feat: add support for Goldshell miners
   fix: alert not firing when miner goes offline
   docs: update README with new pool management screenshots
   ```
   Use the [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` — new feature
   - `fix:` — bug fix
   - `docs:` — documentation only
   - `chore:` — maintenance, dependencies, tooling
   - `refactor:` — code restructure without behavior change

5. **Open a pull request** against `main` with:
   - A clear title and description of what changed and why
   - Confirmation that `tsc --noEmit` and `cargo check` pass
   - Screenshots if the change is visual

## Adding support for a new miner

This is the most common contribution type. To add support for a new miner manufacturer:

1. **Create a new command module** at `src-tauri/src/commands/<manufacturer>.rs`
2. **Implement the status polling** — study an existing module like `miner.rs` (Iceriver) or `antminer.rs` for the pattern
3. **Add manufacturer detection** in the network scanner (`scan.rs`)
4. **Register the module** in `src-tauri/src/commands/mod.rs`
5. **Document the API** — open an issue with your miner's HTTP API details so others can review

If you don't have the Rust experience but do have access to a miner model we don't support, just opening an issue with the miner's web API documentation (endpoints, response formats) is a huge help. We can implement the integration from the API docs.

## Adding support for a new coin

See [docs/ADD_NEW_COIN.md](docs/ADD_NEW_COIN.md) for the step-by-step guide. The short version:

1. Add the coin config via Settings → Coin Management (or directly in `coins.json`)
2. Drop the coin icon into `src/assets/coins/<coinid>.png`
3. Add the icon import to `src/utils/coinIcon.ts`
4. If the coin uses a non-standard pool URL pattern, update `src/utils/coinLookup.ts`

## Code style

- **Rust:** standard `rustfmt` formatting. No clippy warnings on the files you change.
- **TypeScript/React:** functional components, hooks, no class components. Tailwind CSS for styling — match the existing dark theme palette (`bg-dark-800`, `border-slate-700/50`, `text-primary-400`, etc.).
- **No emojis in code or UI** unless explicitly in user-facing branding.
- **Log levels:** `error` for failures that need attention, `warn` for recoverable issues, `info` for significant events (server start, device registration), `debug` for per-poll / high-frequency events.

## What we're not looking for

To set expectations — these are currently out of scope:

- **UI framework changes** (switching away from React, Tailwind, or Recharts)
- **Database migration** (the JSON file storage is intentional for simplicity)
- **Multi-user / authentication** (PoPManager is a single-user desktop app)
- **Cloud hosting / SaaS features** (this is a local-first tool)

## Questions?

- Open a [GitHub Discussion](https://github.com/proofofprints/PoPManager/discussions) or issue
- Email: [support@proofofprints.com](mailto:support@proofofprints.com)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
