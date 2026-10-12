import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appRoot = resolve(process.argv[2]);
const version = process.env.APP_VERSION;
const buildNumber = process.env.APP_BUILD_NUMBER;
if (!appRoot || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^\d+$/.test(buildNumber ?? '')) {
  throw new Error('APP_VERSION and APP_BUILD_NUMBER are required');
}

const projectPath = join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj');
let project = readFileSync(projectPath, 'utf8');
project = project.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
project = project.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
writeFileSync(projectPath, project);

const entitlementsPath = join(appRoot, 'ios/App/App/App.entitlements');
let entitlements = readFileSync(entitlementsPath, 'utf8');
entitlements = entitlements.replace(/<key>aps-environment<\/key>\s*<string>[^<]+<\/string>/, '<key>aps-environment</key>\n\t<string>production</string>');
writeFileSync(entitlementsPath, entitlements);

console.log('[prepare] iOS version and production push entitlement prepared');
