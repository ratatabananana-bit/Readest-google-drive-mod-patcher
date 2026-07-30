// Build ONLY the Android APK in DEBUG mode from the current work tree, without
// the desktop exe. `tauri android build` runs the frontend `beforeBuildCommand`
// itself, so this rebuilds `out/` with the live source edits and then the APK.
//
// Debug (vs release) is deliberate for diagnosis: it skips R8 minification and
// ships a debuggable WebView (JS console → logcat), so a runtime sync failure is
// visible over adb.
import { buildAndroidApk } from './pipeline.mjs';

const code = await buildAndroidApk((line) => console.log(line), false);
console.log(`\n=== debug APK build exit: ${code} ===`);
process.exit(code);
