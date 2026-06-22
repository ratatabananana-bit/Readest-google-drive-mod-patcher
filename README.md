# Readest GMod — Readest with your own Google Drive sync

## What this solves

Readest's built-in sync ties you to **their** cloud, with its storage limits. This
mod lets you sync to **your own Google Drive** instead — **15 GB free**, your data,
no Readest account.

Rather than forking Readest, we built a **patcher**: it pulls the latest Readest
code, applies the mod, and produces both a **desktop app** (Windows `.exe`) and an
**Android APK**. We chose a patcher over a fork because:

1. It's **safer and more update-proof** — it builds on top of upstream Readest.
2. There's **no separate fork to keep maintaining**.
3. It's a **more modular** solution.

The result installs **alongside** the official Readest ("Readest GMod", its own
data), so you can keep both.

---

## How to install

Two options:

### 1. Build it yourself with the patcher (most trustworthy)
The patcher pulls the **latest** Readest automatically, so the source never needs
manual updating. Double-click **`tooling/patcher/start-patcher.cmd`** (Windows) — a
page opens at `http://localhost:8787`. Pick a Readest version, click
**Update & Build**, and it produces the `.exe` (and the `.apk` if you have the
Android tools). Tick **Release (smaller)** for optimized files. Requirements + full
steps are below and in [`tooling/README.md`](tooling/README.md).

### 2. Download a prebuilt release
Grab the files from the [**Releases**](../../releases) page:
- **Windows** — `readest.exe` (portable; SmartScreen → More info → Run anyway).
- **Android** — `Readest-GMod.apk` (sideload; allow install from unknown sources).

> ⚠️ **Only use releases you trust.** A prebuilt binary is built by *someone* — if
> you have any doubt about a release, **build your own with the patcher** instead.
> Trust matters here.

---

## Signing in

Readest GMod does **not** use a Readest account. You connect **your own Google
Drive**, and that becomes your sync:

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

## Build requirements

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

By default the patcher ships a working built-in Google client, so Drive sign-in
works out of the box. To use your own, open **"Use my own client"** and paste an
**iOS-type** Google OAuth client ID (no secret, no SHA-1).

---

## How it works (briefly)

One Google "iOS" OAuth client (no secret) authenticates on both Windows and Android
via its reverse-DNS redirect + PKCE — so nothing secret is in the build, and every
user signs into **their own** Google account (their data → their own Drive). Full
technical write-up: [`docs/WINDOWS-OAUTH-SOLUTION.md`](docs/WINDOWS-OAUTH-SOLUTION.md).

## License

A derivative of Readest, licensed **AGPL-3.0** (see [`LICENSE`](LICENSE)).
Readest © its authors — https://github.com/readest/readest.
