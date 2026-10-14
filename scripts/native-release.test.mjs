import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'readmex-native-pipeline-'));
  const write = (p, data) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), data); };
  write('native/version.json', '{"version":"2.0.0","buildNumber":2}');
  write('native/android/gradlew', '#!/bin/sh\n');
  write('native/android/app/build.gradle.kts', 'versionName = nativeVersion\n// CI_UPLOAD_STORE_FILE\n');
  write('native/ios/Info.plist', '<plist/>');
  write('native/ios/ReadmeX.entitlements', '<plist/>');
  write('native/ios/generate-project.py', "from pathlib import Path\nimport os\np=Path(__file__).parent/'ReadmeX.xcodeproj'\np.mkdir(exist_ok=True)\n(p/'project.pbxproj').write_text(os.environ['APP_VERSION']+' '+os.environ['APP_BUILD_NUMBER'])\n");
  const run = (script, extra = {}) => spawnSync(process.execPath, [`scripts/${script}.mjs`, root], { env: { ...process.env, APP_VERSION: '2.1.0', APP_BUILD_NUMBER: '42', GETUI_APP_ID: '', GETUI_APP_KEY: '', GETUI_APP_SECRET: '', READMEX_REQUIRE_PUSH: 'false', ...extra }, encoding: 'utf8' });
  return { root, write, run, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('Android preparation uses Kotlin native source without modifying either project', () => {
  const f = fixture();
  try {
    f.write('android/app/build.gradle', 'legacy bytes');
    const before = readFileSync(join(f.root, 'native/android/app/build.gradle.kts'), 'utf8');
    const r = f.run('configure-android');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(f.root, 'native/android/app/build.gradle.kts'), 'utf8'), before);
    assert.equal(readFileSync(join(f.root, 'android/app/build.gradle'), 'utf8'), 'legacy bytes');
  } finally { f.close(); }
});

test('iOS preparation generates native release version and writes no legacy project', () => {
  const f = fixture();
  try {
    const r = f.run('prepare-ios', { GETUI_APP_ID: 'ios-id', GETUI_APP_KEY: 'ios-key', GETUI_APP_SECRET: 'ios-secret' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(f.root, 'native/ios/ReadmeX.xcodeproj/project.pbxproj'), 'utf8'), '2.1.0 42');
    assert.match(readFileSync(join(f.root, 'native/ios/Config/Local.xcconfig'), 'utf8'), /GETUI_APP_ID = ios-id/);
    assert.ok(!r.stdout.includes('ios-secret'));
  } finally { f.close(); }
});

test('missing push config does not block release and partial config still fails', () => {
  const f = fixture();
  try {
    for (const script of ['prepare-ios', 'configure-android']) {
      const r = f.run(script, { READMEX_REQUIRE_PUSH: 'true' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /push disabled/);
    }
    const r = f.run('prepare-ios', { GETUI_APP_ID: 'partial' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /GETUI_APP_KEY/);
  } finally { f.close(); }
});

for (const platform of ['ios', 'android']) test(`${platform} workflow builds only native and retains release behavior`, () => {
  const yaml = readFileSync(new URL(`../.github/workflows/${platform}-release.yml`, import.meta.url), 'utf8');
  assert.ok(!yaml.includes('cap sync'));
  assert.ok(!yaml.includes('source/mobile-app/android'));
  assert.ok(!yaml.includes('source/mobile-app/ios/App'));
  assert.match(yaml, /native/);
  assert.ok(!yaml.includes('READMEX_REQUIRE_PUSH'));
  assert.match(yaml, /expected_source_sha/);
  assert.match(yaml, /Notify Feishu/);
  if (platform === 'ios') {
    assert.match(yaml, /runs-on: macos-26/);
    assert.match(yaml, /-scheme ReadmeX/);
    assert.match(yaml, /native\/ios\/ReadmeX\.xcodeproj\/project\.xcworkspace\/xcshareddata\/swiftpm\/Package\.resolved/);
    assert.match(yaml, /dSYMs/);
  } else {
    assert.match(yaml, /readmex.requireSigning=true/);
    assert.match(yaml, /testDebugUnitTest/);
    assert.match(yaml, /mapping\/release/);
  }
});
