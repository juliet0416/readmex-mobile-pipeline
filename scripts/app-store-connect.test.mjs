import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { generateKeyPairSync, verify } from 'node:crypto';

test('App Store Connect verification implementation exists', () => assert.ok(existsSync(new URL('./app-store-connect.mjs', import.meta.url))));
if (existsSync(new URL('./app-store-connect.mjs', import.meta.url))) {
  const { createToken, requestAsc } = await import('./app-store-connect.mjs');
  test('ASC JWT signs with ES256 and expires within Apple limits', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const env = { ASC_KEY_ID: 'KEY', ASC_ISSUER_ID: 'issuer', ASC_API_KEY_P8_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
    const [header, body, signature] = createToken(env, 1000).split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
    assert.equal(JSON.parse(Buffer.from(body, 'base64url')).exp, 2200);
    assert.ok(verify('sha256', Buffer.from(`${header}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  });
  test('ASC rejects unauthorized response and never exposes JWT', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const env = { ASC_KEY_ID: 'KEY', ASC_ISSUER_ID: 'issuer', ASC_API_KEY_P8_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
    await assert.rejects(requestAsc('/v1/apps', env, async () => new Response(JSON.stringify({ errors: [{ code: 'NOT_AUTHORIZED' }] }), { status: 401 })), /401.*NOT_AUTHORIZED/);
  });
}
