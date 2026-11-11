import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const isolatedScheme = (scheme) => scheme === 'readest' ? 'readest-gmod'
  : scheme === 'readest-onedrive' ? 'readest-gmod-onedrive' : scheme;

export async function isolateInstallation(appDir) {
  const configPath = join(appDir, 'src-tauri', 'tauri.conf.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const updaterPath = join(appDir, 'src', 'helpers', 'updater.ts');
  const updater = await readFile(updaterPath, 'utf8');
  const guard = "  if (process.env['NEXT_PUBLIC_GMOD_BUILD'] === '1') return false;\n";
  const anchor = '  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);';
  if (!updater.includes(guard) && !updater.includes(anchor)) {
    throw new Error('Updater layout changed; review GMod update isolation before building');
  }
  const keychainPath = join(appDir, 'src-tauri', 'plugins', 'tauri-plugin-native-bridge', 'src', 'desktop.rs');
  const keychain = await readFile(keychainPath, 'utf8');
  if (!keychain.includes('"Readest Safe Storage"') && !keychain.includes('"Readest GMod Safe Storage"')) {
    throw new Error('Keychain layout changed; review GMod credential isolation before building');
  }

  config.plugins['deep-link'].desktop.schemes = config.plugins['deep-link'].desktop.schemes.map(isolatedScheme);
  config.plugins['deep-link'].mobile = config.plugins['deep-link'].mobile
    .filter((entry) => entry.host !== 'web.readest.com')
    .map((entry) => ({ ...entry, scheme: entry.scheme.map(isolatedScheme) }));
  config.plugins.updater.endpoints = [];
  config.bundle.createUpdaterArtifacts = false;
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  await writeFile(updaterPath, updater.includes(guard) ? updater : updater.replace(anchor, guard + anchor));
  await writeFile(keychainPath, keychain.replace('"Readest Safe Storage"', '"Readest GMod Safe Storage"'));
}

export const isolateManifest = (xml) => xml
  .replace(/android:scheme="readest"/g, 'android:scheme="readest-gmod"')
  .replace(/android:scheme="readest-onedrive"/g, 'android:scheme="readest-gmod-onedrive"')
  .replace(/<intent-filter[^>]*>[\s\S]*?<\/intent-filter>/g, (filter) =>
    filter.includes('android:host="web.readest.com"') ? '' : filter);
