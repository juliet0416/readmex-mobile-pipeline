import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

//#region validated-version-and-signing
const version = process.env.APP_VERSION;
const build = process.env.APP_BUILD_NUMBER;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('APP_VERSION must be a semantic version');
if (!/^[1-9]\d*$/.test(build ?? '') || !Number.isSafeInteger(Number(build)) || Number(build) > 2100000000) throw new Error('Invalid Android build number');
if (!process.argv[2]) throw new Error('mobile app path is required');
const gradlePath = join(resolve(process.argv[2]), 'android/app/build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
for (const [pattern, replacement, name] of [
  [/\bversionCode\s+\d+/g, `versionCode ${build}`, 'versionCode'],
  [/\bversionName\s+["'][^"']+["']/g, `versionName "${version}"`, 'versionName'],
]) {
  if ((gradle.match(pattern) ?? []).length !== 1) throw new Error(`Expected exactly one ${name}`);
  gradle = gradle.replace(pattern, replacement);
}
if (!gradle.includes('CI_UPLOAD_STORE_FILE')) {
  if (!/android\s*\{/.test(gradle)) throw new Error('Android Gradle block is missing');
  const signing = `
    signingConfigs {
        release {
            def required = ['CI_UPLOAD_STORE_FILE', 'CI_UPLOAD_STORE_PASSWORD', 'CI_UPLOAD_KEY_ALIAS', 'CI_UPLOAD_KEY_PASSWORD']
            required.each { name ->
                if (!project.hasProperty(name) || project.property(name).toString().trim().isEmpty()) {
                    throw new GradleException("Missing Android signing property: $name")
                }
            }
            storeFile file(project.property('CI_UPLOAD_STORE_FILE'))
            storePassword project.property('CI_UPLOAD_STORE_PASSWORD')
            keyAlias project.property('CI_UPLOAD_KEY_ALIAS')
            keyPassword project.property('CI_UPLOAD_KEY_PASSWORD')
        }
    }
`;
  gradle = gradle.replace(/android\s*\{/, `android {${signing}`);
}
if (!gradle.includes('signingConfig signingConfigs.release')) {
  if (!/buildTypes\s*\{\s*release\s*\{/.test(gradle)) throw new Error('Release build type is missing');
  gradle = gradle.replace(/(buildTypes\s*\{\s*release\s*\{)/, '$1\n            signingConfig signingConfigs.release');
}
writeFileSync(gradlePath, gradle);
console.log(`[prepare] Android ${version} (${build}), release signing configured`);
//#endregion
