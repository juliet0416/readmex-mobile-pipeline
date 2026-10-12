import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { recoverPlayCommit } from './google-play.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'release@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const options = { packageName: 'ai.readmex.app', editId: 'known-edit', buildNumber: '4', track: 'internal', status: 'draft', sha256: 'a'.repeat(64) };

test('commit recovery retries the same edit and never uploads the bundle again', async () => {
  let commits = 0;
  const calls = [];
  const result = await recoverPlayCommit(account, options, async (url, init) => {
    calls.push([url, init.method]);
    if (url.includes('oauth2')) return Response.json({ access_token: 'token' });
    if (url.endsWith('/bundles')) return Response.json({ bundles: [{ versionCode: 4, sha256: options.sha256 }] });
    if (url.endsWith('/tracks/internal')) return Response.json({ releases: [{ status: 'draft', versionCodes: ['4'] }] });
    if (url.endsWith(':commit')) return ++commits === 1 ? Response.json({ error: {} }, { status: 503 }) : Response.json({ id: 'known-edit' });
    throw Error('Unexpected request');
  }, async () => {});
  assert.equal(result, 'committed');
  assert.equal(commits, 2);
  assert.ok(calls.filter(c => c[0].endsWith(':commit')).every(c => c[0].includes('known-edit')));
  assert.ok(!calls.some(c => c[0].includes('/upload/')));
});
test('recovery refuses a mismatched bundle hash rather than claiming upload success', async () => {
  await assert.rejects(recoverPlayCommit(account, options, async url => url.includes('oauth2') ? Response.json({ access_token: 'token' }) : Response.json({ bundles: [{ versionCode: 4, sha256: 'b'.repeat(64) }] }), async () => {}), /bundle.*match/i);
});
test('commit recovery is bounded when the backend remains unavailable', async () => {
  let attempts = 0;
  await assert.rejects(recoverPlayCommit(account, options, async url => {
    if (url.includes('oauth2')) return Response.json({ access_token: 'token' });
    if (url.endsWith('/bundles')) return Response.json({ bundles: [{ versionCode: 4, sha256: options.sha256 }] });
    if (url.endsWith('/tracks/internal')) return Response.json({ releases: [{ status: 'draft', versionCodes: ['4'] }] });
    attempts++;
    return Response.json({}, { status: 503 });
  }, async () => {}), /503/);
  assert.equal(attempts, 3);
});
