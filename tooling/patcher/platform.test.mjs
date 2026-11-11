import { test } from 'node:test';
import assert from 'node:assert/strict';
import { androidSdkPath, androidBuildTask, desktopBuildOptions, preserveMonochromeLayer } from './platform.mjs';

test('SDK resolution honors explicit paths before host defaults', () => {
  assert.equal(androidSdkPath('darwin', { ANDROID_HOME: '/sdk', ANDROID_SDK_ROOT: '/other' }, '/home'), '/sdk');
  assert.equal(androidSdkPath('darwin', { ANDROID_SDK_ROOT: '/other' }, '/home'), '/other');
  assert.equal(androidSdkPath('darwin', {}, '/home'), '/home/Library/Android/sdk');
  assert.equal(androidSdkPath('win32', { LOCALAPPDATA: 'C:\\Users\\builder\\AppData\\Local' }, 'C:\\Users\\builder'), 'C:\\Users\\builder\\AppData\\Local\\Android\\Sdk');
});

test('macOS keeps the generated Gradle executable and argument handling', () => {
  const task = 'val executable = """pnpm"""; executable(executable); args(args)';
  assert.equal(androidBuildTask(task, 'pnpm', 'darwin'), task);
  assert.equal(androidBuildTask(task, 'pnpm', 'linux'), task);
});

test('Windows keeps its cmd wrapper, including pnpm paths with spaces', () => {
  const task = 'val executable = """pnpm"""; executable(executable); args(args)';
  const result = androidBuildTask(task, 'C:\\Program Files\\pnpm.cmd', 'win32');
  assert.ok(result.includes('"""C:\\Program Files\\pnpm.cmd"""'));
  assert.ok(result.includes('executable("cmd")'));
  assert.ok(result.includes('args(listOf("/c", executable) + args)'));
});

test('macOS bundles an ad-hoc signed app without a provisioning profile', () => {
  const { override, bundleArgs } = desktopBuildOptions('darwin');
  assert.equal(bundleArgs, '--bundles app');
  assert.equal(override.build.beforeBuildCommand, '');
  assert.equal(override.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(override.bundle.macOS, { signingIdentity: '-', entitlements: null, files: {} });
});

test('Windows remains a portable executable and gets no Apple signing options', () => {
  const { override, bundleArgs } = desktopBuildOptions('win32');
  assert.equal(bundleArgs, '--no-bundle');
  assert.equal(override.bundle.macOS, undefined);
});

test('Android icon regeneration preserves the existing nested themed-icon layer', () => {
  const layer = '<monochrome><inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="22%"/></monochrome>';
  const original = `<adaptive-icon>${layer}</adaptive-icon>`;
  const generated = '<adaptive-icon><foreground/></adaptive-icon>';
  const restored = preserveMonochromeLayer(generated, original);
  assert.ok(restored.includes(layer));
  assert.equal(preserveMonochromeLayer(restored, original), restored);
  assert.equal(preserveMonochromeLayer(generated, '<adaptive-icon/>'), generated);
});
