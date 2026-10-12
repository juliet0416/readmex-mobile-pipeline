#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { releaseCopy } from './locales/release.mjs';

//#region card
export function buildFeishuCardPayload(input) {
  const copy = releaseCopy(input.lang);
  const built = input.buildResult === 'success';
  const failed = !built || (input.submit && input.submitResult !== 'success') || input.processingResult === 'INVALID';
  const title = input.connectivity ? copy.connectivity : built ? copy.titleSuccess : input.buildResult === 'cancelled' ? copy.titleCancelled : copy.titleFailure;
  const field = (label, value) => ({ is_short: true, text: { tag: 'lark_md', content: `**${label}**\n${value || '—'}` } });
  const link = (label, url) => url ? `[${label}](${url})` : label;
  const uploadState = !input.submit ? copy.skipped : input.submitResult === 'success' ? copy.uploaded : input.submitResult === 'failure' ? copy.failed : copy.blocked;
  const fields = [
    field(copy.platform, 'iOS'), field(copy.version, input.version), field(copy.build, input.buildNumber),
    field(copy.source, input.ref ? link(input.ref, `https://github.com/${input.sourceRepo}/commit/${encodeURIComponent(input.sourceSha || input.ref)}`) : ''),
    field(copy.ipa, input.artifactUrl ? link(`ios-release-${input.version}-${input.buildNumber}`, input.artifactUrl) : ''),
    field(copy.testflight, link(uploadState, input.testflightUrl)),
    field(copy.processing, input.processingResult === 'VALID' ? copy.valid : input.processingResult === 'INVALID' ? copy.invalid : copy.pending),
    field(copy.logs, input.runUrl ? link('GitHub Actions', input.runUrl) : ''),
  ];
  return { msg_type: 'interactive', card: { config: { wide_screen_mode: true }, header: { template: input.connectivity || !failed ? 'green' : 'red', title: { tag: 'plain_text', content: title } }, elements: [{ tag: 'div', fields }] } };
}
//#endregion

//#region signature-and-delivery
export function buildSignedBody(payload, { secret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) throw new Error('Missing FEISHU_RELEASE_WEBHOOK_SECRET');
  return { ...payload, timestamp: String(timestamp), sign: createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64') };
}

export async function sendFeishuNotification({ payload, secret, webhookUrl, fetchImpl = fetch }) {
  if (!webhookUrl) throw new Error('Missing FEISHU_RELEASE_WEBHOOK_URL');
  const response = await fetchImpl(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(buildSignedBody(payload, { secret })), signal: AbortSignal.timeout(20000) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Feishu invalid response (HTTP ${response.status})`); }
  const code = data.code ?? data.StatusCode;
  if (!response.ok || code !== 0) throw new Error(`Feishu rejected notification (HTTP ${response.status}, code ${code ?? 'missing'})`);
  return { status: response.status, code };
}
//#endregion

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const payload = buildFeishuCardPayload({ lang: env.FEISHU_RELEASE_LANG, version: env.RELEASE_VERSION, buildNumber: env.RELEASE_BUILD_NUMBER, ref: env.RELEASE_REF, sourceRepo: env.SOURCE_REPO, sourceSha: env.RELEASE_SOURCE_SHA, buildResult: env.BUILD_RESULT, submitResult: env.SUBMIT_RESULT, processingResult: env.PROCESSING_RESULT, submit: env.RELEASE_SUBMIT === 'true', runUrl: env.GITHUB_RUN_URL, artifactUrl: env.RELEASE_ARTIFACT_URL, testflightUrl: env.RELEASE_TESTFLIGHT_URL });
  sendFeishuNotification({ payload, secret: env.FEISHU_RELEASE_WEBHOOK_SECRET || env.FEISHU_RELEASE_WEBHOOK_SECRE, webhookUrl: env.FEISHU_RELEASE_WEBHOOK_URL }).then(result => console.log(`[feishu] delivered HTTP ${result.status}, code ${result.code}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
