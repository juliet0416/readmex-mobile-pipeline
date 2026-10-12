import { createHash, createPrivateKey, sign } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

//#region service-account-and-access
export function decodeServiceAccount(encoded) {
  const normalized = String(encoded ?? '').replace(/\s/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error('Invalid service account base64');
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) throw new Error('Invalid service account base64');
  let account;
  try { account = JSON.parse(bytes); } catch { throw new Error('Invalid service account JSON'); }
  if (account.type !== 'service_account' || !account.client_email?.endsWith('.iam.gserviceaccount.com') || !account.private_key) throw new Error('Invalid service account fields');
  try { if (createPrivateKey(account.private_key).asymmetricKeyType !== 'rsa') throw new Error(); } catch { throw new Error('Invalid service account RSA key'); }
  return account;
}

export function buildAssertion(account, now = Math.floor(Date.now() / 1000)) {
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), account.private_key).toString('base64url')}`;
}

async function playSession(account, packageName, fetchImpl) {
  if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(packageName ?? '')) throw new Error('Invalid Android package name');
  const oauth = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildAssertion(account) }), signal: AbortSignal.timeout(30000) });
  const token = await oauth.json();
  if (!oauth.ok || !token.access_token) throw new Error(`Google OAuth failed (HTTP ${oauth.status})`);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`;
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
  return { url, headers };
}

export async function openPlayEdit(account, packageName, fetchImpl = fetch) {
  const { url, headers } = await playSession(account, packageName, fetchImpl);
  const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
  const edit = await response.json();
  if (response.status === 404) throw new Error('Play package not initialized: upload the first signed AAB manually in Play Console');
  if (!response.ok || !edit.id) throw new Error(`Google Play access failed (HTTP ${response.status}); check API enablement and Play app permissions`);
  return edit.id;
}

export async function verifyPlayAccess(account, packageName, fetchImpl = fetch) {
  const { url, headers } = await playSession(account, packageName, fetchImpl);
  const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
  const edit = await response.json();
  if (response.status === 404) throw new Error('Play package not initialized: upload the first signed AAB manually in Play Console');
  if (!response.ok || !edit.id) throw new Error(`Google Play access failed (HTTP ${response.status}); check API enablement and Play app permissions`);
  // 仅验证发布接口权限，删除临时编辑，不提交任何商店变更。
  const cleanup = await fetchImpl(`${url}/${encodeURIComponent(edit.id)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(30000) });
  if (!cleanup.ok) throw new Error(`Google Play temporary edit cleanup failed (HTTP ${cleanup.status})`);
  return { packageName, access: 'verified' };
}

export async function recoverPlayCommit(account, options, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const { url, headers } = await playSession(account, options.packageName, fetchImpl);
  if (!options.editId || !/^[1-9]\d*$/.test(options.buildNumber) || !/^[a-f0-9]{64}$/.test(options.sha256) || !['internal', 'alpha', 'beta', 'production'].includes(options.track) || !['draft', 'completed'].includes(options.status)) throw new Error('Invalid Play commit recovery inputs');
  const editUrl = `${url}/${encodeURIComponent(options.editId)}`;
  async function matches(editBase) {
    const bundles = await fetchImpl(`${editBase}/bundles`, { method: 'GET', headers, signal: AbortSignal.timeout(30000) });
    if (bundles.status === 404) return false;
    const data = await bundles.json();
    if (!bundles.ok) throw new Error(`Play bundle verification HTTP ${bundles.status}`);
    if (!data.bundles?.some(bundle => String(bundle.versionCode) === options.buildNumber && bundle.sha256?.toLowerCase() === options.sha256)) throw new Error('Uploaded Play bundle does not match expected version and SHA256');
    const track = await fetchImpl(`${editBase}/tracks/${options.track}`, { method: 'GET', headers, signal: AbortSignal.timeout(30000) });
    const trackData = await track.json();
    if (!track.ok || !trackData.releases?.some(release => release.status === options.status && release.versionCodes?.includes(options.buildNumber))) throw new Error('Play track release does not match expected status and version');
    return true;
  }
  if (!await matches(editUrl)) {
    // 提交回执丢失时，只根据新编辑中的实际 bundle 哈希与轨道版本确认，不能凭 404 宣称成功。
    const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
    const fresh = await response.json();
    if (!response.ok || !fresh.id) throw new Error('Unable to verify ambiguous Play commit');
    const freshUrl = `${url}/${encodeURIComponent(fresh.id)}`;
    try {
      if (!await matches(freshUrl)) throw new Error('Play commit could not be confirmed');
      return 'already-committed';
    } finally {
      const cleanup = await fetchImpl(freshUrl, { method: 'DELETE', headers, signal: AbortSignal.timeout(30000) });
      if (!cleanup.ok && cleanup.status !== 404) throw new Error(`Play verification edit cleanup HTTP ${cleanup.status}`);
    }
  }
  // 仅重试同一个编辑的提交；不重复上传 AAB，不重新生成构建号。
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl(`${editUrl}:commit`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (response.ok && result.id === options.editId) return 'committed';
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`Play edit commit failed (HTTP ${response.status})`);
    await sleep(2000 * 2 ** attempt);
  }
}
//#endregion

async function main() {
  const env = process.env;
  if (process.argv[2] === 'decode') {
    const account = decodeServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64);
    if (!env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required');
    mkdirSync(env.RUNNER_TEMP, { recursive: true });
    const file = join(env.RUNNER_TEMP, 'readmex-play-service-account.json');
    writeFileSync(file, JSON.stringify(account), { mode: 0o600 });
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `json_path=${file}\n`);
    console.log('[play] service account decoded');
  } else if (['preflight', 'prepare', 'recover'].includes(process.argv[2])) {
    const account = JSON.parse(readFileSync(env.PLAY_SERVICE_ACCOUNT_FILE, 'utf8'));
    if (process.argv[2] === 'preflight') {
      await verifyPlayAccess(account, env.APP_PACKAGE_ID);
      console.log(`[play] Android Publisher access verified for ${env.APP_PACKAGE_ID}`);
    } else if (process.argv[2] === 'prepare') {
      const edit = await openPlayEdit(account, env.APP_PACKAGE_ID);
      if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
      appendFileSync(env.GITHUB_OUTPUT, `edit_id=${edit}\n`);
      console.log('[play] release edit prepared');
    } else {
      const sha256 = createHash('sha256').update(readFileSync(env.PLAY_AAB_FILE)).digest('hex');
      const result = await recoverPlayCommit(account, { packageName: env.APP_PACKAGE_ID, editId: env.PLAY_EDIT_ID, buildNumber: env.APP_BUILD_NUMBER, track: env.PLAY_TRACK, status: env.PLAY_RELEASE_STATUS, sha256 });
      console.log(`[play] release ${result}; bundle SHA256 and track verified`);
    }
  } else throw new Error('Usage: google-play.mjs decode|preflight|prepare|recover');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
