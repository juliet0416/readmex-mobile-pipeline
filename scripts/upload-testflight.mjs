import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function assertUploadSucceeded(log, exitStatus) {
  // altool 曾在上传被拒绝时仍返回 0，因此必须同时验证正向回执。
  if (/UPLOAD FAILED|Failed to upload package|Validation failed|"product-errors"/i.test(log)) throw new Error('Apple rejected the upload; see the altool receipt above');
  if (exitStatus !== 0) throw new Error(`altool exit status: ${exitStatus}`);
  if (!/UPLOAD SUCCEEDED|Upload succeeded|No errors uploading/i.test(log)) throw new Error('Missing positive Apple upload receipt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('xcrun', ['altool', '--upload-package', process.argv[2], '--api-key', process.env.ASC_KEY_ID, '--api-issuer', process.env.ASC_ISSUER_ID], { encoding: 'utf8', timeout: 14 * 60000, maxBuffer: 10 * 1024 * 1024 });
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  process.stdout.write(log);
  try { assertUploadSucceeded(log, result.status); console.log('[upload] Apple success receipt verified'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
