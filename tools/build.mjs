import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const staging = join(root, `.dist-staging-${process.pid}`);

/** Every public entrypoint plus the shared runtime. */
const runtimeEntries = [
  'index.html',
  'docs.html',
  'console.html',
  'researchphantom.html',
  'character-story.html',
  'data-motion.html',
  'cast-lab.html',
  'src',
  'public',
];

async function assertExists(path) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Required build input is missing: ${relative(root, path)}`);
  }
}

async function build() {
  for (const entry of runtimeEntries) await assertExists(join(root, entry));
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    for (const entry of runtimeEntries) {
      await cp(join(root, entry), join(staging, entry), { recursive: true, dereference: true });
    }
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    // build-meta.mjs writes build-meta.js and build-manifest.json into dist/.
    await import('./build-meta.mjs');
    await import('./build-verify.mjs');
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

await build();
