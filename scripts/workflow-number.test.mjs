import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const platform of ['android', 'ios']) test(`${platform} resolves automatic numbers only after source checkout and Node setup`, () => {
  const yaml = readFileSync(new URL(`../.github/workflows/${platform}-release.yml`, import.meta.url), 'utf8');
  const resolve = yaml.indexOf('- name: Resolve release build number');
  assert.ok(yaml.indexOf('path: source') < resolve, 'source checkout must precede the resolver');
  assert.ok(yaml.indexOf('- uses: actions/setup-node@v4') < resolve, 'Node setup must precede the resolver');
  assert.ok(resolve < yaml.indexOf('- name: Prepare '), 'native preparation must use the resolved number');
  assert.match(yaml, /RELEASE_BUILD_NUMBER: \$\{\{ needs\.build\.outputs\.build_number/);
});
