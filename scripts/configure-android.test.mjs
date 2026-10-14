import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('legacy Android source cannot be prepared for native release', () => {
  const root = mkdtempSync(join(tmpdir(), 'readmex-legacy-android-'));
  try {
    mkdirSync(join(root, 'android/app'), { recursive: true });
    writeFileSync(join(root, 'android/app/build.gradle'), 'legacy');
    const result = spawnSync(process.execPath, ['scripts/configure-android.mjs', root], { env: { ...process.env, APP_VERSION: '2.0.0', APP_BUILD_NUMBER: '42' }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(root, 'android/app/build.gradle'), 'utf8'), 'legacy');
    assert.match(result.stderr, /native\/version.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid release versions fail before changing source', () => {
  const result = spawnSync(process.execPath, ['scripts/configure-android.mjs', '/missing'], { env: { ...process.env, APP_VERSION: '1.0.0;evil', APP_BUILD_NUMBER: '0' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version|build/i);
});
