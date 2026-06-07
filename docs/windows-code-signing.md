# Windows Code Signing — build-out plan (deferred)

**Status:** Not started — deferred until revenue justifies the annual cost.
**Goal:** Eliminate the Windows SmartScreen "unknown publisher / Run anyway"
warning on the OverManager installer by Authenticode-signing the `.exe`/`.msi`
with a trusted certificate.

> **Revisit trigger:** when recurring revenue comfortably covers ~$120–$700/yr
> (see cost table). Until then, the SmartScreen "More info → Run anyway" note in
> the release body is the accepted workaround.

---

## ⚠️ Don't confuse this with the signing we already have

OverManager already does **updater signing** and it must NOT be touched as part
of this work:

- **Updater signing (minisign) — DONE.** `TAURI_SIGNING_PRIVATE_KEY` (+ password)
  in `.github/workflows/release.yml`, public key embedded at
  `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`. Produces the `.sig`
  files and signs `latest.json` so the in-app auto-updater can verify releases.
  This is **not** Authenticode and does **nothing** for SmartScreen.
- **Authenticode code signing — THIS DOC.** Separate cert, separate config under
  `bundle.windows`, separate CI secrets. This is the only thing that clears
  SmartScreen.

---

## Why it's more involved than it used to be

Since **June 1, 2023**, the CA/Browser Forum requires the private keys for OV and
EV code-signing certs to live on FIPS 140-2 Level 2 / CC EAL4+ hardware. You can
**no longer download a plain `.pfx`** and hand it to CI. The realistic options
are a physical USB token (awkward for CI) or a **cloud HSM signing service** that
keeps the key in hardware and signs via an API/CLI (works in CI).

---

## Options (pick one)

### 1. Azure Trusted Signing — recommended if eligible
- **Cost:** ~$10/month (~$120/yr). Cheapest credible option.
- Microsoft-managed signing service; key stays in Azure HSM. No physical token.
- Gives SmartScreen reputation as a Microsoft-vouched signer.
- **Eligibility:** identity validation. Organizations generally need ~3+ years of
  verifiable business history for the public-trust org identity; an individual
  developer validation path also exists. **Confirm current eligibility before
  banking on this** — if OverBuild Labs is too new, fall back to option 2.
- CI: `azure/trusted-signing-action` GitHub Action, or `signtool` + the
  Azure.CodeSigning dlib.

### 2. OV certificate via a cloud-HSM signing service (DigiCert KeyLocker, SSL.com eSigner, etc.)
- **Cost:** ~$200–$400/yr for the cert + the service.
- Works in CI (no physical token) — sign via the provider's CLI/API.
- **SmartScreen reputation builds over time / download volume** — early downloads
  may still warn until reputation accrues.

### 3. EV certificate (with token or cloud HSM)
- **Cost:** ~$300–$700/yr.
- **Immediate** SmartScreen reputation (no warm-up period).
- Hardware token by default; choose a cloud-HSM/eSigner variant to sign in CI.

### Not an option
- **Self-signed cert:** does nothing for SmartScreen on other machines. Skip.

| Option | ~Annual cost | CI-friendly | SmartScreen | Notes |
|---|---|---|---|---|
| Azure Trusted Signing | ~$120 | ✅ | reputation (MS-vouched) | Cheapest; eligibility gated |
| OV + cloud HSM | ~$200–400 | ✅ | builds over time | Most common middle ground |
| EV + cloud HSM | ~$300–700 | ✅ | immediate | Best UX, priciest |

---

## Implementation steps (once a cert/service is chosen)

1. **Acquire & validate** the cert / Trusted Signing account (identity validation
   can take days to weeks — start early).
2. **Tauri config** — add to `src-tauri/tauri.conf.json` under `bundle.windows`:
   - For a cloud-HSM/Trusted-Signing flow, set a **`signCommand`** that invokes the
     provider's signer (e.g. `signtool` with the Trusted Signing dlib, or the
     eSigner CLI) against each produced artifact.
   - For a cert in the build machine's store, set **`certificateThumbprint`**.
   - Also set `digestAlgorithm: "sha256"` and a `timestampUrl` (RFC-3161, e.g. the
     provider's timestamp endpoint) so signatures stay valid after the cert expires.
3. **CI secrets** — add the provider credentials (Azure client id/secret/tenant +
   account/profile, or the eSigner/KeyLocker creds) to the repo's GitHub secrets.
4. **CI workflow** — in `.github/workflows/release.yml`, install the signing tool
   and ensure `tauri build` (via `tauri-action`) picks up the `signCommand`. Run
   only on the Windows matrix leg.
5. **Verify** — on the signed installer:
   `signtool verify /pa /v OverManager_x.y.z_x64-setup.exe`
   and confirm the digital signature + timestamp in the file's Properties →
   Digital Signatures tab. Test a fresh download on a clean machine to confirm
   SmartScreen no longer warns (EV) or warns less over time (OV).
6. **Release notes** — remove the SmartScreen "Run anyway" note from
   `release.yml` `releaseBody` once signing is confirmed.

---

## Checklist

- [ ] Decide option (Azure Trusted Signing vs OV vs EV) + confirm eligibility/cost
- [ ] Purchase cert / set up signing account; complete identity validation
- [ ] Add `signCommand`/`certificateThumbprint` + `digestAlgorithm` + `timestampUrl` to `tauri.conf.json`
- [ ] Add signing credentials to GitHub repo secrets
- [ ] Wire signing into the Windows leg of `release.yml`
- [ ] Verify with `signtool verify /pa /v` + clean-machine SmartScreen test
- [ ] Drop the SmartScreen note from the release body
- [ ] (Optional) Sign the `.msi` as well as the NSIS `.exe` if both are shipped

---

*Prices and CA/B Forum requirements are approximate and change over time — verify
current provider offerings and rules when this is picked up.*
