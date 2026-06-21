// Self-contained pipeline for the patcher — no bash, no pre-existing checkout.
//
// The whole product is the `readest-gdrive-sync-mod` folder. This pipeline makes
// it stand alone: it CLONES Readest into `work/readest` inside the folder,
// overlays the mod (one portable patch: tooling/mod/mod.patch), and builds.
// Only Node + the dev toolchain (git, pnpm, Rust) are required.
//
// Every step shells out through the platform shell (so pnpm/tauri `.cmd` shims
// work on Windows without bash) and streams each line to `onLine` for the live
// browser log. Functions resolve an exit code and never reject.

import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile, cp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD_ROOT = resolve(HERE, '..', '..'); // the readest-gdrive-sync-mod folder
const WORK_DIR = join(MOD_ROOT, 'work', 'readest'); // Readest is cloned here
const APP_DIR = join(WORK_DIR, 'apps', 'readest-app');
const MOD_PATCH = join(MOD_ROOT, 'tooling', 'mod', 'mod.patch');
const BASE_TAG_FILE = join(MOD_ROOT, 'tooling', 'mod', 'base-tag.txt');
// Bundled default Google client (committed, non-secret) + the optional per-builder
// override (gitignored). The reverse-DNS scheme is derived from whichever is used.
const DEFAULT_CLIENT_ID_FILE = join(MOD_ROOT, 'tooling', 'mod', 'default-client-id.txt');
const CLIENT_ID_OVERRIDE_FILE = join(MOD_ROOT, 'tooling', 'mod', 'credentials.env');
const CLIENT_ID_ENV_KEY = 'NEXT_PUBLIC_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';
const REVERSE_DNS_SCHEME_PREFIX = 'com.googleusercontent.apps.';
// Readest GMod app icon set (replaces Readest's own icons in the build).
const ICONS_SRC = join(MOD_ROOT, 'tooling', 'mod', 'icons');
// Android APK output + the path tauri writes the debug APK to.
const ANDROID_OUTPUT_DIR = join(MOD_ROOT, 'work', 'output');
const APK_FILENAME = 'Readest-GMod.apk';
/** Where tauri writes the built APK, per build variant (debug | release). */
const builtApkPath = (release) => {
  const variant = release ? 'release' : 'debug';
  return join(
    APP_DIR, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', variant, `app-universal-${variant}.apk`,
  );
};

const READEST_URL = 'https://github.com/readest/readest.git';
// Override for fast local testing: clone from an existing checkout instead of GitHub.
const CLONE_SOURCE = process.env.READEST_CLONE_SOURCE || READEST_URL;
const IS_WIN = process.platform === 'win32';
const LOCALES = 'apps/readest-app/public/locales/';

const SUBMODULES = [
  'packages/foliate-js',
  'packages/js-mdict',
  'packages/simplecc-wasm',
  'packages/tauri',
  'packages/tauri-plugins',
  'packages/qcms',
  'apps/readest-app/src-tauri/plugins/tauri-plugin-turso',
  'apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade',
];
const VENDOR_LEAVES = [
  'prepare-public-vendor',
  'copy-pdfjs-js',
  'copy-pdfjs-wasm',
  'copy-pdfjs-fonts',
  'copy-flatten-pdfjs-annotation-layer-css',
  'copy-flatten-pdfjs-text-layer-css',
  'copy-simplecc',
  'copy-jieba',
];

const q = (p) => `"${p}"`; // quote a path for the shell (handles the space in the folder name)

/**
 * Absolute path to pnpm, quoted — used instead of a bare `pnpm` so the build does
 * not depend on the spawned shell's PATH (the npm global dir is on the USER PATH,
 * which child cmd.exe shells don't always inherit). Falls back to `pnpm` on PATH.
 */
