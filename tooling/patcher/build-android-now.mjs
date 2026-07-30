import { buildAndroidApk } from './pipeline.mjs';
const code = await buildAndroidApk((line) => console.log(line), true);
console.log(`\n=== buildAndroidApk exit: ${code} ===`);
process.exit(code);
