import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Android workflow checks each selected artifact manifest before publishing', () => {
  const yaml = readFileSync(new URL('../.github/workflows/android-release.yml', import.meta.url), 'utf8');
  const match = yaml.match(/      - name: Verify Android release permissions\n        run: \|\n((?:          .*\n)+)/);
  assert.ok(match, 'Missing release permission gate');
  assert.ok(match.index > yaml.indexOf('- name: Build signed Android artifacts'));
  assert.ok(match.index < yaml.indexOf('- name: Save AAB artifact'));
  assert.ok(match.index < yaml.indexOf('- name: Save APK artifact'));
  const command = match[1].split('\n').filter(Boolean).map(line => line.slice(10)).join('\n');
  const root = mkdtempSync(join(tmpdir(), 'readmex-permissions-workflow-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./verify-android-permissions.py', import.meta.url), join(root, 'scripts/verify-android-permissions.py'));
    const base = join(root, 'source/mobile-app/native/android/app/build/intermediates');
    const paths = {
      aab: join(base, 'bundle_manifest/release/processApplicationManifestReleaseForBundle/AndroidManifest.xml'),
      apk: join(base, 'packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml'),
    };
    const write = (type, bad) => {
      mkdirSync(join(paths[type], '..'), { recursive: true });
      writeFileSync(paths[type], `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="ai.readmex.app"><uses-permission android:name="android.permission.${bad ? 'QUERY_ALL_PACKAGES' : 'INTERNET'}" /></manifest>`);
    };
    const run = type => spawnSync('bash', ['-e', '-c', command], { cwd: root, env: { ...process.env, ARTIFACT_TYPE: type, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
    for (const type of ['aab', 'apk', 'both']) {
      write('aab', false); write('apk', false);
      const valid = run(type);
      assert.equal(valid.status, 0, valid.stderr);
      for (const selected of type === 'both' ? ['aab', 'apk'] : [type]) {
        write(selected, true);
        const invalid = run(type);
        assert.notEqual(invalid.status, 0);
        assert.match(invalid.stderr, /QUERY_ALL_PACKAGES/);
        write(selected, false);
      }
    }
    write('apk', true);
    assert.equal(run('aab').status, 0, 'AAB-only release must not inspect a stale APK manifest');
    write('apk', false); write('aab', true);
    assert.equal(run('apk').status, 0, 'APK-only release must not inspect a stale AAB manifest');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
