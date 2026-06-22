# Readest GMod — Readest with your own Google Drive sync

A mod of [Readest](https://github.com/readest/readest) that replaces its built-in
cloud sync with **your own Google Drive** — no Readest account needed. Your books,
reading position, highlights, and reading stats sync across your devices through a
private app folder in *your* Google Drive.

Works on **Windows** and **Android**, and installs **alongside** the official
Readest (its own name "Readest GMod", its own data), so you can keep both.

---

## Download & use (no building)

Grab the latest files from the [**Releases**](../../releases) page:

- **Windows** — `readest.exe` (portable, just run it).
  SmartScreen will warn "unknown publisher" because the app isn't code-signed →
  click **More info → Run anyway**. (Normal for indie apps.)
- **Android** — `Readest-GMod.apk` (sideload it; allow **install from unknown
  sources** for your browser/file app when prompted).

### Signing in — this is the important part

Readest GMod does **not** use a Readest account. Instead you connect **your own
Google Drive**, and that becomes your sync:

1. Open the app.
2. Go to **Settings → Integrations → Cloud Sync (Google Drive)**.
3. Tap **Connect Google Drive** and sign in with your Google account.
   - The first time, Google may show "Google hasn't verified this app" → tap
     **Advanced → Continue**. It only asks for access to its own folder in your
     Drive, nothing else.
4. Done. **Connecting Google Drive replaces the normal Readest sign-in** — the
   account area now shows "Connected to Google Drive", and your library, reading
   position, highlights, and stats sync to your own Drive.

Sign in with the **same Google account on every device** and they sync to each
other. Your data lives in your Drive, so a fresh install just re-downloads it.

---

## Build it yourself (optional)

This repo is also a **patcher**: it clones Readest, applies the mod, and builds the
apps on your machine — so you can build from any Readest version, or use your own
Google client instead of the bundled default.

Double-click **`tooling/patcher/start-patcher.cmd`** (Windows) — it opens a page at
`http://localhost:8787`. Pick a Readest version, click **Update & Build**, and it
produces the Windows `.exe` (and the Android `.apk` if you have the Android tools).
Tick **Release (smaller)** for optimized, much smaller files.

It ships with a working built-in Google client, so Drive sign-in works out of the
box. To use your own, open **"Use my own client"** and paste an **iOS-type** Google
OAuth client ID (no secret, no SHA-1).

### Requirements (to build)

The patcher builds a Tauri (Rust + web) app from source, so it needs a build
toolchain — install these yourself:

| Tool | Why |
|------|-----|
| **Node.js 20+** | runs the patcher + builds the web frontend |
| **pnpm 9** | installs JS dependencies (`npm i -g pnpm` or `corepack enable`) |
| **git** | clones Readest + its submodules |
| **Rust + Cargo** (rustup) | compiles the native app |
| **C/C++ build tools** | the Rust linker. Windows: **Visual Studio Build Tools** (MSVC) |
| *(Android only)* **Android SDK + NDK, JDK 17**, the `aarch64-linux-android` Rust target, Windows Developer Mode | builds the `.apk` |

**Disk space:** plan for **~8–15 GB** — the toolchain (~1–3 GB) plus, inside
`work/`, the Readest clone + `node_modules` + the Rust build cache (`target/`,
~5–10 GB). Deleting `work/` reclaims the build space. Full build details + the
Android toolchain setup: [`tooling/README.md`](tooling/README.md).

---

## How it works (briefly)

One Google "iOS" OAuth client (no secret) authenticates on both Windows and Android
via its reverse-DNS redirect + PKCE — so nothing secret is in the build, and every
user signs into **their own** Google account (their data → their own Drive). Full
technical write-up: [`docs/WINDOWS-OAUTH-SOLUTION.md`](docs/WINDOWS-OAUTH-SOLUTION.md).

## License

A derivative of Readest, licensed **AGPL-3.0** (see [`LICENSE`](LICENSE)).
Readest © its authors — https://github.com/readest/readest.
