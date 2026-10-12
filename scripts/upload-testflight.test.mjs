import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
test('upload receipt verification exists', () => assert.ok(existsSync(new URL('./upload-testflight.mjs', import.meta.url))));
if (existsSync(new URL('./upload-testflight.mjs', import.meta.url))) {
  const { assertUploadSucceeded } = await import('./upload-testflight.mjs');
  test('altool returning zero with UPLOAD FAILED must fail the workflow', () => {
    assert.throws(() => assertUploadSucceeded('UPLOAD FAILED with 2 errors\nValidation failed (409)', 0), /rejected/);
  });
  test('missing positive receipt is an error', () => assert.throws(() => assertUploadSucceeded('Starting upload...', 0), /receipt/));
  test('success receipt with nonzero exit still fails', () => assert.throws(() => assertUploadSucceeded('UPLOAD SUCCEEDED', 1), /exit/));
  test('positive receipt and successful exit are accepted', () => assert.doesNotThrow(() => assertUploadSucceeded('UPLOAD SUCCEEDED with no errors', 0)));
}
