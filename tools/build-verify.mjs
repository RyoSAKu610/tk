import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('build-manifest.json', dist), 'utf8'));
const failures = [];
if (manifest.schemaVersion !== 1) failures.push(`schemaVersion is ${manifest.schemaVersion}`);
if (!Array.isArray(manifest.files) || manifest.files.length < 20) failures.push('manifest file list is too short');
for (const entry of manifest.files ?? []) {
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) { failures.push(`${entry.file}: bad hash`); continue; }
  let contents;
  try {
    contents = await readFile(new URL(entry.file, dist));
  } catch {
    failures.push(`${entry.file}: missing from dist`);
    continue;
  }
  const digest = createHash('sha256').update(contents).digest('hex');
  if (digest !== entry.sha256) failures.push(`${entry.file}: hash mismatch`);
  if (contents.byteLength !== entry.bytes) failures.push(`${entry.file}: byte length changed`);
}
if (failures.length) {
  console.error(`Build verification failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`Build verified: ${manifest.files.length} files match build-manifest.json`);
