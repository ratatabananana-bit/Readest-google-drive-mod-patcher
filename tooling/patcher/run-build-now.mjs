// Drive a full patcher build from the CLI (same path the web UI's
// "Update & Build" uses): reset clone to the base tag, apply the current
// mod.patch, build the host desktop app (and the Android APK if the SDK is present).
import { readFile } from 'node:fs/promises';
import { runUpdate } from './pipeline.mjs';

const ref = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  || (await readFile(new URL('../mod/base-tag.txt', import.meta.url), 'utf8')).trim();
const release = process.argv.includes('--release');
const code = await runUpdate(ref, (line) => console.log(line), release);
console.log(`\n=== patcher build exit: ${code} (ref=${ref}, ${release ? 'release' : 'debug'}) ===`);
process.exit(code);
