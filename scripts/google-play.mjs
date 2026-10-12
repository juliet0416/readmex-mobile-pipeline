import { createPrivateKey, sign } from 'node:crypto';
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

export async function verifyPlayAccess(account, packageName, fetchImpl = fetch) {
  if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(packageName ?? '')) throw new Error('Invalid Android package name');
  const oauth = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildAssertion(account) }), signal: AbortSignal.timeout(30000) });
  const token = await oauth.json();
  if (!oauth.ok || !token.access_token) throw new Error(`Google OAuth failed (HTTP ${oauth.status})`);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`;
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
  const response = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000) });
  const edit = await response.json();
  if (response.status === 404) throw new Error('Play package not initialized: upload the first signed AAB manually in Play Console');
  if (!response.ok || !edit.id) throw new Error(`Google Play access failed (HTTP ${response.status}); check API enablement and Play app permissions`);
  // 仅验证发布接口权限，删除临时编辑，不提交任何商店变更。
  const cleanup = await fetchImpl(`${url}/${encodeURIComponent(edit.id)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(30000) });
  if (!cleanup.ok) throw new Error(`Google Play temporary edit cleanup failed (HTTP ${cleanup.status})`);
  return { packageName, access: 'verified' };
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
  } else if (process.argv[2] === 'preflight') {
    const account = JSON.parse(readFileSync(env.PLAY_SERVICE_ACCOUNT_FILE, 'utf8'));
    await verifyPlayAccess(account, env.APP_PACKAGE_ID);
    console.log(`[play] Android Publisher access verified for ${env.APP_PACKAGE_ID}`);
  } else throw new Error('Usage: google-play.mjs decode|preflight');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
