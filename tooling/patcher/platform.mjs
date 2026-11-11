import { win32, posix } from 'node:path';

export function androidSdkPath(platform, env, home) {
  if (env.ANDROID_HOME || env.ANDROID_SDK_ROOT) return env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (platform === 'darwin') return posix.join(home, 'Library', 'Android', 'sdk');
  return (platform === 'win32' ? win32 : posix).join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
}

export function androidBuildTask(source, pnpm, platform) {
  if (platform !== 'win32') return source;
  return source
    .split('"""pnpm"""').join(`"""${pnpm}"""`)
    .split('executable(executable)').join('executable("cmd")')
    .split('args(args)').join('args(listOf("/c", executable) + args)');
}

export function desktopBuildOptions(platform) {
  const override = { build: { beforeBuildCommand: '' }, bundle: { createUpdaterArtifacts: false } };
  if (platform === 'darwin') {
    override.bundle.macOS = { signingIdentity: '-', entitlements: null, files: {} };
  }
  return { override, bundleArgs: platform === 'darwin' ? '--bundles app' : '--no-bundle' };
}

// tauri icon regenerates the adaptive icon without upstream's themed layer.
export function preserveMonochromeLayer(generated, previous) {
  const layer = previous.match(/<monochrome\b[^>]*(?:\/>|>[\s\S]*?<\/monochrome>)/)?.[0];
  if (!layer || /<monochrome\b/.test(generated)) return generated;
  return generated.replace('</adaptive-icon>', `  ${layer}\n</adaptive-icon>`);
}
