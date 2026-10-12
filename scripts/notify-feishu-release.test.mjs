import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { catalogs } from './locales/release.mjs';

test('release notification implementation is available', () => {
  assert.ok(existsSync(new URL('./notify-feishu-release.mjs', import.meta.url)));
});
test('release catalogs share keys and named placeholders', () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.zh).sort());
  for (const key of Object.keys(catalogs.en)) assert.deepEqual(catalogs.en[key].match(/\{\{\w+\}\}/g), catalogs.zh[key].match(/\{\{\w+\}\}/g));
});

if (existsSync(new URL('./notify-feishu-release.mjs', import.meta.url))) {
  const { buildFeishuCardPayload, buildSignedBody, sendFeishuNotification } = await import('./notify-feishu-release.mjs');
  const input = { version: '1.0.0', buildNumber: '2', ref: 'abc123', sourceRepo: 'OtterMind/ReadmeX', buildResult: 'success', submitResult: 'success', submit: true, runUrl: 'https://github.com/juliet0416/readmex-mobile-pipeline/actions/runs/123', artifactUrl: 'https://example.com/ipa', testflightUrl: 'https://appstoreconnect.apple.com/apps/456/testflight/ios' };

  test('successful card includes version, build, IPA, logs and actual TestFlight link', () => {
    const card = buildFeishuCardPayload(input);
    assert.equal(card.card.header.template, 'green');
    assert.match(card.card.header.title.content, /ReadmeX.*successful/);
    for (const value of ['1.0.0', '2', input.artifactUrl, input.runUrl, input.testflightUrl]) assert.ok(JSON.stringify(card).includes(value));
    assert.ok(!JSON.stringify(card).includes('ottermind'));
  });
  test('upload failure preserves successful build result and turns card red', () => {
    const card = buildFeishuCardPayload({ ...input, submitResult: 'failure' });
    assert.equal(card.card.header.template, 'red');
    assert.match(JSON.stringify(card), /Upload failed/);
    assert.match(card.card.header.title.content, /build successful/);
  });
  test('build failure and cancellation do not report success', () => {
    for (const buildResult of ['failure', 'cancelled', 'skipped']) {
      assert.equal(buildFeishuCardPayload({ ...input, buildResult, submitResult: 'skipped' }).card.header.template, 'red');
    }
  });
  test('absent or invalid language defaults to English; explicit Chinese stays Chinese', () => {
    assert.match(buildFeishuCardPayload({ ...input, lang: 'invalid' }).card.header.title.content, /successful/);
    assert.match(buildFeishuCardPayload({ ...input, lang: 'zh' }).card.header.title.content, /打包成功/);
    assert.match(JSON.stringify(buildFeishuCardPayload({ ...input, submit: false, lang: 'zh' })), /未请求上传/);
  });
  test('signature uses timestamp and secret as HMAC key, with empty message', () => {
    const body = buildSignedBody({ msg_type: 'interactive' }, { timestamp: 123, secret: 'test-secret' });
    assert.equal(body.timestamp, '123');
    assert.equal(body.sign, createHmac('sha256', '123\ntest-secret').update('').digest('base64'));
  });
  test('HTTP 200 with a rejected signature is an error', async () => {
    await assert.rejects(sendFeishuNotification({ webhookUrl: 'https://example.com', secret: 'test', payload: {}, fetchImpl: async () => new Response(JSON.stringify({ code: 19021 }), { status: 200 }) }), /19021/);
  });
  test('HTTP 200 with malformed response does not claim delivery', async () => {
    await assert.rejects(sendFeishuNotification({ webhookUrl: 'https://example.com', secret: 'test', payload: {}, fetchImpl: async () => new Response('not-json', { status: 200 }) }), /invalid response/);
  });
  test('successful response verifies both HTTP and Feishu code', async () => {
    const result = await sendFeishuNotification({ webhookUrl: 'https://example.com', secret: 'test', payload: {}, fetchImpl: async () => new Response(JSON.stringify({ code: 0 }), { status: 200 }) });
    assert.deepEqual(result, { status: 200, code: 0 });
  });
  test('Android card names both artifact links and Play result without TestFlight', () => {
    const card = buildFeishuCardPayload({ ...input, platform: 'android', artifactType: 'both', aabUrl: 'https://example.com/aab', apkUrl: 'https://example.com/apk', playUrl: 'https://play.google.com/console', publishApk: true, publishResult: 'success', downloadUrl: 'https://downloads.example.com/readmex.apk' });
    const body = JSON.stringify(card);
    for (const text of ['Android', 'AAB', 'APK', 'https://example.com/aab', 'https://example.com/apk', 'https://downloads.example.com/readmex.apk', 'Google Play']) assert.ok(body.includes(text), text);
    assert.ok(!body.includes('TestFlight'));
    assert.ok(!body.includes('Apple'));
    assert.equal(card.card.header.template, 'green');
  });
  test('R2 failure shows failed distribution and preserves APK artifact', () => {
    const card = buildFeishuCardPayload({ ...input, platform: 'android', artifactType: 'apk', submit: false, publishApk: true, publishResult: 'failure', apkUrl: 'https://example.com/apk', downloadUrl: 'https://downloads.example.com/incorrect.apk' });
    assert.equal(card.card.header.template, 'red');
    assert.match(JSON.stringify(card), /https:\/\/example.com\/apk/);
    assert.ok(!JSON.stringify(card).includes('incorrect.apk'));
  });
}
