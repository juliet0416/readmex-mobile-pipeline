import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveR2Objects, verifyPublicDownload } from './upload-r2.mjs';

test('ReadmeX uses separate versioned and latest names with no-cache latest', () => {
  const result = resolveR2Objects({ version: '1.0.0', buildNumber: '4', prefix: 'readmex/app-update', publicBaseUrl: 'https://cdn.example.com/' });
  assert.equal(result.objectKey, 'readmex/app-update/readmex-1.0.0-4.apk');
  assert.equal(result.latestObjectKey, 'readmex/app-update/readmex-latest.apk');
  assert.equal(result.latestUrl, 'https://cdn.example.com/readmex/app-update/readmex-latest.apk');
  assert.throws(() => resolveR2Objects({ version: '1.0.0', buildNumber: '4', prefix: '../other', publicBaseUrl: 'https://cdn.example.com' }), /prefix/);
});
test('cached latest download is rejected instead of advertised as current', async () => {
  await assert.rejects(verifyPublicDownload('https://cdn.example.com/latest.apk', 5, 'abc', true, async () => new Response(null, { status: 200, headers: { 'content-length': '5', etag: '"abc"', 'cache-control': 'max-age=300', 'cf-cache-status': 'HIT' } })), /cache/i);
});
test('successful latest HEAD and Range verifies expected bytes and bypassed cache', async () => {
  let calls = 0;
  await verifyPublicDownload('https://cdn.example.com/latest.apk', 5, 'abc', true, async (_url, init) => {
    calls++;
    return init.method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-length': '5', etag: '"abc"', 'cache-control': 'no-store, max-age=0', 'cf-cache-status': 'BYPASS' } }) : new Response('a', { status: 206, headers: { 'content-range': 'bytes 0-0/5', 'cache-control': 'no-store, max-age=0', 'cf-cache-status': 'BYPASS' } });
  });
  assert.equal(calls, 2);
});
test('latest Range cache policy must match HEAD even on the first cache MISS', async () => {
  await assert.rejects(verifyPublicDownload('https://cdn.example.com/latest.apk', 5, 'abc', true, async (_url, init) => init.method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-length': '5', etag: '"abc"', 'cache-control': 'no-store' } }) : new Response('a', { status: 206, headers: { 'content-range': 'bytes 0-0/5', 'cache-control': 'max-age=2678400', 'cf-cache-status': 'MISS' } })), /cache/i);
});
