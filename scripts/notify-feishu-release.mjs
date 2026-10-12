#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { releaseCopy } from './locales/release.mjs';
import { resolveR2Objects } from './upload-r2.mjs';

//#region card
export function buildFeishuCardPayload(input) {
  const copy = releaseCopy(input.lang);
  const android = input.platform === 'android';
  const platform = android ? 'Android' : 'iOS';
  const built = input.buildResult === 'success';
  const failed = !built || (input.submit && input.submitResult !== 'success') || (android && input.publishApk && input.publishResult !== 'success') || ['INVALID', 'FAILED'].includes(input.processingResult);
  const title = (input.connectivity ? copy.connectivity : built ? copy.titleSuccess : input.buildResult === 'cancelled' ? copy.titleCancelled : copy.titleFailure).replace('{{platform}}', platform);
  const field = (label, value) => ({ is_short: true, text: { tag: 'lark_md', content: `**${label}**\n${value || '—'}` } });
  const link = (label, url) => url ? `[${label}](${url})` : label;
  const state = (requested, result, success) => !requested ? copy.skipped : result === 'success' ? success : result === 'failure' ? copy.failed : copy.blocked;
  const uploadState = state(input.submit, input.submitResult, android ? copy.playUploaded : copy.uploaded);
  const fields = [
    field(copy.platform, platform), field(copy.version, input.version), field(copy.build, input.buildNumber),
    field(copy.source, input.ref ? link(input.ref, `https://github.com/${input.sourceRepo}/commit/${encodeURIComponent(input.sourceSha || input.ref)}`) : ''),
  ];
  if (android) {
    const artifact = input.artifactType ?? 'aab';
    if (artifact !== 'apk') fields.push(field(copy.aab, input.aabUrl ? link(`readmex-${input.version}-${input.buildNumber}.aab`, input.aabUrl) : ''), field(copy.play, `${link(uploadState, input.submitResult === 'success' ? input.playUrl : '')}${input.submit && input.track ? `\n${input.track} · ${input.releaseStatus}` : ''}`));
    if (artifact !== 'aab') {
      fields.push(field(copy.apk, input.apkUrl ? link(`readmex-${input.version}-${input.buildNumber}.apk`, input.apkUrl) : ''), field(copy.r2, state(input.publishApk, input.publishResult, copy.r2Uploaded)));
      if (input.publishResult === 'success') {
        if (input.downloadUrl) fields.push(field(copy.download, link(`readmex-${input.version}-${input.buildNumber}.apk`, input.downloadUrl)));
        if (input.latestUrl) fields.push(field(copy.latest, link('readmex-latest.apk', input.latestUrl)));
      }
    }
    fields.push(field(copy.pageSize, input.pageSizeResult === 'success' ? copy.checked : copy.blocked));
  } else {
    fields.push(field(copy.ipa, input.artifactUrl ? link(`ios-release-${input.version}-${input.buildNumber}`, input.artifactUrl) : ''), field(copy.testflight, link(uploadState, input.testflightUrl)), field(copy.processing, input.submitResult !== 'success' ? copy.blocked : input.processingResult === 'VALID' ? copy.valid : ['INVALID', 'FAILED'].includes(input.processingResult) ? copy.invalid : copy.pending));
  }
  fields.push(field(copy.logs, input.runUrl ? link('GitHub Actions', input.runUrl) : ''));
  const elements = [];
  for (let i = 0; i < fields.length; i += 6) elements.push({ tag: 'div', fields: fields.slice(i, i + 6) });
  return { msg_type: 'interactive', card: { config: { wide_screen_mode: true }, header: { template: input.connectivity || !failed ? 'green' : 'red', title: { tag: 'plain_text', content: title } }, elements } };
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
  // 公开地址也可能存在 Secret 中；通知任务自行生成 URL，避免跨 job 输出被 GitHub 脱敏丢弃。
  const urls = env.RELEASE_PLATFORM === 'android' && env.PUBLISH_RESULT === 'success' ? resolveR2Objects({ version: env.RELEASE_VERSION, buildNumber: env.RELEASE_BUILD_NUMBER, prefix: env.R2_OBJECT_PREFIX, publicBaseUrl: env.R2_PUBLIC_BASE_URL }) : {};
  const payload = buildFeishuCardPayload({ lang: env.FEISHU_RELEASE_LANG, platform: env.RELEASE_PLATFORM, artifactType: env.RELEASE_ARTIFACT_TYPE, version: env.RELEASE_VERSION, buildNumber: env.RELEASE_BUILD_NUMBER, ref: env.RELEASE_REF, sourceRepo: env.SOURCE_REPO, sourceSha: env.RELEASE_SOURCE_SHA, buildResult: env.BUILD_RESULT, submitResult: env.SUBMIT_RESULT, processingResult: env.PROCESSING_RESULT, submit: env.RELEASE_SUBMIT === 'true', runUrl: env.GITHUB_RUN_URL, artifactUrl: env.RELEASE_ARTIFACT_URL, testflightUrl: env.RELEASE_TESTFLIGHT_URL, aabUrl: env.RELEASE_AAB_URL, apkUrl: env.RELEASE_APK_URL, playUrl: env.RELEASE_PLAY_URL, publishApk: env.RELEASE_PUBLISH_APK === 'true', publishResult: env.PUBLISH_RESULT, downloadUrl: urls.downloadUrl || env.RELEASE_DOWNLOAD_URL, latestUrl: urls.latestUrl || env.RELEASE_LATEST_URL, pageSizeResult: env.PAGE_SIZE_RESULT, track: env.RELEASE_TRACK, releaseStatus: env.RELEASE_STATUS });
  sendFeishuNotification({ payload, secret: env.FEISHU_RELEASE_WEBHOOK_SECRET || env.FEISHU_RELEASE_WEBHOOK_SECRE, webhookUrl: env.FEISHU_RELEASE_WEBHOOK_URL }).then(result => console.log(`[feishu] delivered HTTP ${result.status}, code ${result.code}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
