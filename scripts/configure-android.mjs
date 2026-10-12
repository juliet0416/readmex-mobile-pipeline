import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appRoot = resolve(process.argv[2]);
if (!appRoot) throw new Error('mobile app path is required');

const gradlePath = join(appRoot, 'android/app/build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');

if (!gradle.includes('CI_UPLOAD_STORE_FILE')) {
  const signingBlock = `    signingConfigs {\n        debug {\n            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n        release {\n            def required = ['CI_UPLOAD_STORE_FILE', 'CI_UPLOAD_STORE_PASSWORD', 'CI_UPLOAD_KEY_ALIAS', 'CI_UPLOAD_KEY_PASSWORD']\n            required.each { name ->\n                if (!project.hasProperty(name) || project.property(name).toString().trim().isEmpty()) {\n                    throw new GradleException("Missing Android signing property: $name")\n                }\n            }\n            storeFile file(project.property('CI_UPLOAD_STORE_FILE'))\n            storePassword project.property('CI_UPLOAD_STORE_PASSWORD')\n            keyAlias project.property('CI_UPLOAD_KEY_ALIAS')\n            keyPassword project.property('CI_UPLOAD_KEY_PASSWORD')\n        }\n    }\n`;
  gradle = gradle.replace(/android \{\n/, `android {\n${signingBlock}`);
}
gradle = gradle.replace(/(buildTypes \{\n\s*release \{)/, '$1\n            signingConfig signingConfigs.release');
writeFileSync(gradlePath, gradle);

const getuiGradlePath = join(appRoot, 'plugins/getui/android/build.gradle');
if (existsSync(getuiGradlePath)) {
  let getuiGradle = readFileSync(getuiGradlePath, 'utf8');
  if (!getuiGradle.includes('androidx.appcompat:appcompat')) {
    getuiGradle = getuiGradle.replace(
      /dependencies \{\n/,
      'dependencies {\n    implementation "androidx.appcompat:appcompat:1.7.1"\n',
    );
    writeFileSync(getuiGradlePath, getuiGradle);
  }
}

const resRoot = join(appRoot, 'android/app/src/main/res');
const mipmap = join(resRoot, 'mipmap');
mkdirSync(mipmap, { recursive: true });
for (const [source, target] of [
  ['drawable/ic_launcher_background.xml', 'mipmap/ic_launcher_background.xml'],
  ['drawable-v24/ic_launcher_foreground.xml', 'mipmap/ic_launcher_foreground.xml'],
]) {
  const sourcePath = join(resRoot, source);
  if (existsSync(sourcePath)) copyFileSync(sourcePath, join(resRoot, target));
}

console.log('[prepare] Android release signing and generated icon references prepared');
