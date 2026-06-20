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
import { writeFile, mkdir, readFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD_ROOT = resolve(HERE, '..', '..'); // the readest-gdrive-sync-mod folder
const WORK_DIR = join(MOD_ROOT, 'work', 'readest'); // Readest is cloned here
const APP_DIR = join(WORK_DIR, 'apps', 'readest-app');
const MOD_PATCH = join(MOD_ROOT, 'tooling', 'mod', 'mod.patch');
const BASE_TAG_FILE = join(MOD_ROOT, 'tooling', 'mod', 'base-tag.txt');

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

async function buildInWork(onLine) {
  onLine('==> Init submodules');
  if (await sh(`git submodule update --init ${SUBMODULES.join(' ')}`, {}, onLine))
    return fail(onLine, 'submodule init');

  onLine('==> Install dependencies');
  if (await sh(`${PNPM} install`, {}, onLine)) return fail(onLine, 'pnpm install');

  if (IS_WIN) await sh('taskkill /F /IM readest.exe', {}, onLine);

  onLine('==> Vendor wasm/pdfjs artifacts');
  for (const leaf of VENDOR_LEAVES)
    if (await sh(`${PNPM} run ${leaf}`, { cwd: APP_DIR }, onLine)) return fail(onLine, `vendor ${leaf}`);

  // Inject the builder's Google OAuth credentials so the app can offer "Connect
  // Google Drive". Without this file the app still builds, but shows "Google Drive
  // not configured in this build" and the Connect button is disabled. The creds
  // are NEXT_PUBLIC_* and get baked into the frontend by `next build`, so this
  // must happen before it.
  const credsFile = join(MOD_ROOT, 'tooling', 'mod', 'credentials.env');
  if (existsSync(credsFile)) {
    await copyFile(credsFile, join(APP_DIR, '.env.local'));
    onLine('==> Google credentials injected — Drive connect will be enabled');
  } else {
    onLine('==> No tooling/mod/credentials.env — building WITHOUT Google Drive (Connect disabled).');
  }

  onLine('==> Build frontend');
  if (await sh(`${PNPM} build`, { cwd: APP_DIR }, onLine)) return fail(onLine, 'next build');

  onLine('==> Build native app');
  await writeFile(join(APP_DIR, '.patcher-tauri-override.json'), '{"build":{"beforeBuildCommand":""}}');
  const tauri =
    `${PNPM} exec dotenv -e .env.tauri -- tauri build --debug --no-bundle --config .patcher-tauri-override.json`;
  if (await sh(tauri, { cwd: APP_DIR, env: cargoEnv() }, onLine)) return fail(onLine, 'tauri build');

  onLine(`==> Done. Built ${join(WORK_DIR, 'target', 'debug', 'readest.exe')}`);
  return 0;
}

/** Non-destructive-ish check: does the overlay still apply onto <ref>? */
export async function runCheck(ref, onLine) {
  if (await ensureClone(onLine)) return 1;
  if (await sh(`git checkout -f ${ref}`, {}, onLine)) return fail(onLine, `checkout ${ref}`);
  await sh('git clean -fd', {}, onLine);
  const code = await sh(`git apply --check ${q(MOD_PATCH)}`, {}, onLine);
  if (code === 0) {
    onLine(`RESULT: CLEAN — the mod applies onto ${ref}.`);
    return 0;
  }
  onLine(`RESULT: NEEDS MERGE — the overlay does not apply cleanly to ${ref}.`);
  onLine('Run "Update & Build": locale-only clashes auto-resolve; code clashes are reported.');
  return 1;
}

/** Full flow: clone (if needed) → overlay onto <ref> → build. */
export async function runUpdate(ref, onLine) {
  if (await ensureClone(onLine)) return 1;
  if (!(await capture(`git rev-parse --verify --quiet "${ref}^{commit}"`)).out)
    return fail(onLine, `version '${ref}' not found`);
  if (await overlayOnto(ref, onLine)) return 1;
  return buildInWork(onLine);
}

/** Rebuild whatever is currently overlaid in work/ (no re-clone, no re-overlay). */
export async function runBuild(onLine) {
  if (!isCloned()) {
    onLine('Nothing built yet — use "Update & Build" first to set up work/readest.');
    return 1;
  }
  return buildInWork(onLine);
}
