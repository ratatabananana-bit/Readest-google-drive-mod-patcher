import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { isolatedScheme, isolateManifest, isolateInstallation } from './isolation.mjs';

test('GMod owns distinct URL schemes and preserves Google OAuth scheme', () => {
  assert.equal(isolatedScheme('readest'), 'readest-gmod');
  assert.equal(isolatedScheme('readest-onedrive'), 'readest-gmod-onedrive');
  assert.equal(isolatedScheme('com.googleusercontent.apps.example'), 'com.googleusercontent.apps.example');
});
test('manifest isolates app links while preserving file and Google handlers', () => {
  const xml = '<manifest><intent-filter><data android:scheme="readest" /></intent-filter><intent-filter><data android:host="web.readest.com" /></intent-filter><intent-filter><data android:scheme="file" /></intent-filter><intent-filter><data android:scheme="com.googleusercontent.apps.example" /></intent-filter></manifest>';
  const result = isolateManifest(xml);
  assert.ok(result.includes('android:scheme="readest-gmod"'));
  assert.ok(!result.includes('web.readest.com'));
  assert.ok(result.includes('android:scheme="file"'));
  assert.ok(result.includes('com.googleusercontent.apps.example'));
  assert.equal(isolateManifest(result), result);
});


async function fixture(t, updater = '  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);') {
  const root = await mkdtemp(join(tmpdir(), 'gmod-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = [join(root, 'src-tauri/tauri.conf.json'), join(root, 'src/helpers/updater.ts'),
    join(root, 'src-tauri/plugins/tauri-plugin-native-bridge/src/desktop.rs')];
  const schemes = ['readest', 'readest-onedrive', 'com.googleusercontent.apps.example'];
  const config = { identifier: 'com.readestgmod.app', bundle: {}, plugins: {
    'deep-link': { desktop: { schemes }, mobile: [{ scheme: ['https'], host: 'web.readest.com' }, { scheme: schemes }] },
    updater: { endpoints: ['https://example.com/official-update'] },
  } };
  for (const path of paths) await mkdir(dirname(path), { recursive: true });
  await writeFile(paths[0], JSON.stringify(config));
  await writeFile(paths[1], updater);
  await writeFile(paths[2], 'const KEYRING_SERVICE: &str = "Readest Safe Storage";');
  return { root, paths };
}

test('isolation preserves the app identity and OAuth while separating credentials and updates', async (t) => {
  const { root, paths } = await fixture(t);
  await isolateInstallation(root);
  const [configText, updater, keychain] = await Promise.all(paths.map((p) => readFile(p, 'utf8')));
  const config = JSON.parse(configText);
  assert.equal(config.identifier, 'com.readestgmod.app');
  assert.deepEqual(config.plugins['deep-link'].desktop.schemes,
    ['readest-gmod', 'readest-gmod-onedrive', 'com.googleusercontent.apps.example']);
  assert.equal(config.plugins['deep-link'].mobile.length, 1);
  assert.deepEqual(config.plugins.updater.endpoints, []);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.ok(updater.includes("if (process.env['NEXT_PUBLIC_GMOD_BUILD'] === '1') return false;"));
  assert.ok(keychain.includes('"Readest GMod Safe Storage"'));
  await isolateInstallation(root);
  assert.deepEqual(await Promise.all(paths.map((p) => readFile(p, 'utf8'))), [configText, updater, keychain]);
});

test('unexpected upstream updater code fails before overwriting any fixture', async (t) => {
  const { root, paths } = await fixture(t, 'new updater implementation');
  const before = await Promise.all(paths.map((p) => readFile(p, 'utf8')));
  await assert.rejects(isolateInstallation(root), /Updater layout changed/);
  assert.deepEqual(await Promise.all(paths.map((p) => readFile(p, 'utf8'))), before);
});

test('unexpected keychain service names also fail without partially changing files', async (t) => {
  const { root, paths } = await fixture(t);
  await writeFile(paths[2], 'const NEW_SERVICE = "different upstream service";');
  const before = await Promise.all(paths.map((p) => readFile(p, 'utf8')));
  await assert.rejects(isolateInstallation(root), /Keychain layout changed/);
  assert.deepEqual(await Promise.all(paths.map((p) => readFile(p, 'utf8'))), before);
});
