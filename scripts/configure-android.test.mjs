import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Android preparation updates arbitrary versions and preserves optional SDK exclusion', () => {
  const root = mkdtempSync(join(tmpdir(), 'readmex-android-'));
  try {
    mkdirSync(join(root, 'android/app'), { recursive: true });
    mkdirSync(join(root, 'plugins/getui/android'), { recursive: true });
    writeFileSync(join(root, 'android/app/build.gradle'), 'android {\n defaultConfig {\n versionCode 19\n versionName "2.3.4"\n }\n buildTypes {\n release {\n minifyEnabled false\n }\n }\n}\n');
    writeFileSync(join(root, 'plugins/getui/android/build.gradle'), "api('com.getui:gtsdk:3.3.16.0') { exclude group: 'com.zxid.sdk', module: 'sdk-prod-channel-getui' }\n");
    const env = { ...process.env, APP_VERSION: '3.4.5', APP_BUILD_NUMBER: '42' };
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(process.execPath, ['scripts/configure-android.mjs', root], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
    assert.match(gradle, /versionCode 42/);
    assert.match(gradle, /versionName "3.4.5"/);
    assert.equal((gradle.match(/signingConfig signingConfigs.release/g) ?? []).length, 1);
    assert.match(readFileSync(join(root, 'plugins/getui/android/build.gradle'), 'utf8'), /exclude group: 'com.zxid.sdk'/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid release versions fail before changing source', () => {
  const result = spawnSync(process.execPath, ['scripts/configure-android.mjs', '/missing'], { env: { ...process.env, APP_VERSION: '1.0.0;evil', APP_BUILD_NUMBER: '0' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version|build/i);
});
