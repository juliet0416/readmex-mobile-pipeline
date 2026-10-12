import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { decodeServiceAccount, buildAssertion, verifyPlayAccess } from './google-play.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { type: 'service_account', client_email: 'release@test.iam.gserviceaccount.com', private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
test('service account accepts base64 JSON and rejects non-key configs', () => {
  assert.equal(decodeServiceAccount(Buffer.from(JSON.stringify(account)).toString('base64')).client_email, account.client_email);
  for (const input of ['invalid!', Buffer.from('{"type":"firebase"}').toString('base64')]) assert.throws(() => decodeServiceAccount(input), /base64|service account/i);
});
test('OAuth assertion is signed and scoped only to Android Publisher', () => {
  const parts = buildAssertion(account, 123).split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
  assert.equal(claims.exp, 3723);
  assert.ok(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), createPublicKey(privateKey), Buffer.from(parts[2], 'base64url')));
});
test('Play access verifies OAuth and removes its temporary edit', async () => {
  const calls = [];
  await verifyPlayAccess(account, 'ai.readmex.app', async (url, init) => {
    calls.push([url, init.method]);
    if (url.includes('oauth2')) return Response.json({ access_token: 'token' });
    if (init.method === 'POST') return Response.json({ id: 'edit' });
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(calls.map(c => c[1]), ['POST', 'POST', 'DELETE']);
});
test('uninitialized Play package reports manual first upload requirement', async () => {
  await assert.rejects(verifyPlayAccess(account, 'ai.readmex.app', async url => url.includes('oauth2') ? Response.json({ access_token: 'token' }) : Response.json({ error: { message: 'Package not found' } }, { status: 404 })), /first.*AAB/i);
});
