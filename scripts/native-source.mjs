import { readFileSync, accessSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

//#region native-source-contract
export function readNativeVersion(root) {
  const config = JSON.parse(readFileSync(join(root, 'native/version.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(config.version ?? '')) throw new Error('Invalid native version');
  if (!Number.isSafeInteger(config.buildNumber) || config.buildNumber < 1 || config.buildNumber > 2100000000) throw new Error('Invalid native build number');
  return config;
}

export function requireNativeSource(root, platform) {
  if (!root || !['ios', 'android'].includes(platform)) throw new Error('Native source root and platform are required');
  const version = readNativeVersion(root);
  const files = platform === 'ios'
    ? ['ios/generate-project.py', 'ios/Info.plist', 'ios/ReadmeX.entitlements']
    : ['android/gradlew', 'android/app/build.gradle.kts'];
  for (const file of files) {
    try { accessSync(join(root, 'native', file)); }
    catch { throw new Error(`Native source lacks native/${file}; legacy projects cannot be released`); }
  }
  return version;
}

export function releaseValues(env = process.env) {
  const version = env.APP_VERSION;
  const buildNumber = env.APP_BUILD_NUMBER;
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('APP_VERSION must be a semantic version');
  if (!/^[1-9]\d*$/.test(buildNumber ?? '') || !Number.isSafeInteger(Number(buildNumber)) || Number(buildNumber) > 2100000000) throw new Error('Invalid APP_BUILD_NUMBER');
  return { version, buildNumber };
}

export function pushValues(platform, env = process.env) {
  const names = platform === 'ios' ? ['GETUI_APP_ID', 'GETUI_APP_KEY', 'GETUI_APP_SECRET'] : ['GETUI_APP_ID'];
  const configured = names.some(name => Boolean(env[name]));
  if (configured) {
    for (const name of names) if (!/^[A-Za-z0-9_-]+$/.test(env[name] ?? '')) throw new Error(`Missing or invalid ${name}`);
  }
  return Object.fromEntries(names.map(name => [name, env[name] ?? '']));
}
//#endregion

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireNativeSource(process.argv[3], process.argv[2]);
  console.log(`[source] native ${process.argv[2]} contract verified`);
}
