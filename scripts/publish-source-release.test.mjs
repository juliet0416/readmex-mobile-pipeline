import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = new URL('./publish-source-release.mjs', import.meta.url);
test('source tag release publisher exists', () => assert.ok(existsSync(file)));

if (existsSync(file)) {
  const { publishSourceRelease, verifyHistoricalArtifacts } = await import(file);
  const sha = 'a'.repeat(40);
  const marker = `<!-- readmex-source-sha:${sha} -->`;
  const bytes = Buffer.from('signed artifact fixture');
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const options = { sourceRepo: 'OtterMind/ReadmeX', tag: 'mobile-v1.0.0', version: '1.0.0', buildNumber: '8', sourceSha: sha, platform: 'android', artifactType: 'both', token: 'fixture-token', artifacts: [{ name: 'readmex-1.0.0-8.aab', bytes }, { name: 'readmex-1.0.0-8.apk', bytes }] };

  function remote({ missingTag = false, tagSha = sha, releaseSha = sha, assets = [], releaseExists = false, badDigest = false } = {}) {
    const state = { writes: [], assets: [...assets], releaseExists };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    const release = () => ({ id: 1, body: `Release notes\n<!-- readmex-source-sha:${releaseSha} -->`, html_url: 'https://github.com/OtterMind/ReadmeX/releases/tag/mobile-v1.0.0', upload_url: 'https://uploads.github.com/repos/OtterMind/ReadmeX/releases/1/assets{?name,label}', assets: state.assets });
    state.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/git/ref/tags/mobile-v1.0.0')) return missingTag ? json({}, 404) : json({ object: { type: 'tag', sha: 'b'.repeat(40) } });
      if (path.endsWith(`/git/tags/${'b'.repeat(40)}`)) return json({ object: { type: 'commit', sha: tagSha } });
      if (path.endsWith('/releases/tags/mobile-v1.0.0')) return state.releaseExists ? json(release()) : json({}, 404);
      if (init.method === 'POST' && path.endsWith('/releases')) {
        state.writes.push({ kind: 'release', data: JSON.parse(init.body) });
        state.releaseExists = true;
        return json(release(), 201);
      }
      if (init.method === 'POST' && path.endsWith('/releases/1/assets')) {
        const name = new URL(url).searchParams.get('name');
        const asset = { id: state.assets.length + 1, name, size: init.body.length, digest: badDigest ? 'sha256:incorrect' : digest, state: 'uploaded', browser_download_url: `https://github.com/OtterMind/ReadmeX/releases/download/mobile-v1.0.0/${name}` };
        state.writes.push({ kind: 'asset', name }); state.assets.push(asset);
        return json(asset, 201);
      }
      if (path.endsWith('/releases/1/assets')) return json(state.assets);
      throw new Error(`Unexpected request: ${init.method || 'GET'} ${path}`);
    };
    return state;
  }

  test('annotated tag creates one source Release with distinct AAB and APK assets', async () => {
    const api = remote();
    const result = await publishSourceRelease({ ...options, fetchImpl: api.fetch });
    assert.equal(api.writes.filter(write => write.kind === 'release').length, 1);
    assert.deepEqual(api.assets.map(asset => asset.name), ['readmex-1.0.0-8.aab', 'readmex-1.0.0-8.apk']);
    assert.match(result.apk_url, /releases\/download\/mobile-v1\.0\.0\/readmex-1\.0\.0-8\.apk$/);
    assert.match(api.writes[0].data.body, new RegExp(marker));
    assert.equal(api.writes[0].data.target_commitish, sha);
  });
  test('deleted tag is never recreated by release publishing', async () => {
    const api = remote({ missingTag: true });
    await assert.rejects(publishSourceRelease({ ...options, fetchImpl: api.fetch }), /tag.*missing/i);
    assert.deepEqual(api.writes, []);
  });
  test('tag pointing at other source refuses all uploads', async () => {
    const api = remote({ tagSha: 'c'.repeat(40) });
    await assert.rejects(publishSourceRelease({ ...options, fetchImpl: api.fetch }), /source.*mismatch/i);
    assert.deepEqual(api.writes, []);
  });
  test('a recreated tag cannot adopt a Release built from previous source', async () => {
    const api = remote({ releaseExists: true, releaseSha: 'c'.repeat(40) });
    await assert.rejects(publishSourceRelease({ ...options, fetchImpl: api.fetch }), /Release.*source/i);
    assert.deepEqual(api.writes, []);
  });
  test('existing matching assets are preserved and a second platform is added', async () => {
    const existing = { id: 9, name: 'readmex-1.0.0-8.aab', size: bytes.length, digest, state: 'uploaded', browser_download_url: 'https://github.com/existing.aab' };
    const api = remote({ releaseExists: true, assets: [existing] });
    await publishSourceRelease({ ...options, fetchImpl: api.fetch });
    assert.deepEqual(api.writes, [{ kind: 'asset', name: 'readmex-1.0.0-8.apk' }]);
    const result = await publishSourceRelease({ ...options, platform: 'ios', artifactType: 'ipa', buildNumber: '4', artifacts: [{ name: 'App.ipa', bytes }], fetchImpl: api.fetch });
    assert.match(result.ipa_url, /readmex-1.0.0-4\.ipa$/);
    assert.equal(api.assets.length, 3);
  });
  test('same asset name with different bytes is never overwritten', async () => {
    const api = remote({ releaseExists: true, assets: [{ id: 9, name: 'readmex-1.0.0-8.aab', size: bytes.length, digest: 'sha256:other', state: 'uploaded' }] });
    await assert.rejects(publishSourceRelease({ ...options, fetchImpl: api.fetch }), /asset.*mismatch/i);
    assert.deepEqual(api.writes, []);
  });
  test('upload receipt with wrong digest cannot report a successful archive', async () => {
    const api = remote({ badDigest: true });
    await assert.rejects(publishSourceRelease({ ...options, fetchImpl: api.fetch }), /asset.*mismatch/i);
  });
  test('selected artifact files must all exist before creating any Release', async () => {
    const api = remote();
    await assert.rejects(publishSourceRelease({ ...options, artifacts: options.artifacts.slice(0, 1), fetchImpl: api.fetch }), /APK.*missing/i);
    assert.deepEqual(api.writes, []);
  });
  test('tag and app version must match', async () => {
    await assert.rejects(publishSourceRelease({ ...options, tag: 'mobile-v1.0.1' }), /tag.*version/i);
  });
  test('historical artifact provenance requires matching source and successful verification', async () => {
    const log = `RELEASE_REF: mobile-v1.0.0\nRELEASE_VERSION: 1.0.0\nRELEASE_BUILD_NUMBER: 8\nRELEASE_SOURCE_SHA: ${sha}\n`;
    const jobs = { jobs: [{ id: 1, name: 'build', steps: [{ name: 'Verify signing and 16 KB compatibility', conclusion: 'success' }, { name: 'Save AAB artifact', conclusion: 'success' }, { name: 'Save APK artifact', conclusion: 'success' }] }, { id: 2, name: 'notify' }] };
    const fetchImpl = async url => new URL(url).pathname.endsWith('/jobs') ? new Response(JSON.stringify(jobs)) : new Response(log);
    await verifyHistoricalArtifacts({ ...options, artifactRunId: '123', currentRunId: '456', pipelineRepo: 'juliet0416/readmex-mobile-pipeline', pipelineToken: 'fixture', fetchImpl });
    await assert.rejects(verifyHistoricalArtifacts({ ...options, sourceSha: 'c'.repeat(40), artifactRunId: '123', currentRunId: '456', pipelineRepo: 'juliet0416/readmex-mobile-pipeline', pipelineToken: 'fixture', fetchImpl }), /provenance.*mismatch/i);
    jobs.jobs[0].steps[0].conclusion = 'failure';
    await assert.rejects(verifyHistoricalArtifacts({ ...options, artifactRunId: '123', currentRunId: '456', pipelineRepo: 'juliet0416/readmex-mobile-pipeline', pipelineToken: 'fixture', fetchImpl }), /verification/i);
  });
}
