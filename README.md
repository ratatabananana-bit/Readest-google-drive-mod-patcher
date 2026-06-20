# Readest Drive-Sync Mod (the Patcher)

A mod for [Readest](https://github.com/readest/readest) that replaces its built-in
cloud sync with **your own Google Drive** — fully standalone, no Readest account.
Your books, reading position, highlights, and stats sync across your devices
through a private folder in *your* Drive.

This repo is **the patcher**, not a prebuilt app. You download it, point it at a
Readest version, and it clones Readest, applies the mod, and builds the app on
your machine. (We don't ship prebuilt releases because a build would bake in
*someone's* Google API credentials — instead, each builder enters their own.)

## Use it

1. Install the [requirements](#requirements) below.
2. Double-click **`tooling/patcher/start-patcher.cmd`** (Windows) or run
   `tooling/patcher/start-patcher.sh` (macOS/Linux). A page opens at
   `http://localhost:8787`.
3. In the **Google Drive credentials** card, paste your own **Client ID + Secret**
   (see [Google credentials](#google-credentials)) and click **Save**.
4. Pick a Readest version and click **Update & Build**. Watch the live log.
5. When done, the app is at `work/readest/target/debug/readest.exe`.

First build is slow (downloads Readest + compiles Rust). Later builds reuse `work/`.

## Requirements

The patcher builds a Tauri (Rust + web) app from source, so it needs a build
toolchain. **You must install these yourself for now** (auto-install is planned):

| Tool | Why | Approx size |
|------|-----|-------------|
| **Node.js 20+** | runs the patcher + builds the web frontend | ~100 MB |
| **pnpm 9** | installs JS dependencies (`npm i -g pnpm` or `corepack enable`) | ~10 MB |
| **git** | clones Readest + its submodules | ~50–250 MB |
| **Rust + Cargo** (rustup) | compiles the native app | ~1 GB |
| **C/C++ build tools** | the Rust *linker*. Windows: **Visual Studio Build Tools** (MSVC). macOS: Xcode CLT. Linux: build-essential | **Windows: ~2–7 GB** |

### ⚠️ Disk space — read this

This is **not** a small download. Plan for it:

- **Toolchain (Rust + C++ build tools): ~1–3 GB**, mostly the Windows C++ build tools.
- **Per build, inside `work/`:** Readest clone (~300 MB) + JS `node_modules`
  (~1 GB) + Rust build cache (`target/`, **~5–10 GB**).
- **Total realistic footprint: 8–15 GB.** Make sure you have the room before
  building. Deleting `work/` reclaims all the build space; the toolchain stays.

## Google credentials

Each builder uses their **own** Google OAuth client — nothing is shipped in this
repo (`credentials.env` is gitignored). Create one at
[console.cloud.google.com](https://console.cloud.google.com) → APIs & Services →
Credentials → **Create credentials → OAuth client ID → Desktop app**, then paste
the Client ID + Secret into the patcher's credentials card.

End users still sign in with **their own** Google account, so everyone's data goes
to **their own** Drive. To let accounts beyond your test list sign in, publish the
OAuth consent screen to *Production* (an "unverified app" warning shows until
Google verifies it). See `tooling/mod/credentials.env.example`.

## Layout

```
tooling/patcher/   the patcher (Node server + browser UI) — start here
tooling/mod/       the mod as one portable patch (mod.patch) + base tag
docs/              design, plan, session handoff
work/              Readest is cloned + built here (git-ignored, large)
```

Full pipeline details: `tooling/README.md`.

## License

This mod is a derivative of Readest and is licensed under **AGPL-3.0** (see
`LICENSE`). Readest © its authors — https://github.com/readest/readest.
