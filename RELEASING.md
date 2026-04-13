# Releasing PoPManager

Step-by-step guide for cutting a new release.

## Prerequisites

- Push access to `main` on [github.com/proofofprints/PoPManager](https://github.com/proofofprints/PoPManager)
- The following GitHub Actions secrets must be set (Settings → Secrets and variables → Actions):
  - `TAURI_SIGNING_PRIVATE_KEY` — Tauri updater signing private key (base64 string from `popmanager.key`)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password for the signing key
- Tag ruleset allows you to create `v*` tags (you may need bypass permissions)

## Release process

### 1. Bump the version number

Update the version in all three manifest files to match the new version:

| File | Field |
|---|---|
| `src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` |
| `package.json` | `"version": "X.Y.Z"` |
| `src-tauri/Cargo.toml` | `version = "X.Y.Z"` |

Commit and push to `main` (via PR or direct push):

```bash
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml
git commit -m "release: bump version to X.Y.Z"
git push origin main
```

### 2. Verify builds pass locally

```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

### 3. Tag and push

```bash
git checkout main
git pull
git tag vX.Y.Z
git push --tags
```

This triggers the `release.yml` GitHub Actions workflow, which:
- Builds on 4 platforms in parallel (Windows, macOS ARM, macOS Intel, Linux)
- Signs all updater artifacts with the Tauri signing key
- Creates a **draft** GitHub release with all installers + `latest.json` attached

### 4. Wait for CI (~15 minutes)

Monitor progress at: https://github.com/proofofprints/PoPManager/actions

All 4 jobs must pass:
- `build (windows-latest, x86_64-pc-windows-msvc)` → `.msi`, `.exe`
- `build (macos-latest, aarch64-apple-darwin)` → `.dmg` (Apple Silicon)
- `build (macos-latest, x86_64-apple-darwin)` → `.dmg` (Intel)
- `build (ubuntu-22.04, x86_64-unknown-linux-gnu)` → `.deb`, `.AppImage`, `.rpm`

### 5. Review and publish the release

1. Go to [Releases](https://github.com/proofofprints/PoPManager/releases)
2. Find the draft release titled "PoPManager vX.Y.Z"
3. Verify the expected assets are attached:
   - Installers for all platforms
   - `.sig` signature files for each installer
   - `latest.json` (updater manifest)
4. Edit the release notes if needed
5. Click **Publish release**

### 6. Verify the updater

Open PoPManager (running the previous version) → Settings → Check for Updates. It should show the new version as available.

## Troubleshooting

### Build fails with "Wrong password for that key"

The `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secret doesn't match the key. Edit the secret and retype the exact password.

### Build fails with "Base64 conversion failed - was an actual public key given?"

The `pubkey` field in `tauri.conf.json` contains the wrong value. It must be the **public** key (from `popmanager.key.pub`), not the private key. The public key decodes to text starting with "minisign public key". The private key decodes to "rsign encrypted secret key" — if you see that, you have them swapped.

### Build fails with "Signature not found for the updater JSON. Skipping upload..."

The `bundle.createUpdaterArtifacts` field is missing from `tauri.conf.json`. It must be set to `"v1Compatible"` (or `true` for Tauri v3+).

### Build fails with "cannot find type IMarshal" (macOS/Linux only)

A Windows-only crate is being compiled on non-Windows platforms. Check that `tauri-winrt-notification` is under `[target.'cfg(windows)'.dependencies]` in `Cargo.toml`, not under general `[dependencies]`.

### Build fails with "Resource not accessible by integration"

The workflow lacks permission to create releases. Ensure `release.yml` has `permissions: contents: write` at the top level.

### Tag push rejected by ruleset

Your tag ruleset restricts creation. Either add yourself to the bypass list in Settings → Rules → Rulesets, or temporarily disable the tag ruleset for the push.

### "Could not fetch a valid release JSON" in the app updater

The `latest.json` file doesn't exist at the expected URL. This happens when:
- The release hasn't been published yet (still in draft)
- The repo is private (unauthenticated downloads return 404)
- The signing step was skipped so `latest.json` wasn't generated

## Signing key management

The signing keypair lives at:
- **Private key:** `L:\PoPManager\~\.tauri\popmanager.key` (also stored as `TAURI_SIGNING_PRIVATE_KEY` GitHub secret)
- **Public key:** `L:\PoPManager\~\.tauri\popmanager.key.pub` (also in `tauri.conf.json` → `plugins.updater.pubkey`)

### Regenerating the keypair

If you lose the private key or need to rotate:

```bash
npx @tauri-apps/cli signer generate -w "L:\PoPManager\~\.tauri\popmanager.key" --force
```

Then update:
1. `tauri.conf.json` → `plugins.updater.pubkey` with the new **public** key
2. GitHub secret `TAURI_SIGNING_PRIVATE_KEY` with the new **private** key file contents
3. GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` with the new password

**Warning:** Rotating the keypair means installed copies running the old public key cannot verify updates signed with the new key. Users will need to manually download the new version from the Releases page. Only rotate if necessary.

## CI workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `.github/workflows/release.yml` | Push `v*` tag | Cross-platform release builds |
| `.github/workflows/ci.yml` | PR to `main` | TypeScript + Rust checks |

## Version numbering

PoPManager follows [Semantic Versioning](https://semver.org/):
- **Major** (X.0.0) — breaking changes or major feature overhauls
- **Minor** (0.X.0) — new features, backward compatible
- **Patch** (0.0.X) — bug fixes, minor polish
