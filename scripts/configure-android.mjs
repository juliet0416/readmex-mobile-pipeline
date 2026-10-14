import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { requireNativeSource, releaseValues, pushValues } from './native-source.mjs';

//#region native-android-preparation
const { version, buildNumber } = releaseValues();
if (!process.argv[2]) throw new Error('mobile app path is required');
const root = resolve(process.argv[2]);
requireNativeSource(root, 'android');
const gradle = readFileSync(join(root, 'native/android/app/build.gradle.kts'), 'utf8');
if (!gradle.includes('CI_UPLOAD_STORE_FILE')) throw new Error('Native Android source lacks CI signing support');
const push = pushValues('android');
console.log(`[prepare] native Android ${version} (${buildNumber}); push ${push.GETUI_APP_ID ? 'configured' : 'disabled'}`);
// Kotlin DSL 通过 Gradle properties / 环境读取版本和签名，准备器不改写源码。
//#endregion
