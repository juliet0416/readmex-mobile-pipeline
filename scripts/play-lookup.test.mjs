import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { highestAndroidBuild, verifyPlayAccess } from './google-play.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

function fixture(intercept = () => undefined) {
  const calls = [], delays = [], warnings = [];
  const fetchImpl = async (url, init) => {
    const request = { url, method: init.method };
    calls.push(request);
    const response = await intercept(request);
    if (response) return response;
    if (url.includes('oauth2')) return Response.json({ access_token: 'private-test-token' });
    if (init.method === 'POST') return Response.json({ id: 'lookup-edit' });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/bundles')) return Response.json({ bundles: [{ versionCode: 10 }] });
    if (url.endsWith('/tracks')) return Response.json({ tracks: [{ releases: [{ versionCodes: ['15'] }] }] });
    throw new Error('Unexpected test request');
  };
  const retry = { sleep: async delay => { delays.push(delay); }, warn: message => warnings.push(message) };
  return { calls, delays, warnings, lookup: () => highestAndroidBuild(account, 'ai.readmex.app', fetchImpl, retry), access: () => verifyPlayAccess(account, 'ai.readmex.app', fetchImpl, retry) };
}

test('cleanup retries the same DELETE after a non-JSON 503 without recreating the edit', async () => {
  let deletes = 0;
  const f = fixture(({ method }) => method === 'DELETE' && ++deletes === 1 ? new Response('<html>unavailable</html>', { status: 503 }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.equal(deletes, 2);
  assert.deepEqual(f.delays, [2000]);
  assert.equal(f.calls.filter(c => c.method === 'POST' && !c.url.includes('oauth2')).length, 1);
  assert.equal(new Set(f.calls.filter(c => c.method === 'DELETE').map(c => c.url)).size, 1);
});

test('an already deleted lookup edit (404) counts as successful cleanup', async () => {
  const f = fixture(({ method }) => method === 'DELETE' ? new Response(null, { status: 404 }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.deepEqual(f.delays, []);
  assert.deepEqual(f.warnings, []);
});

test('successful lookup survives exhausted transient cleanup with a visible warning', async () => {
  const f = fixture(({ method }) => method === 'DELETE' ? new Response('private-server-body', { status: 503 }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 3);
  assert.deepEqual(f.delays, [2000, 4000]);
  assert.match(f.warnings.at(-1), /cleanup.*503.*incomplete/i);
  assert.doesNotMatch(f.warnings.join('\n'), /private-server-body|private-test-token|PRIVATE KEY/);
});

test('a query error is preserved when cleanup also fails', async () => {
  const f = fixture(({ url, method }) => {
    if (url.endsWith('/bundles')) return new Response(null, { status: 403 });
    if (method === 'DELETE') return new Response(null, { status: 503 });
  });
  await assert.rejects(f.lookup(), /bundles lookup HTTP 403/);
  assert.equal(f.calls.filter(c => c.url.endsWith('/bundles')).length, 1);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 3);
  assert.match(f.warnings.at(-1), /cleanup.*503/i);
});

test('permanent cleanup failure cannot replace an exhausted query error', async () => {
  const f = fixture(({ url, method }) => {
    if (url.endsWith('/tracks')) return new Response(null, { status: 503 });
    if (method === 'DELETE') return new Response(null, { status: 403 });
  });
  await assert.rejects(f.lookup(), /tracks lookup HTTP 503/);
  assert.equal(f.calls.filter(c => c.url.endsWith('/tracks')).length, 3);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.match(f.warnings.at(-1), /cleanup.*403.*original/i);
});

for (const status of [429, 500, 502, 503, 504]) test(`lookup retries transient HTTP ${status} and reads the actual store maximum`, async () => {
  let reads = 0;
  const f = fixture(({ url }) => url.endsWith('/bundles') && ++reads === 1 ? new Response('<html>temporary</html>', { status }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.equal(reads, 2);
  assert.deepEqual(f.delays, [2000]);
});

test('rate-limit Retry-After is respected within a bounded wait', async () => {
  let reads = 0;
  const f = fixture(({ url }) => url.endsWith('/bundles') && ++reads === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': '3' } }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.deepEqual(f.delays, [3000]);
});

for (const [header, delay] of [['3600', 30000], ['invalid', 2000]]) test(`Retry-After ${header} keeps the retry wait bounded`, async () => {
  let reads = 0;
  const f = fixture(({ url }) => url.endsWith('/bundles') && ++reads === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': header } }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.deepEqual(f.delays, [delay]);
});

test('Retry-After HTTP dates use the server wait', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-15T10:00:00Z'));
  let reads = 0;
  const f = fixture(({ url }) => url.endsWith('/bundles') && ++reads === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': 'Thu, 15 Oct 2026 10:00:10 GMT' } }) : undefined);
  assert.equal(await f.lookup(), 15);
  assert.deepEqual(f.delays, [10000]);
});

test('a disconnected response body retries the GET without recreating the edit', async () => {
  let reads = 0;
  const f = fixture(({ url }) => {
    if (url.endsWith('/bundles') && ++reads === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }));
  });
  assert.equal(await f.lookup(), 15);
  assert.equal(reads, 2);
  assert.equal(f.calls.filter(c => c.method === 'POST' && !c.url.includes('oauth2')).length, 1);
});

test('failure to cancel an error response body does not replace its HTTP status', async () => {
  let reads = 0;
  const f = fixture(({ url }) => {
    if (url.endsWith('/bundles') && ++reads === 1) return new Response(new ReadableStream({ cancel() { throw new Error('cancel failed'); } }), { status: 503 });
  });
  assert.equal(await f.lookup(), 15);
  assert.match(f.warnings[0], /lookup HTTP 503/);
});

for (const error of [new TypeError('fetch failed'), new DOMException('private-transport-message', 'TimeoutError')]) test(`lookup recovers from ${error.name}`, async () => {
  let reads = 0;
  const f = fixture(({ url }) => { if (url.endsWith('/bundles') && ++reads === 1) throw error; });
  assert.equal(await f.lookup(), 15);
  assert.equal(reads, 2);
  assert.deepEqual(f.delays, [2000]);
  assert.doesNotMatch(f.warnings.join('\n'), /private-transport-message/);
});

test('exhausted network failure during cleanup warns without losing the store maximum', async () => {
  const f = fixture(({ method }) => { if (method === 'DELETE') throw new TypeError('fetch failed'); });
  assert.equal(await f.lookup(), 15);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 3);
  assert.match(f.warnings.at(-1), /cleanup.*network.*incomplete/i);
});

for (const status of [401, 403]) test(`lookup fails immediately on HTTP ${status} and still cleans up`, async () => {
  const f = fixture(({ url }) => url.endsWith('/bundles') ? new Response(null, { status }) : undefined);
  await assert.rejects(f.lookup(), new RegExp(`lookup HTTP ${status}`));
  assert.deepEqual(f.delays, []);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
});

test('invalid successful lookup JSON is not retried or replaced by a guessed number', async () => {
  const f = fixture(({ url }) => url.endsWith('/bundles') ? new Response('not-json') : undefined);
  await assert.rejects(f.lookup(), SyntaxError);
  assert.deepEqual(f.delays, []);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
});

test('edit creation 503 reports HTTP status and is not repeated with an unknown edit outcome', async () => {
  const f = fixture(({ url, method }) => method === 'POST' && !url.includes('oauth2') ? new Response('not-json', { status: 503 }) : undefined);
  await assert.rejects(f.lookup(), /edit HTTP 503/);
  assert.equal(f.calls.filter(c => c.method === 'POST' && !c.url.includes('oauth2')).length, 1);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
  assert.deepEqual(f.delays, []);
});

test('a permanent cleanup error still fails an otherwise successful lookup', async () => {
  const f = fixture(({ method }) => method === 'DELETE' ? new Response(null, { status: 403 }) : undefined);
  await assert.rejects(f.lookup(), /cleanup HTTP 403/);
  assert.deepEqual(f.delays, []);
});

test('Play preflight shares bounded cleanup recovery without any commit request', async () => {
  const f = fixture(({ method }) => method === 'DELETE' ? new Response(null, { status: 503 }) : undefined);
  assert.equal((await f.access()).access, 'verified');
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 3);
  assert.ok(!f.calls.some(c => c.url.includes(':commit') || c.url.includes('/upload/')));
  assert.match(f.warnings.at(-1), /cleanup.*incomplete/i);
});
