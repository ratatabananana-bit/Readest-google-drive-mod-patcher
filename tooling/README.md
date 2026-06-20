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

### Google Drive credentials (entered in the GUI)

The page has a **Google Drive credentials** card: paste your own **Client ID +
Client Secret** (a Desktop-type OAuth client from
console.cloud.google.com → Credentials) and click **Save**. They're written to
`tooling/mod/credentials.env` (gitignored, never uploaded) and baked into the
build so "Connect Google Drive" works. No creds → the app still builds, but Drive
sign-in is disabled. Each builder uses their own client; users still sign into
their own Google account (their data → their own Drive). See
`tooling/mod/credentials.env.example` for the format.

Requirements (the patcher can't bundle these): **Node, pnpm, Rust/cargo, git**.
Self-contained means *no pre-existing Readest checkout* — not "no toolchain".

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
vendoring → `next build` → `tauri build`.

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

## Android (APK) — not buildable yet

Same pipeline, `tauri android build`, but blocked on one-time setup that isn't code:
an **Android** Google OAuth client (package + SHA-1), the `readest://oauth` deep link
in the Android manifest, an Android **signing keystore**, and `tauri android init`.
