// Drive a full patcher build from the CLI (same path the web UI's
// "Update & Build" uses): reset clone to the base tag, apply the current
// mod.patch, build the Windows exe (and the Android APK if the SDK is present).
import { runUpdate } from './pipeline.mjs';

const ref = process.argv[2] || 'v0.11.12';
const release = process.argv.includes('--release');
const code = await runUpdate(ref, (line) => console.log(line), release);
console.log(`\n=== patcher build exit: ${code} (ref=${ref}, ${release ? 'release' : 'debug'}) ===`);
process.exit(code);