function resolvePnpm() {
  if (!IS_WIN) return 'pnpm';
  const candidates = [
    join(process.env['APPDATA'] ?? '', 'npm', 'pnpm.cmd'),
    join(process.env['ProgramFiles'] ?? '', 'nodejs', 'pnpm.cmd'),
    join(process.env['LOCALAPPDATA'] ?? '', 'pnpm', 'pnpm.cmd'),
  ];
  const found = candidates.find((p) => p && existsSync(p));
  return found ? `"${found}"` : 'pnpm';
}
const PNPM = resolvePnpm();

const cargoEnv = () => {
  const sep = IS_WIN ? ';' : ':';
  return { ...process.env, PATH: `${join(homedir(), '.cargo', 'bin')}${sep}${process.env.PATH ?? ''}` };
};
const baseTag = async () => (await readFile(BASE_TAG_FILE, 'utf8')).trim();

function sh(commandString, { cwd = WORK_DIR, env = process.env } = {}, onLine) {
  return new Promise((res) => {
    onLine(`$ ${commandString}`);
    const child = spawn(commandString, { cwd, env, shell: true });
    let buffer = '';
    const pump = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(line.replace(/\r$/, ''));
    };
    child.stdout.on('data', pump);
    child.stderr.on('data', pump);
    child.on('close', (code) => {
      if (buffer) onLine(buffer.replace(/\r$/, ''));
      res(code ?? 1);
    });
    child.on('error', (err) => {
      onLine(`ERROR: ${err.message}`);
      res(1);
    });
  });
}

