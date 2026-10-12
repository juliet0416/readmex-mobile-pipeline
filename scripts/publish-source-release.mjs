#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

//#region github-api-and-provenance
function client(token, fetchImpl = fetch) {
  if (!token) throw new Error('Missing GitHub token');
  return async (path, { method = 'GET', body, binary = false, raw = false, optional = false, accept = 'application/vnd.github+json' } = {}) => {
    const url = new URL(path, 'https://api.github.com');
    if (!['api.github.com', 'uploads.github.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Unexpected GitHub API host');
    const response = await fetchImpl(url.href, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) },
      ...(body ? { body: binary ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000),
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${url.pathname}: HTTP ${response.status}`);
    return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

async function assertSourceTag(api, options) {
  const ref = await api(`/repos/${options.sourceRepo}/git/ref/tags/${encodeURIComponent(options.tag)}`, { optional: true });
  if (!ref) throw new Error('Source tag is missing; refusing to recreate a deleted tag');
  let object = ref.object;
  for (let depth = 0; object?.type === 'tag' && depth < 10; depth++) object = (await api(`/repos/${options.sourceRepo}/git/tags/${object.sha}`)).object;
  if (object?.type !== 'commit' || object.sha !== options.sourceSha) throw new Error('Source tag SHA mismatch; refusing to attach artifacts');
}

export async function verifyHistoricalArtifacts(options) {
  if (String(options.artifactRunId) === String(options.currentRunId)) return;
  if (!/^\d+$/.test(options.artifactRunId) || !/^[\w.-]+\/[\w.-]+$/.test(options.pipelineRepo)) throw new Error('Invalid historical run');
  const api = client(options.pipelineToken, options.fetchImpl);
  const prefix = `/repos/${options.pipelineRepo}/actions`;
  const { jobs } = await api(`${prefix}/runs/${options.artifactRunId}/jobs?per_page=100`);
  const steps = jobs.find(job => job.name === 'build')?.steps ?? [];
  const required = options.platform === 'ios' ? ['Export IPA', 'Upload IPA artifact'] : ['Verify signing and 16 KB compatibility', ...(options.artifactType !== 'apk' ? ['Save AAB artifact'] : []), ...(options.artifactType !== 'aab' ? ['Save APK artifact'] : [])];
  if (!required.every(name => steps.some(step => step.name === name && step.conclusion === 'success'))) throw new Error('Historical artifact verification did not succeed');
  const notify = jobs.find(job => job.name === 'notify');
  if (!notify) throw new Error('Historical provenance log is missing');
  const log = (await api(`${prefix}/jobs/${notify.id}/logs`, { raw: true })).toString('utf8');
  const expected = { RELEASE_REF: options.tag, RELEASE_VERSION: options.version, RELEASE_BUILD_NUMBER: options.buildNumber, RELEASE_SOURCE_SHA: options.sourceSha };
  for (const [key, value] of Object.entries(expected)) {
    const values = [...log.matchAll(new RegExp(`(?:^|\\s)${key}: ([^\\r\\n]+)`, 'g'))].map(match => match[1].trim());
    if (!values.length || values.some(actual => actual !== value)) throw new Error(`Historical provenance mismatch: ${key}`);
  }
}
//#endregion

//#region source-release-assets
function selectedArtifacts(options) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.sourceRepo) || !/^\d+\.\d+\.\d+$/.test(options.version) || options.tag !== `mobile-v${options.version}`) throw new Error('Source tag must match app version mobile-vX.Y.Z');
  if (!/^[a-f0-9]{40}$/.test(options.sourceSha) || !/^[1-9]\d*$/.test(options.buildNumber)) throw new Error('Invalid source SHA or build number');
  if (!['android', 'ios'].includes(options.platform) || (options.platform === 'android' && !['aab', 'apk', 'both'].includes(options.artifactType))) throw new Error('Invalid release platform/artifact type');
  const extensions = options.platform === 'ios' ? ['ipa'] : options.artifactType === 'both' ? ['aab', 'apk'] : [options.artifactType];
  return extensions.map(extension => {
    const matches = options.artifacts.filter(artifact => artifact.name.endsWith(`.${extension}`));
    const name = `readmex-${options.version}-${options.buildNumber}.${extension}`;
    if (matches.length !== 1 || !matches[0].bytes?.length) throw new Error(`${extension.toUpperCase()} artifact missing or ambiguous`);
    if (extension !== 'ipa' && matches[0].name !== name) throw new Error('Artifact filename does not match version/build');
    return { name, bytes: matches[0].bytes, extension, digest: `sha256:${createHash('sha256').update(matches[0].bytes).digest('hex')}` };
  });
}

async function verifyAsset(api, options, asset, file) {
  if (asset.name !== file.name || asset.size !== file.bytes.length || asset.state !== 'uploaded') throw new Error(`Release asset mismatch: ${file.name}`);
  const digest = asset.digest || `sha256:${createHash('sha256').update(await api(`/repos/${options.sourceRepo}/releases/assets/${asset.id}`, { raw: true, accept: 'application/octet-stream' })).digest('hex')}`;
  if (digest !== file.digest) throw new Error(`Release asset digest mismatch: ${file.name}`);
}

export async function publishSourceRelease(options) {
  const files = selectedArtifacts(options);
  const api = client(options.token, options.fetchImpl);
  const prefix = `/repos/${options.sourceRepo}/releases`;
  const marker = `<!-- readmex-source-sha:${options.sourceSha} -->`;
  const releasePath = `${prefix}/tags/${encodeURIComponent(options.tag)}`;
  await assertSourceTag(api, options);
  let release = await api(releasePath, { optional: true });
  if (!release) {
    // GitHub 创建 Release 时可隐式建 tag，故紧邻写入再次检查，绝不主动创建 tag。
    await assertSourceTag(api, options);
    try {
      release = await api(prefix, { method: 'POST', body: { tag_name: options.tag, target_commitish: options.sourceSha, name: `ReadmeX ${options.tag}`, body: `ReadmeX mobile release artifacts.\n\nSource: ${options.sourceSha}\n\n${marker}`, draft: false, prerelease: false, make_latest: 'false' } });
    } catch (error) {
      if (!error.message.endsWith('HTTP 422')) throw error;
      release = await api(releasePath, { optional: true });
      if (!release) throw error;
    }
  }
  const assets = [];
  for (let page = 1; ; page++) {
    const batch = await api(`${prefix}/${release.id}/assets?per_page=100&page=${page}`);
    assets.push(...batch);
    if (batch.length < 100) break;
  }
  const priorSha = release.body?.match(/<!-- readmex-source-sha:([a-f0-9]{40}) -->/)?.[1];
  if ((priorSha && priorSha !== options.sourceSha) || (!priorSha && assets.length)) throw new Error('Release source provenance is different or unverified');
  if (release.draft || release.prerelease) throw new Error('Existing source Release is draft or prerelease; refusing to change its visibility');
  if (!priorSha) release = await api(`${prefix}/${release.id}`, { method: 'PATCH', body: { body: `${release.body || ''}\n\n${marker}` } });
  // 先检查全部同名资产，避免冲突时已上传另一份文件；重跑不覆盖已归档产物。
  for (const file of files) {
    const existing = assets.find(asset => asset.name === file.name);
    if (existing) await verifyAsset(api, options, existing, file);
  }
  const outputs = { release_url: `https://github.com/${options.sourceRepo}/releases/tag/${encodeURIComponent(options.tag)}` };
  for (const file of files) {
    await assertSourceTag(api, options);
    let asset = assets.find(item => item.name === file.name);
    if (!asset) {
      const url = new URL(release.upload_url.replace(/\{.*$/, ''));
      url.searchParams.set('name', file.name);
      asset = await api(url.href, { method: 'POST', body: file.bytes, binary: true });
    }
    await verifyAsset(api, options, asset, file);
    outputs[`${file.extension}_url`] = `https://github.com/${options.sourceRepo}/releases/download/${encodeURIComponent(options.tag)}/${encodeURIComponent(file.name)}`;
  }
  await assertSourceTag(api, options);
  return outputs;
}
//#endregion

//#region cli
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const options = { sourceRepo: env.SOURCE_REPO, token: env.SOURCE_REPO_PAT, tag: env.RELEASE_REF, sourceSha: env.RELEASE_SOURCE_SHA, version: env.RELEASE_VERSION, buildNumber: env.RELEASE_BUILD_NUMBER, platform: env.RELEASE_PLATFORM, artifactType: env.RELEASE_ARTIFACT_TYPE, pipelineRepo: env.GITHUB_REPOSITORY, pipelineToken: env.GITHUB_TOKEN, artifactRunId: env.ARTIFACT_RUN_ID, currentRunId: env.GITHUB_RUN_ID };
  try {
    await verifyHistoricalArtifacts(options);
    options.artifacts = readdirSync(env.ARTIFACT_DIRECTORY, { withFileTypes: true }).filter(file => file.isFile() && /\.(aab|apk|ipa)$/.test(file.name)).map(file => ({ name: file.name, bytes: readFileSync(join(env.ARTIFACT_DIRECTORY, file.name)) }));
    const outputs = await publishSourceRelease(options);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(`[release] archived ${Object.keys(outputs).length - 1} verified assets: ${outputs.release_url}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
//#endregion
