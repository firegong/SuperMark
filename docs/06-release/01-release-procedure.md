# Release Procedure

- **Document ID**: `REL-001`
- **Date**: 2026-11-21
- **Status**: v1.0
- **Related documents**: `ARCH-001` §8.1 Release and App Self-Update, `REQ-002` FR-03.7

---

## 1. At a Glance

| Item | Value |
| --- | --- |
| Source repository (private → now public) | `firegong/SuperMark` |
| Release repository | `firegong/SuperMark` — installers and update files are published here |
| Workflow | `.github/workflows/release.yml` (`v*` tag push or manual run) |
| Build targets | Windows (NSIS/MSI installers, single executable), macOS Apple Silicon and Intel (`.app`/`.dmg` each) |
| Update check URL | `https://github.com/firegong/SuperMark/releases/latest/download/latest.json` |
| Signing | minisign. Public key in `src-tauri/tauri.conf.json` `plugins.updater.pubkey`, private key in GitHub Secrets |

```text
v* tag push (firegong/SuperMark)
  └─ release.yml (Windows, macOS Apple Silicon, macOS Intel concurrently — Intel cross-compiled on Apple Silicon runner)
       ├─ yarn build (editor)  →  tauri build (signed installers and update files)
       └─ tauri-action: draft release + latest.json on firegong/SuperMark
Human reviews the draft and publishes
  └─ Installed app: startup / menu "Check for Updates…" → latest.json → signature verify → install & restart
```

---

## 2. Initial Setup (once)

Already done: release repository created (README committed), public key applied, 3 Secrets registered (2026-11-21).

### 2.1 Signing Key

```bash
npx @tauri-apps/cli@2 signer generate -w ~/.tauri/supermark-updater.key -p '<password>'
```

- Creates `~/.tauri/supermark-updater.key` (private key) and `.key.pub` (public key).
- Put the public key file contents into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- **Losing the private key and password means updates can no longer be sent to existing installs.** Store the private key file and password separately in a password manager or other safe place.
- Changing the key (e.g., after loss) means already-installed apps reject updates signed with the new key. The user must manually install a version containing the new public key once.

### 2.2 GitHub Secrets (`firegong/SuperMark` → Settings → Secrets and variables → Actions)

