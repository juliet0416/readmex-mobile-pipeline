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

//#region 只读商店查询与临时编辑清理重试
const transientPlayStatuses = new Set([429, 500, 502, 503, 504]);
const defaultRetry = { sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), warn: message => console.warn(message) };

async function playLookupRequest(url, method, headers, label, fetchImpl, retry) {
  // 仅用于 GET/DELETE；不重做创建编辑、上传或提交等有副作用的请求。
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response, failure;
    try {
      response = await fetchImpl(url, { method, headers, signal: AbortSignal.timeout(30000) });
      if (response.ok || (method === 'DELETE' && response.status === 404)) return method === 'GET' ? await response.json() : response;
    } catch (cause) {
      if (!['TimeoutError', 'AbortError'].includes(cause?.name) && !(cause instanceof TypeError && ['fetch failed', 'terminated'].includes(cause.message))) throw cause;
      response = undefined;
      failure = new Error(`${label} network error (${cause.name})`, { cause });
      failure.retryable = true;
    }
    if (response) {
      failure = new Error(`${label} HTTP ${response.status}`);
      failure.retryable = transientPlayStatuses.has(response.status);
      // 释放错误响应体仅为回收连接，失败时仍保留原始 HTTP 状态。
      try { await response.body?.cancel(); } catch {}
    }
    if (!failure.retryable || attempt === 3) throw failure;
    const after = response?.headers.get('retry-after');
    const requestedDelay = after ? (/^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now()) : 0;
    const delay = Math.max(2000 * 2 ** (attempt - 1), Math.min(30000, Number.isFinite(requestedDelay) ? requestedDelay : 0));
    // 不输出 URL、凭据、响应体和底层异常消息，防止诊断日志泄露密钥。
    retry.warn(`[play] ${failure.message}; retry ${attempt + 1}/3 in ${delay}ms`);
    await retry.sleep(delay);
  }
}

async function cleanupLookupEdit(url, headers, label, fetchImpl, retry) {
  try {
    await playLookupRequest(url, 'DELETE', headers, label, fetchImpl, retry);
  } catch (error) {
    if (!error.retryable) throw error;
    // 临时编辑从未提交商店变更；清理瞬态失败不使已验证的查询结果失效。
    retry.warn(`[play] ${error.message}; temporary edit cleanup incomplete after 3 attempts; no store changes committed`);
  }
}
//#endregion

export async function openPlayEdit(account, packageName, fetchImpl = fetch) {
  const { url, headers } = await playSession(account, packageName, fetchImpl);
  const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
  const edit = await response.json();
  if (response.status === 404) throw new Error('Play package not initialized: upload the first signed AAB manually in Play Console');
  if (!response.ok || !edit.id) throw new Error(`Google Play access failed (HTTP ${response.status}); check API enablement and Play app permissions`);
  return edit.id;
}

export async function verifyPlayAccess(account, packageName, fetchImpl = fetch, retryOptions = {}) {
  const retry = { ...defaultRetry, ...retryOptions };
  const { url, headers } = await playSession(account, packageName, fetchImpl);
  const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) throw new Error('Play package not initialized: upload the first signed AAB manually in Play Console');
  if (!response.ok) throw new Error(`Google Play access failed (HTTP ${response.status}); check API enablement and Play app permissions`);
  const edit = await response.json();
  if (!edit.id) throw new Error('Google Play access returned no temporary edit ID');
  // 仅验证发布接口权限，删除临时编辑，不提交任何商店变更。
  await cleanupLookupEdit(`${url}/${encodeURIComponent(edit.id)}`, headers, 'Google Play temporary edit cleanup', fetchImpl, retry);
  return { packageName, access: 'verified' };
}

export async function highestAndroidBuild(account, packageName, fetchImpl = fetch, retryOptions = {}) {
  const retry = { ...defaultRetry, ...retryOptions };
  const { url, headers } = await playSession(account, packageName, fetchImpl);
  const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Play build lookup edit HTTP ${response.status}`);
  const edit = await response.json();
  if (!edit.id) throw new Error('Play build lookup returned no temporary edit ID');
  const editUrl = `${url}/${encodeURIComponent(edit.id)}`;
  let queryFailed = false;
  try {
    const numbers = [];
    for (const resource of ['bundles', 'tracks']) {
      const data = await playLookupRequest(`${editUrl}/${resource}`, 'GET', headers, `Play ${resource} lookup`, fetchImpl, retry);
      const values = resource === 'bundles' ? (data.bundles ?? []).map(bundle => bundle.versionCode) : (data.tracks ?? []).flatMap(track => (track.releases ?? []).flatMap(release => release.versionCodes ?? []));
      for (const value of values) {
        if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid Play build number');
        numbers.push(Number(value));
      }
    }
    return Math.max(0, ...numbers);
  } catch (error) {
    queryFailed = true;
    throw error;
  } finally {
    try {
      await cleanupLookupEdit(editUrl, headers, 'Play build lookup edit cleanup', fetchImpl, retry);
    } catch (error) {
      if (!queryFailed) throw error;
      retry.warn(`[play] ${error.message}; preserving original build lookup error`);
    }
  }
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