function capture(commandString, cwd = WORK_DIR) {
  return new Promise((res) => {
    const child = spawn(commandString, { cwd, shell: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => res({ code: code ?? 1, out: out.trim() }));
    child.on('error', () => res({ code: 1, out: '' }));
  });
}

const fail = (onLine, what) => {
  onLine(`FAILED: ${what}`);
  return 1;
};

const isCloned = () => existsSync(join(WORK_DIR, '.git'));

/** List Readest release tags WITHOUT needing a clone (queries GitHub directly). */
export async function listVersions() {
  // When the clone exists, read its tags (cwd must be the clone); otherwise ask
  // GitHub directly via ls-remote (cwd irrelevant — it's a remote query).
  const cmd = isCloned()
    ? 'git tag --sort=-v:refname'
    : `git ls-remote --tags --refs ${q(CLONE_SOURCE)}`;
  const { out } = await capture(cmd, isCloned() ? WORK_DIR : MOD_ROOT);
  const tags = out
    .split('\n')
    .map((l) => l.replace(/^.*refs\/tags\//, '').trim())
    .filter((t) => /^v\d/.test(t));
  // newest first
  return tags.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export async function state() {
  const cloned = isCloned();
  const current = cloned ? (await capture('git describe --tags --always')).out : null;
  const versions = await listVersions();
  return { cloned, baseTag: await baseTag(), current, latest: versions[0] ?? null };
}

/** Clone Readest into work/ on first run, then make sure tags are up to date. */
async function ensureClone(onLine) {
  if (!isCloned()) {
    onLine('==> First run: cloning Readest into work/readest (large, one-time)…');
    await mkdir(dirname(WORK_DIR), { recursive: true });
    if (await sh(`git clone ${q(CLONE_SOURCE)} ${q(WORK_DIR)}`, { cwd: MOD_ROOT }, onLine))
      return fail(onLine, 'git clone');
    // Always fetch versions from the real upstream regardless of clone source.
    await sh(`git remote set-url origin ${q(READEST_URL)}`, {}, onLine);
  }
  await sh('git fetch origin --tags --prune', {}, onLine);
  return 0;
}

/** Reset the clone to base, overlay the mod, replay onto <ref>. */
async function overlayOnto(ref, onLine) {
  const base = await baseTag();
  onLine(`==> Resetting clone to ${base} and overlaying the mod`);
  if (await sh(`git checkout -f ${base}`, {}, onLine)) return fail(onLine, `checkout ${base}`);
  await sh('git clean -fd', {}, onLine); // drop stray tracked-area files, keep node_modules/vendor (ignored)
  if (await sh(`git apply --index ${q(MOD_PATCH)}`, {}, onLine)) return fail(onLine, 'apply mod overlay');
  await sh('git -c user.email=mod@local -c user.name=mod commit -m "drive-sync mod overlay"', {}, onLine);

  if (ref === base) return 0; // already on the version the overlay targets
  onLine(`==> Replaying mod onto ${ref}`);
  if ((await sh(`git rebase ${ref}`, {}, onLine)) !== 0) {
    const conflicts = (await capture('git diff --name-only --diff-filter=U')).out.split('\n').filter(Boolean);
    const codeConflicts = conflicts.filter((c) => !c.includes('public/locales/'));
    if (codeConflicts.length) {
      onLine('CONFLICT in code files — a developer must merge these:');
      codeConflicts.forEach((c) => onLine(`  ${c}`));
      await sh('git rebase --abort', {}, onLine);
      return fail(onLine, `code conflicts vs ${ref}`);
    }
    onLine('Auto-resolving locale conflicts (English fallback covers mod strings).');
    await sh(`git checkout --ours -- ${LOCALES}`, {}, onLine);
    await sh(`git add ${LOCALES}`, {}, onLine);
    if ((await sh('git rebase --continue', { env: { ...process.env, GIT_EDITOR: 'true' } }, onLine)) !== 0) {
      await sh('git rebase --abort', {}, onLine);
      return fail(onLine, 'rebase --continue');
    }
  }
  return 0;
}

/** Read a client id from a `KEY=value` env file or a bare-id text file. */
async function readClientId(file) {
  if (!existsSync(file)) return '';
  const text = await readFile(file, 'utf8');
  const keyed = text.match(new RegExp(`^${CLIENT_ID_ENV_KEY}=(.*)$`, 'm'));
  if (keyed) return keyed[1].trim();
  return (text.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '').trim();
}

/**
 * The Google client id to bake into this build: the builder's override
 * (tooling/mod/credentials.env, gitignored) if set, else the committed bundled
 * default (tooling/mod/default-client-id.txt). Returns the id + whether it is the
 * default, so the UI and log can say which is in use. Exported for /api/creds.
 */
export async function effectiveClientId() {
  const override = await readClientId(CLIENT_ID_OVERRIDE_FILE);
  if (override) return { clientId: override, isDefault: false };
  return { clientId: await readClientId(DEFAULT_CLIENT_ID_FILE), isDefault: true };
}

/**
 * Derive the reverse-DNS redirect scheme from a Google client id — mirrors
 * `googleAuth/reverseDnsRedirect.ts` so the registered scheme matches the auth
 * request byte-for-byte.
 */
function deriveReverseDnsScheme(clientId) {
  const identifier = clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)
    ? clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length)
    : clientId;
  return `${REVERSE_DNS_SCHEME_PREFIX}${identifier.toLowerCase()}`;
}

/**
 * Bake the builder's Google client into the work tree: write the frontend env var
 * AND inject the client's reverse-DNS scheme into tauri.conf's deep-link config
 * (desktop + mobile), replacing whatever scheme the overlay shipped. This is THE
 * per-builder step — the scheme is derived from the client id, so each build
 * registers its OWN client's redirect. Must run before `next build` (writes the
 * NEXT_PUBLIC_* env it bakes in) and before `tauri build` (patches tauri.conf).
 */
async function injectClientConfig(onLine) {
  const { clientId, isDefault } = await effectiveClientId();
  if (!clientId) {
    onLine('==> No Google client id (default-client-id.txt empty + no override) — building WITHOUT Drive.');
    return;
  }
  await writeFile(join(APP_DIR, '.env.local'), `${CLIENT_ID_ENV_KEY}=${clientId}\n`);

  const scheme = deriveReverseDnsScheme(clientId);
  const confPath = join(APP_DIR, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(await readFile(confPath, 'utf8'));
  const deepLink = conf.plugins['deep-link'];
  deepLink.desktop.schemes = ['readest', scheme];
  deepLink.mobile = (deepLink.mobile ?? []).filter(
    (entry) => !(entry.scheme ?? []).some((s) => s.startsWith(REVERSE_DNS_SCHEME_PREFIX)),
  );
  deepLink.mobile.push({ scheme: [scheme], appLink: false });
  await writeFile(confPath, `${JSON.stringify(conf, null, 2)}\n`);

  onLine(
    `==> Injected Google client (${isDefault ? 'built-in default' : 'your override'}) + reverse-DNS scheme — Drive enabled`,
  );
}

/** Raw (unquoted) absolute pnpm path — for the Kotlin BuildTask string + the env. */
function resolvePnpmRaw() {
  if (!IS_WIN) return 'pnpm';
  const candidates = [
    join(process.env['APPDATA'] ?? '', 'npm', 'pnpm.cmd'),
    join(process.env['ProgramFiles'] ?? '', 'nodejs', 'pnpm.cmd'),
    join(process.env['LOCALAPPDATA'] ?? '', 'pnpm', 'pnpm.cmd'),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? 'pnpm';
}

/** Locate the Android SDK + newest installed NDK (env first, then the default dir). */
function resolveAndroidToolchain() {
  const sdk =
    process.env['ANDROID_HOME'] ||
    process.env['ANDROID_SDK_ROOT'] ||
    join(process.env['LOCALAPPDATA'] ?? '', 'Android', 'Sdk');
  let ndk = process.env['NDK_HOME'] || process.env['ANDROID_NDK_HOME'] || '';
  if (!ndk) {
    const ndkRoot = join(sdk, 'ndk');
    if (existsSync(ndkRoot)) {
      const versions = readdirSync(ndkRoot)
        .filter((v) => /^\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (versions.length) ndk = join(ndkRoot, versions[versions.length - 1]);
    }
  }
  return { sdk, ndk };
}

/**
 * Build env for the Android toolchain: SDK/NDK + a SPACE-FREE `CARGO_TARGET_DIR`
 * (a space in the work path breaks the NDK clang response file) + cargo and pnpm
 * on PATH (tauri's `beforeBuildCommand` and the gradle BuildTask both need them).
 */
function androidEnv() {
  const { sdk, ndk } = resolveAndroidToolchain();
  const sep = IS_WIN ? ';' : ':';
  const targetDir = join(homedir(), '.readest-gmod-android-target').replace(/\\/g, '/');
  const path = [
    join(homedir(), '.cargo', 'bin'),
    join(process.env['APPDATA'] ?? '', 'npm'),
    process.env.PATH ?? '',
  ].join(sep);
  return { ...process.env, ANDROID_HOME: sdk, NDK_HOME: ndk, ANDROID_NDK_HOME: ndk, CARGO_TARGET_DIR: targetDir, PATH: path };
}

/**
 * Re-apply the post-`tauri android init` fixes — init regenerates `gen/android`
 * from the identifier every time, wiping these. All three are hard-won:
 *  1. Windows can't exec the pnpm `.cmd` directly, so wrap the gradle BuildTask's
 *     CLI call in `cmd /c <pnpm.cmd>`.
 *  2. AAPT needs an `ic_launcher_background` color for the adaptive icon.
 *  3. Readest's local plugins declare a `store` flavor dim (foss/googleplay);
 *     pick FOSS (no Play billing) to resolve build-variant ambiguity.
 */
async function applyAndroidPostInitFixes(onLine, release) {
  const conf = JSON.parse(await readFile(join(APP_DIR, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const pkgPath = conf.identifier.split('.').join('/');
  const gen = join(APP_DIR, 'src-tauri', 'gen', 'android');

  const buildTask = join(gen, 'buildSrc', 'src', 'main', 'java', pkgPath, 'kotlin', 'BuildTask.kt');
  const kt = (await readFile(buildTask, 'utf8'))
    .split('"""pnpm"""')
    .join(`"""${resolvePnpmRaw()}"""`)
    .split('executable(executable)')
    .join('executable("cmd")')
    .split('args(args)')
    .join('args(listOf("/c", executable) + args)');
  await writeFile(buildTask, kt);

  const colors = join(gen, 'app', 'src', 'main', 'res', 'values', 'colors.xml');
  let xml = await readFile(colors, 'utf8');
  if (!xml.includes('ic_launcher_background'))
    xml = xml.replace('</resources>', '    <color name="ic_launcher_background">#FFFFFFFF</color>\n</resources>');
  await writeFile(colors, xml);

  const gradle = join(gen, 'app', 'build.gradle.kts');
  let g = await readFile(gradle, 'utf8');
  if (!g.includes('missingDimensionStrategy'))
    g = g.replace('defaultConfig {', 'defaultConfig {\n        missingDimensionStrategy("store", "foss")');
  // The generated `release` build type has no signingConfig, so a release APK would
  // be unsigned (uninstallable). Reuse the debug signing config — a debug-signed
  // release build is smaller (optimized + minified) and fine to sideload.
  if (release && !g.includes('signingConfig = signingConfigs.getByName("debug")'))
    g = g.replace('getByName("release") {', 'getByName("release") {\n            signingConfig = signingConfigs.getByName("debug")');
  await writeFile(gradle, g);

  onLine(`==> Applied Android post-init fixes (pnpm wrapper, icon color, FOSS flavor${release ? ', release signing' : ''})`);
}

/**
 * Build the debug APK. Regenerates `gen/android` fresh so its Kotlin package
 * matches the renamed identifier (tauri syncs it from `identifier`), applies the
 * post-init fixes, cleans the tauri mobile template's stale incremental cache, then
 * runs the build and copies the APK to `work/output/`. Best-effort: if no Android
 * SDK is present the exe is still the deliverable, so it logs and skips.
 */
async function buildAndroidApk(onLine, release) {
  const env = androidEnv();
  if (!env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) {
    onLine('==> No Android SDK (set ANDROID_HOME) — skipping APK. The Windows exe is still built.');
    return 0;
  }
  const variant = release ? 'release' : 'debug';

  onLine('==> Android: regenerating gen/android for the current identifier');
  await rm(join(APP_DIR, 'src-tauri', 'gen', 'android'), { recursive: true, force: true });
  if (await sh(`${PNPM} exec tauri android init`, { cwd: APP_DIR, env }, onLine))
    return fail(onLine, 'tauri android init');
  await applyAndroidPostInitFixes(onLine, release);

  // tauri's :tauri-android compile writes kotlin incremental caches INTO this source
  // template; a stale cache then breaks the plugin-copy ("failed to copy ... os error 2").
  await rm(join(WORK_DIR, 'packages', 'tauri', 'crates', 'tauri', 'mobile', 'android', 'build'), {
    recursive: true,
    force: true,
  });

  onLine(`==> Android: building ${variant} APK (aarch64)`);
  // tauri builds RELEASE by default; `--debug` is the only profile flag.
  const build = `${PNPM} exec dotenv -e .env.tauri -- tauri android build ${release ? '' : '--debug'} --apk -t aarch64`;
  if (await sh(build, { cwd: APP_DIR, env }, onLine)) return fail(onLine, 'tauri android build');

  await mkdir(ANDROID_OUTPUT_DIR, { recursive: true });
  await cp(builtApkPath(release), join(ANDROID_OUTPUT_DIR, APK_FILENAME));
  onLine(`==> Built APK: ${join(ANDROID_OUTPUT_DIR, APK_FILENAME)}`);
  return 0;
}

async function buildInWork(onLine, release = false) {
  onLine(`==> Build profile: ${release ? 'RELEASE (optimized, smaller)' : 'debug (faster)'}`);
  onLine('==> Init submodules');
  if (await sh(`git submodule update --init ${SUBMODULES.join(' ')}`, {}, onLine))
    return fail(onLine, 'submodule init');

  onLine('==> Install dependencies');
  if (await sh(`${PNPM} install`, {}, onLine)) return fail(onLine, 'pnpm install');

  if (IS_WIN) await sh('taskkill /F /IM readest.exe', {}, onLine);

  onLine('==> Vendor wasm/pdfjs artifacts');
  for (const leaf of VENDOR_LEAVES)
    if (await sh(`${PNPM} run ${leaf}`, { cwd: APP_DIR }, onLine)) return fail(onLine, `vendor ${leaf}`);

  await injectClientConfig(onLine);

  if (existsSync(ICONS_SRC)) {
    await cp(ICONS_SRC, join(APP_DIR, 'src-tauri', 'icons'), { recursive: true });
    onLine('==> Injected Readest GMod app icon');
  }

  onLine('==> Build frontend');
  if (await sh(`${PNPM} build`, { cwd: APP_DIR }, onLine)) return fail(onLine, 'next build');

  onLine('==> Build native app');
  await writeFile(join(APP_DIR, '.patcher-tauri-override.json'), '{"build":{"beforeBuildCommand":""}}');
  // tauri builds RELEASE by default; `--debug` is the only profile flag (there is no `--release`).
  const tauri =
    `${PNPM} exec dotenv -e .env.tauri -- tauri build ${release ? '' : '--debug'} --no-bundle --config .patcher-tauri-override.json`;
  if (await sh(tauri, { cwd: APP_DIR, env: cargoEnv() }, onLine)) return fail(onLine, 'tauri build');

  onLine(`==> Built ${join(WORK_DIR, 'target', release ? 'release' : 'debug', 'readest.exe')}`);

  const apkCode = await buildAndroidApk(onLine, release);
  if (apkCode !== 0) return apkCode;

  onLine('==> Done. Built the Windows exe (and the Android APK if the SDK was present).');
  return 0;
}

/** Non-destructive-ish check: does the overlay still apply onto <ref>? */
export async function runCheck(ref, onLine) {
  if (await ensureClone(onLine)) return 1;
  if (await sh(`git checkout -f ${ref}`, {}, onLine)) return fail(onLine, `checkout ${ref}`);
  await sh('git clean -fd', {}, onLine);
  const code = await sh(`git apply --check ${q(MOD_PATCH)}`, {}, onLine);
  if (code === 0) {
    onLine(`RESULT: COMPATIBLE — the mod fits Readest ${ref}.`);
    onLine('This was only a dry run: Readest was downloaded but NOT changed yet.');
    onLine('Click "Update & Build" to actually patch and build it (first time ~15-20 min).');
    return 0;
  }
  onLine(`RESULT: NEEDS A DEVELOPER — the mod no longer fits Readest ${ref} cleanly.`);
  onLine('Try "Update & Build" anyway (small wording clashes fix themselves automatically);');
  onLine('if it stops on a real clash it names the file — share the log.');
  return 1;
}

/** Full flow: clone (if needed) → overlay onto <ref> → build. `release` = optimized
 *  (smaller, slower) artifacts for distribution; default debug (faster). */
export async function runUpdate(ref, onLine, release = false) {
  if (await ensureClone(onLine)) return 1;
  if (!(await capture(`git rev-parse --verify --quiet "${ref}^{commit}"`)).out)
    return fail(onLine, `version '${ref}' not found`);
  if (await overlayOnto(ref, onLine)) return 1;
  return buildInWork(onLine, release);
}

/** Rebuild whatever is currently overlaid in work/ (no re-clone, no re-overlay). */
export async function runBuild(onLine, release = false) {
  if (!isCloned()) {
    onLine('Nothing built yet — use "Update & Build" first to set up work/readest.');
    return 1;
  }
  return buildInWork(onLine, release);
}
