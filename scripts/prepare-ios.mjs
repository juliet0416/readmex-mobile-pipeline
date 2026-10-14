import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireNativeSource, releaseValues, pushValues } from './native-source.mjs';

//#region native-ios-preparation
const { version, buildNumber } = releaseValues();
if (!process.argv[2]) throw new Error('mobile app path is required');
const root = resolve(process.argv[2]);
requireNativeSource(root, 'ios');
const push = pushValues('ios');
const config = join(root, 'native/ios/Config');
mkdirSync(config, { recursive: true });
writeFileSync(join(config, 'Local.xcconfig'), Object.entries(push).map(([key, value]) => `${key} = ${value}`).join('\n') + '\n', { mode: 0o600 });
execFileSync('python3', [join(root, 'native/ios/generate-project.py')], { env: process.env, stdio: 'inherit' });
console.log(`[prepare] native iOS ${version} (${buildNumber}); push ${push.GETUI_APP_ID ? 'configured' : 'disabled'}`);
//#endregion
