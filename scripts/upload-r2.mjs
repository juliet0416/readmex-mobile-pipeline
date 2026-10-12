#!/usr/bin/env node

import { createReadStream, statSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHmac, createHash } from 'node:crypto';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const R2_REGION = 'auto';
const R2_SERVICE = 's3';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function fail(message) {
  throw new Error(message);
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function encodePath(path) {
  return String(path ?? '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export function encodeObjectKey(objectKey) {
  return encodePath(objectKey);
}

function buildCanonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

function buildSignature({ accessKeyId, accessKeySecret, accountId, bucket, contentLength, contentType, cacheControl, objectKey, now }) {
  const amzDate = now().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodePath(bucket)}/${encodePath(objectKey)}`;
  const headers = {
    'cache-control': cacheControl,
    'content-length': contentLength,
    'content-type': contentType,
    host,
    'x-amz-content-sha256': UNSIGNED_PAYLOAD,
    'x-amz-date': amzDate,
  };
  const canonical = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    'PUT', canonicalUri, '', canonical.canonical, canonical.signed, UNSIGNED_PAYLOAD,
  ].join('\n');
  const scope = `${shortDate}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${accessKeySecret}`, shortDate), R2_REGION), R2_SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${canonical.signed}, Signature=${signature}`,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Length': contentLength,
      'Content-Type': contentType,
      Host: host,
      'x-amz-content-sha256': UNSIGNED_PAYLOAD,
      'x-amz-date': amzDate,
    },
  };
}

export function buildR2Authorization(options) {
  return buildSignature(options).authorization;
}

export function buildR2UploadRequest({
  accessKeyId,
  accessKeySecret,
  accountId,
  bucket,
  cacheControl,
  contentLength,
  contentType = APK_CONTENT_TYPE,
  objectKey,
  now = () => new Date(),
}) {
  if (!accountId) fail('R2 account id is required');
  const signature = buildSignature({ accessKeyId, accessKeySecret, accountId, bucket, cacheControl, contentLength, contentType, objectKey, now });
  return {
    headers: { ...signature.headers, Authorization: signature.authorization },
    url: `https://${accountId}.r2.cloudflarestorage.com/${encodePath(bucket)}/${encodePath(objectKey)}`,
  };
}

//#region readmex-apk-publishing
export function resolveR2Objects({ version, buildNumber, prefix = 'readmex/app-update', publicBaseUrl }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^[1-9]\d*$/.test(buildNumber ?? '')) fail('Invalid APK version/build number');
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  if (cleanPrefix.split('/').some(p => !/^[a-zA-Z0-9._-]+$/.test(p) || ['.', '..'].includes(p))) fail('Invalid R2 object prefix');
  const base = new URL(publicBaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) fail('R2_PUBLIC_BASE_URL must be a public HTTPS base URL');
  const objectKey = `${cleanPrefix}/readmex-${version}-${buildNumber}.apk`;
  const latestObjectKey = `${cleanPrefix}/readmex-latest.apk`;
  const publicUrl = key => `${base.href.replace(/\/$/, '')}/${encodeObjectKey(key)}`;
  return { objectKey, latestObjectKey, downloadUrl: publicUrl(objectKey), latestUrl: publicUrl(latestObjectKey) };
}

export async function verifyPublicDownload(url, size, etag, latest, fetchImpl = fetch) {
  const head = await fetchImpl(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (head.status !== 200 || Number(head.headers.get('content-length')) !== size || head.headers.get('etag')?.replace(/^W\//, '').replace(/"/g, '') !== etag.replace(/"/g, '')) fail(`APK public metadata verification failed (HTTP ${head.status})`);
  if (latest && (!/(?:^|,)\s*no-store\b/i.test(head.headers.get('cache-control') ?? '') || head.headers.get('cf-cache-status') === 'HIT')) fail('Latest APK is cached: configure a Cloudflare Bypass cache rule and purge this URL');
  const range = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(30000) });
  if (latest && ['HIT', 'STALE', 'UPDATING', 'REVALIDATED'].includes(range.headers.get('cf-cache-status'))) {
    await range.body?.cancel();
    fail('Latest APK Range response is cached: configure Cloudflare Bypass cache');
  }
  if (range.status !== 206 || range.headers.get('content-range') !== `bytes 0-0/${size}`) {
    await range.body?.cancel();
    fail(`APK Range verification failed (HTTP ${range.status})`);
  }
  if ((await range.arrayBuffer()).byteLength !== 1) fail('APK Range response length mismatch');
}

async function uploadObject({ source, objectKey, cacheControl, ...credentials }) {
  const size = statSync(source).size;
  const request = buildR2UploadRequest({ ...credentials, contentLength: size, cacheControl, objectKey });
  const response = await fetch(request.url, { method: 'PUT', headers: request.headers, body: createReadStream(source), duplex: 'half', signal: AbortSignal.timeout(300000) });
  if (!response.ok) fail(`R2 upload failed (HTTP ${response.status})`);
  const etag = response.headers.get('etag');
  await response.body?.cancel();
  if (!etag) fail('R2 upload omitted ETag');
  console.log(`[r2] uploaded ${objectKey}`);
  return { size, etag };
}

async function main() {
  const env = process.env;
  for (const key of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_PUBLIC_BASE_URL', 'R2_SOURCE']) if (!env[key]) fail(`${key} is required`);
  const objects = resolveR2Objects({ version: env.APP_VERSION, buildNumber: env.APP_BUILD_NUMBER, prefix: env.R2_OBJECT_PREFIX || 'readmex/app-update', publicBaseUrl: env.R2_PUBLIC_BASE_URL });
  const credentials = { accessKeyId: env.R2_ACCESS_KEY_ID, accessKeySecret: env.R2_SECRET_ACCESS_KEY, accountId: env.R2_ACCOUNT_ID, bucket: env.R2_BUCKET_NAME, source: env.R2_SOURCE };
  const versioned = await uploadObject({ ...credentials, objectKey: objects.objectKey, cacheControl: 'public, max-age=31536000, immutable' });
  await verifyPublicDownload(objects.downloadUrl, versioned.size, versioned.etag, false);
  const latest = await uploadObject({ ...credentials, objectKey: objects.latestObjectKey, cacheControl: 'no-store, no-cache, max-age=0, must-revalidate' });
  await verifyPublicDownload(objects.latestUrl, latest.size, latest.etag, true);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `download_url=${objects.downloadUrl}\nlatest_url=${objects.latestUrl}\n`);
  console.log('[r2] versioned/latest APK downloads verified: HTTP 200 and Range 206');
}
//#endregion
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
