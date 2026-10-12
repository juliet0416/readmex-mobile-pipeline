import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBuildNumber, highestArtifactBuild } from './resolve-build-number.mjs';
import { highestAndroidBuild } from './google-play.mjs';
import { highestIosBuild } from './app-store-connect.mjs';
import { generateKeyPairSync } from 'node:crypto';

test('automatic build is above the store, native source and build-only artifact history', () => {
  assert.equal(nextBuildNumber('android', '', [1, 6, 9]), '10');
  assert.equal(nextBuildNumber('ios', '', [1, 3, 0]), '4');
  assert.equal(nextBuildNumber('android', '12', [100]), '12');
  assert.throws(() => nextBuildNumber('android', '0', []), /positive/);
  assert.throws(() => nextBuildNumber('android', '', [2100000000]), /limit/);
});

test('artifact history follows pages and isolates platform build numbers', async () => {
  const pages = [
    { artifacts: Array.from({ length: 100 }, () => ({ name: 'ios-release-1.0.0-99' })) },
    { artifacts: [{ name: 'android-apk-1.0.0-9' }, { name: 'android-aab-1.0.0-6' }] },
  ];
  const requests = [];
  const result = await highestArtifactBuild('android', { GITHUB_TOKEN: 'test', GITHUB_REPOSITORY: 'juliet0416/readmex-mobile-pipeline' }, async url => {
    requests.push(url);
    return new Response(JSON.stringify(pages.shift()));
  });
  assert.equal(result, 9);
  assert.equal(requests.length, 2);
});

test('Android reads unassigned uploaded bundles as well as track releases and deletes its edit', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const calls = [];
  const responses = [{ access_token: 'test' }, { id: 'edit' }, { bundles: [{ versionCode: 10 }] }, { tracks: [{ releases: [{ versionCodes: ['6'] }] }] }, {}];
  assert.equal(await highestAndroidBuild(account, 'ai.readmex.app', async (url, options) => { calls.push({ url, method: options.method }); return new Response(JSON.stringify(responses.shift())); }), 10);
  assert.equal(calls.at(-1).method, 'DELETE');
});

test('Android store query failure still deletes the temporary edit', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const calls = [];
  const responses = [[200, { access_token: 'test' }], [200, { id: 'edit' }], [403, {}], [200, {}]];
  await assert.rejects(highestAndroidBuild(account, 'ai.readmex.app', async (_url, options) => { calls.push(options.method); const [status, body] = responses.shift(); return new Response(JSON.stringify(body), { status }); }), /403/);
  assert.equal(calls.at(-1), 'DELETE');
});

test('Apple numeric maximum follows all pages without sending credentials to another host', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { IOS_APP_BUNDLE_ID: 'ai.readmex.app', ASC_KEY_ID: 'key', ASC_ISSUER_ID: 'issuer', ASC_API_KEY_P8_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  const pages = [{ data: [{ id: 'app' }] }, { data: [{ attributes: { version: '3' } }], links: { next: 'https://api.appstoreconnect.apple.com/v1/builds?cursor=next' } }, { data: [{ attributes: { version: '9' } }] }];
  assert.equal(await highestIosBuild(env, async () => new Response(JSON.stringify(pages.shift()))), 9);
  const unsafe = [{ data: [{ id: 'app' }] }, { data: [], links: { next: 'https://other.example/v1/builds' } }];
  await assert.rejects(highestIosBuild(env, async () => new Response(JSON.stringify(unsafe.shift()))), /pagination/);
});
