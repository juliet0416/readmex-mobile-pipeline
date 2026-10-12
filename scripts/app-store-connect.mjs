import { sign } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

//#region authentication
export function createToken(env = process.env, now = Math.floor(Date.now() / 1000)) {
  for (const key of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_API_KEY_P8_BASE64']) if (!env[key]) throw new Error(`Missing ${key}`);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })}.${encode({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: Buffer.from(env.ASC_API_KEY_P8_BASE64, 'base64').toString('utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${signature}`;
}

export async function requestAsc(endpoint, env = process.env, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.appstoreconnect.apple.com${endpoint}`, { headers: { authorization: `Bearer ${createToken(env)}` }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`ASC HTTP ${response.status}: ${(data.errors ?? []).map(e => e.code).join(', ')}`);
  return data;
}
//#endregion

async function main() {
  const env = process.env;
  const output = (name, value) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`); };
  if (process.argv[2] === 'preflight') {
    const params = new URLSearchParams({ 'filter[bundleId]': env.IOS_APP_BUNDLE_ID, limit: '2' });
    const apps = await requestAsc(`/v1/apps?${params}`, env);
    if (apps.data?.length !== 1) throw new Error(`Expected one ASC app for ${env.IOS_APP_BUNDLE_ID}`);
    const appId = apps.data[0].id;
    output('app_id', appId);
    output('testflight_url', `https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`);
    console.log(`[ASC] App ${appId}: ${apps.data[0].attributes.bundleId}`);
    return;
  }
  if (process.argv[2] !== 'verify' || !env.ASC_APP_ID) throw new Error('Use preflight or verify (with ASC_APP_ID)');
  const params = new URLSearchParams({ 'filter[app]': env.ASC_APP_ID, 'filter[version]': env.APP_BUILD_NUMBER, include: 'preReleaseVersion', limit: '10' });
  for (let attempt = 0; attempt < 20; attempt++) {
    const data = await requestAsc(`/v1/builds?${params}`, env);
    const build = data.data?.find(item => {
      const versionId = item.relationships?.preReleaseVersion?.data?.id;
      const version = data.included?.find(item => item.id === versionId)?.attributes?.version;
      const normalized = version?.split('.').length === 2 ? `${version}.0` : version;
      return normalized === env.APP_VERSION;
    });
    const state = build?.attributes.processingState ?? 'PENDING';
    console.log(`[ASC] build ${env.APP_BUILD_NUMBER}: ${state}`);
    output('processing_result', state);
    if (build) output('build_id', build.id);
    if (state === 'VALID') return;
    if (['INVALID', 'FAILED'].includes(state)) throw new Error(`Apple processing failed: ${state}`);
    if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 30000));
  }
  console.log('[ASC] Upload accepted; processing still pending. Check the TestFlight link.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
