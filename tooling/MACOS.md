# Build Readest GMod on macOS

This builds the existing Drive-sync mod as a macOS application. Its name and
identifier remain **Readest GMod** / `com.readestgmod.app`, so it can be installed
beside Readest. It uses the project's existing icon and bundled Google client.
No Apple developer account or private credentials are included.

## Prerequisites

- Apple Command Line Tools (`xcode-select --install`). The tested Apple Silicon
  build did not need a full Xcode installation.
- Node.js, pnpm matching Readest's checked-in `packageManager`, Git, Rust/Cargo.
  Initialize Rust with `rustup` and ensure `cargo` is on `PATH`.
- Several GB of free space for dependencies and build caches.

Use versions compatible with the selected Readest release. The working v0.12.8
build used Node 26, pnpm 11, Rust 1.99.1 and macOS on Apple Silicon. Intel/Universal
builds and Windows rebuilds of this contribution have not been validated.

## Build

From the patcher repository root:

```sh
node tooling/patcher/run-build-now.mjs v0.12.8 --release
```

Omit the version argument to use `tooling/mod/base-tag.txt`. `--release` is optional;
without it the pipeline builds a debug app. The browser launcher
`tooling/patcher/start-patcher.sh` uses the same pipeline.

The update flow resets the patcher's own `work/readest` checkout and applies the
mod. Save any manual edits there before updating. Repeated builds reuse the
installed dependencies and Cargo cache.

Output: `work/output/Readest GMod.app`. To omit Android on a Mac with an SDK:

```sh
PATCHER_SKIP_ANDROID=1 node tooling/patcher/run-build-now.mjs v0.12.8 --release
```

The bundle is **ad-hoc signed**, not Developer ID signed or Apple-notarized.
Signing and provisioning options belonging to official Readest are not reused.
Verify it with:

```sh
codesign --verify --deep --strict 'work/output/Readest GMod.app'
```

Quit any running GMod instance, copy the app to Applications, and open it. Keep
`Readest.app` and its data; do not overwrite the official installation.

A new ad-hoc build may prompt for access to **Readest GMod Safe Storage** in the
login keychain. The user must enter their own keychain password and may choose
**Always Allow** for this app. One-time approval can produce repeated prompts.
Do not delete the stored token as a workaround. This source-build path does not
provide stable Developer ID signing that would avoid repeated trust decisions.

## Optional Android APK from the same Mac

Install a JDK and Android SDK/NDK compatible with the selected Readest release,
and add the Rust target:

```sh
rustup target add aarch64-linux-android
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/path/to/your/jdk/Contents/Home"
export NDK_HOME="$ANDROID_HOME/ndk/<installed-version>"
```

Explicit `ANDROID_HOME` / `ANDROID_SDK_ROOT` override the default SDK location.
If NDK_HOME is unset, the pipeline chooses the newest installed NDK under the SDK.
With the SDK installed, the regular build command also produces
`work/output/Readest-GMod.apk` (ARM64). Without it, the desktop build still succeeds.
The Gradle task uses pnpm directly on macOS; `cmd /c` is Windows-only.

APK release builds currently use the existing debug-signing configuration.
Preserve the builder's `~/.android/debug.keystore` to install future builds as
updates to the same app; do not publish that private key. Device pairing and
installation remain separate from this build pipeline.

## Tests and scope

```sh
node --test tooling/patcher/*.test.mjs
```

These tests cover host-specific SDK paths, Gradle command rewriting, desktop
bundle options, themed-icon preservation and installation isolation. The supplementary native-menu patch
includes frontend regression tests for action delivery and resource lifetime.
During development, the working v0.12.8 implementation was built and launched on
Apple Silicon, and an ARM64 APK was built and installed on Android. The Mac
context-menu actions were checked through book details and the deletion
confirmation, cancelling before any deletion. No controlled cross-device Google
Drive test was performed. The cleaned contribution uses the original icon and
cache paths; its final snapshot has not been rebuilt on all target platforms.