| Name | Content | Registration command |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Private key file contents | `gh secret set TAURI_SIGNING_PRIVATE_KEY -R firegong/SuperMark < ~/.tauri/supermark-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password | `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R firegong/SuperMark` (paste in the prompt) |
| `RELEASES_TOKEN` | (No longer needed after moving to the main repo; the default `GITHUB_TOKEN` is used) | — |

`gh secret set` does not echo input. Verify registration with `gh secret list -R firegong/SuperMark` (values are not shown).

---

## 3. Release Procedure (every time)

### 3.1 Preparation

1. Confirm the code to release is committed to the base branch and tests pass.
   ```bash
   cd packages/core-editor && yarn build && npx jest
   ```
   ```bash
   cd src-tauri && cargo test
   ```
2. Bump the version. **Both locations must match**: `"version"` in `src-tauri/tauri.conf.json`, `version` in `src-tauri/Cargo.toml`.
   - The app only offers an update when the version is **higher** than the installed one (SemVer comparison). Do not reuse or downgrade a version.
   - Check existing tags: `git tag --list 'v*'`
3. Commit the change. Example: `chore: release 0.3.0`

### 3.2 Start the Build

```bash
git tag -a v0.3.0 -m "SuperMark 0.3.0"
```
```bash
git push origin <branch> && git push origin v0.3.0
```

- Tag name must be `v` + the version in the config files. The workflow starts on tag push.
- To rebuild without a tag: GitHub Actions → *Release Build* → **Run workflow** (tag name is `v__VERSION__`, i.e. the version in the config files).
- Check progress: `gh run list -R firegong/SuperMark -L 3`, `gh run watch <run-id> -R firegong/SuperMark`
- Three jobs run concurrently (Windows, macOS aarch64, macOS x86_64). Typical time: 15–25 minutes (Windows is slower).

### 3.3 Review the Draft

When all three jobs succeed, a **draft** release appears on `firegong/SuperMark`.

```bash
gh release view v0.3.0 -R firegong/SuperMark
```

Verify the assets (names are examples; they vary by architecture):

| Asset | Purpose |
| --- | --- |
| `SuperMark_<version>_x64-setup.exe` + `.sig` | Windows installer and signature (also used for updates). Distribute this file |
| `SuperMark_<version>_x64_en-US.msi` + `.sig` | Windows MSI installer (for managed deployment) |
| `SuperMark_<version>_x64_portable.exe` | Windows single executable (no install, see §4.1) |
| `SuperMark_<version>_aarch64.dmg`, `SuperMark_<version>_x64.dmg` | macOS disk images (Apple Silicon, Intel) |
| `SuperMark_aarch64.app.tar.gz`, `SuperMark_x64.app.tar.gz` + `.sig` | macOS update files and signatures (Apple Silicon, Intel) |
| `latest.json` | Update manifest: version, release notes, per-platform URLs and signatures (`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`) |

Edit the release notes if needed. The body is shown verbatim in the app's update dialog (up to 1,200 characters).

### 3.4 Publish

```bash
gh release edit v0.3.0 -R firegong/SuperMark --draft=false --latest
```

Or click **Publish release** on the web release page. Once published, `releases/latest` points to this release and installed apps find the update. Drafts and pre-releases are invisible to the app, so test builds can stay as drafts and be downloaded manually.

### 3.5 Verify

1. Confirm `latest.json` points to the new version.
   ```bash
   curl -sL https://github.com/firegong/SuperMark/releases/latest/download/latest.json
   ```
2. On a PC with the previous version installed: SuperMark → **Check for Updates…** → Yes → install and restart → Check for Updates again to confirm "is the latest version" shows the new version number.
3. Verify on Windows, Apple Silicon Mac, and Intel Mac.

---

## 4. App Update Behavior (reference)

| Situation | Behavior |
| --- | --- |
| Startup (release build, Settings → General → *Check for Updates Automatically*, on by default) | Checks once after 5 seconds. Dialog only when a new version exists |
| Menu *Check for Updates…* | Always reports latest status, errors, or new version |
| Dialog | Yes = download, install, restart; No = later; Cancel = skip this version (`general.skippedUpdateVersion`, re-offered when checked via menu) |
| Unsaved documents | Install is deferred; save is requested first |
| Signature mismatch | Not installed (error is in `logs/markedit.log`) |
| Windows | NSIS installer runs in passive mode (progress window only), app exits and restarts |

### 4.1 Windows Single Executable (portable)

- Runs as `SuperMark_<version>_x64_portable.exe` alone. Editor, fonts, and Mermaid are embedded in the executable.
- Requires the WebView2 runtime on the PC (preinstalled on most Windows 10/11). No Start menu entry or file association.
- Settings and backups share `%APPDATA%\MarkEdit` with the installed version.
- Does not self-update. When a new version is found, Yes = **open the download page**. Replace the file manually.
- Build: the Windows job builds the installers, then rebuilds with `cargo build --release --features "tauri/custom-protocol portable"` and uploads (`portable` feature, `PORTABLE` in `src-tauri/src/updates.rs`).

The update feature has been available since 0.2.0 (the single executable since 0.3.0). Installs older than that must be updated manually once.

---

## 5. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Cannot convert argument to a ByteString because the character at index 6 …` | `RELEASES_TOKEN` contains a non-token value (e.g., a Korean password). Recreate the token and re-register, then `gh run rerun <run-id> --failed -R firegong/SuperMark` |
| `Bad credentials`, `Resource not accessible by personal access token`, 404 | Token expired or insufficient permissions. Recreate with target `SuperMark` and Contents: Read and write, then re-register |
| Signing step fails (`incorrect password`, `failed to decode`) | `TAURI_SIGNING_PRIVATE_KEY`/`…_PASSWORD` do not match the key. Re-register the key file contents and password |
| `Reference does not exist` / tag creation fails | The `main` branch (first commit) is missing in the release repository. Commit a README to create `main` |
| Only the single executable is missing | The last step of the Windows job failed. Check the log, then `gh run rerun <run-id> --failed` (installers are overwritten with `--clobber`) |
| One OS fails | Rerun only the failed job (`gh run rerun <run-id> --failed`). Assets are added to the same draft |
| App says "latest version" only | Release is still a draft or pre-release, or the version was not bumped |
| App rejects the update with a signature error | The private key used for the build and the app's public key differ (key changed). Install a version with the new public key manually |
| Rebuilding the same version | Delete the draft (`gh release delete v0.3.0 -R firegong/SuperMark --cleanup-tag`) and re-push the tag, or run the workflow manually |

Log of a failed job: `gh run view <run-id> -R firegong/SuperMark --log-failed`

EOF