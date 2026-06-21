# Mod build pipeline — "the patcher"

This whole `readest-gdrive-sync-mod` folder is the product. Someone downloads
just this folder and runs the patcher; it **clones Readest into the folder,
overlays the Drive-sync mod, and builds** — nothing pre-existing required.

It is a *source-overlay* pipeline, **not** a ReVanced-style binary patcher (that's
Android-only, patches compiled APKs, and suits small tweaks; our change is a whole
sync subsystem and Readest is open source, so we rebuild from source instead).

## Use it (browser, no terminal)

**Double-click `tooling/patcher/start-patcher.cmd`** (Windows; `start-patcher.sh`
on macOS/Linux). It opens `http://localhost:8787`:

- **status** — which Readest version is currently built, which version the mod
  targets, and the latest Readest release.
- **Check (dry run)** — clones Readest (first run only) and reports whether the mod
  still applies to the chosen version. Safe, changes nothing you'd keep.
- **Update & Build** — clones (first run), overlays the mod onto the chosen version,
  and builds the app, with a **live log**. Locale-only clashes auto-resolve; a code
  clash stops with the exact file named (share the log).
- **Build current only** — rebuild what's already set up in `work/`.

First run downloads Readest + builds Rust, so it's slow; later runs reuse `work/`.

### Google Drive sign-in (works out of the box)

The build **ships with a working default Google client** (`tooling/mod/default-client-id.txt`,
a non-secret client id), so Drive sign-in works with **zero setup** — every user
signs into their OWN Google account (their data → their own Drive). To use your own
client instead, open the patcher's **"Use my own client"** override and paste an
**iOS-type** OAuth client ID (Google Cloud Console → Credentials → OAuth client ID →
Application type: **iOS**; Bundle ID e.g. `com.readestgmod.app`). **No client secret,
no SHA-1** — the reverse-DNS redirect + PKCE are the authentication, and the SAME one
client serves Windows AND Android. The override is written to
`tooling/mod/credentials.env` (gitignored, never uploaded); the patcher derives the
app's reverse-DNS deep-link scheme from whichever client id is used.

Requirements (the patcher can't bundle these): **Node, pnpm, Rust/cargo, git**.
Self-contained means *no pre-existing Readest checkout* — not "no toolchain".
For the **Android APK** also: **Android SDK + NDK**, **JDK 17** (`JAVA_HOME` set), the
Rust target `aarch64-linux-android` (`rustup target add aarch64-linux-android`),
Windows **Developer Mode** (for symlinks), and a one-time empty NDK stub
`libadvapi32.a` in the NDK's `…/sysroot/usr/lib/aarch64-linux-android/<minSdk>/`.
Without the Android toolchain the patcher still builds the Windows exe and just skips
the APK.

## How it works

```
readest-gdrive-sync-mod/
  tooling/
    patcher/        server.mjs (Node, zero deps) + pipeline.mjs + index.html + launchers
    mod/
      mod.patch     the entire mod as one portable overlay (git diff base..mod)
      base-tag.txt  the Readest tag the overlay is cut against (e.g. v0.11.12)
  work/readest/     Readest is CLONED here on first run (git-ignored, ~hundreds of MB)
```

`pipeline.mjs` (driven by the browser, but it's plain Node — no bash): clone Readest
→ `git checkout <base-tag>` → `git apply mod.patch` → commit → `git rebase <chosen
version>` (3-way; auto-resolves locale clashes, reports code clashes) → submodules →
vendoring → inject the Google client id + reverse-DNS scheme + app icon → `next build`
→ `tauri build` (Windows exe) → `tauri android build` (APK, if the Android toolchain
is present).

## Developer layer (editing the mod itself)

The mod is developed in a full Readest fork at `../../readest-src` on branch
`cloud-sync-mod` (one squashed commit on the base tag). After changing the mod
there, **regenerate the overlay** so the patcher ships the update:

```
git -C ../../readest-src diff "$(cat mod/base-tag.txt)" cloud-sync-mod > mod/mod.patch
```

The `*.sh` scripts here (`build-mod.sh`, `update-to-version.sh`, `check-version.sh`)
are optional developer/CLI helpers that operate on that `readest-src` fork directly;
end users never need them — the browser patcher is self-contained.

## Cloud auto-build (GitHub Actions)

`ci/build-mod.yml` is a starter workflow (build the fork in CI, upload the app).
To go fully hands-off it would clone + overlay like `pipeline.mjs`; wire it after
pushing to GitHub and adding `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` secrets.

## Android (APK) — built by the pipeline

The pipeline builds the **debug-signed APK** alongside the exe →
`work/output/Readest-GMod.apk`. It does a fresh `tauri android init` (so the Android
package matches the `Readest GMod` identifier), re-applies the hard-won post-init
fixes (Windows pnpm `cmd /c` wrapper, adaptive-icon color, FOSS build flavor), cleans
the tauri mobile template cache, then `tauri android build --debug --apk`. The
reverse-DNS OAuth scheme is injected into the Android manifest the same way as
desktop (derived from the client id) — no separate Android client and **no SHA-1**.

Debug-signed is fine to ship for a sideloaded, cloud-synced app (a clean reinstall
re-pulls everything from Drive) — see [`docs/RELEASE-SIGNING.md`](../docs/RELEASE-SIGNING.md).
Needs the Android toolchain listed under Requirements; without it the APK step is
skipped and only the Windows exe is built.
