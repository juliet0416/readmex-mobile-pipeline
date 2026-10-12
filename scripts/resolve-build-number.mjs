import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeServiceAccount, highestAndroidBuild } from './google-play.mjs';
import { highestIosBuild } from './app-store-connect.mjs';

//#region build-number-resolution
export function nextBuildNumber(platform, override, known = []) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Invalid release platform');
  const number = override ? Number(override) : Math.max(0, ...known) + 1;
  if (override && !/^[1-9]\d*$/.test(override) || !Number.isSafeInteger(number) || number <= 0) throw new Error('Build number must be a positive integer');
  if (platform === 'android' && number > 2100000000) throw new Error('Android build number exceeds the platform limit');
  return String(number);
}

export async function highestArtifactBuild(platform, env = process.env, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('GitHub artifact history credentials are required');
  const pattern = platform === 'android' ? /^android-(?:aab|apk)-\d+\.\d+\.\d+-(\d+)$/ : /^ios-release-\d+\.\d+\.\d+-(\d+)$/;
  let highest = 0;
  for (let page = 1; page <= 100; page++) {
    const response = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/artifacts?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GitHub artifact history HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.artifacts)) throw new Error('Invalid GitHub artifact history response');
    for (const artifact of data.artifacts) {
      const number = Number(pattern.exec(artifact.name)?.[1] ?? 0);
      if (!Number.isSafeInteger(number)) throw new Error('Invalid artifact build number');
      highest = Math.max(highest, number);
    }
    if (data.artifacts.length < 100) return highest;
  }
  throw new Error('Artifact history pagination limit exceeded; use --build-number explicitly');
}

async function main() {
  const platform = process.argv[2];
  const env = process.env;
  let number;
  if (env.BUILD_NUMBER_OVERRIDE) number = nextBuildNumber(platform, env.BUILD_NUMBER_OVERRIDE);
  else {
    const root = process.argv[3];
    const nativeText = readFileSync(join(root, platform === 'android' ? 'android/app/build.gradle' : 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const native = Number((platform === 'android' ? /versionCode\s+(\d+)/ : /CURRENT_PROJECT_VERSION\s*=\s*(\d+);/).exec(nativeText)?.[1]);
    if (!Number.isSafeInteger(native) || native < 1) throw new Error('Unable to read native build number');
    const store = platform === 'android' ? await highestAndroidBuild(decodeServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64), env.APP_PACKAGE_ID) : await highestIosBuild(env);
    const history = await highestArtifactBuild(platform, env);
    number = nextBuildNumber(platform, '', [native, store, history]);
    console.log(`[build-number] native=${native}, store=${store}, artifacts=${history}`);
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `build_number=${number}\n`);
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, `APP_BUILD_NUMBER=${number}\n`);
  console.log(`[build-number] ${platform}=${number}`);
}
//#endregion

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
