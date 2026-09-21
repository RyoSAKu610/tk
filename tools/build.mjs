import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const staging = join(root, `.dist-staging-${process.pid}`);
const runtimeEntries = ['index.html', 'character-story.html', 'data-motion.html', 'cast-lab.html', 'src', 'public'];

async function assertExists(path) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Required build input is missing: ${relative(root, path)}`);
  }
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function build() {
  for (const entry of runtimeEntries) await assertExists(join(root, entry));
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    for (const entry of runtimeEntries) {
      await cp(join(root, entry), join(staging, entry), { recursive: true, dereference: true });
    }
    await writeFile(join(staging, '.nojekyll'), '', 'utf8');

    const files = (await walkFiles(staging))
      .filter((path) => !path.endsWith('build-manifest.json'))
      .sort((a, b) => a.localeCompare(b));
    const manifest = [];
    for (const path of files) {
      const contents = await readFile(path);
      manifest.push({
        file: relative(staging, path).split('\\').join('/'),
        bytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      });
    }
    await writeFile(join(staging, 'build-manifest.json'), `${JSON.stringify({ schemaVersion: 1, files: manifest }, null, 2)}\n`, 'utf8');

    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    const totalBytes = manifest.reduce((sum, item) => sum + item.bytes, 0);
    console.log(`Built ${manifest.length} files (${(totalBytes / 1_048_576).toFixed(1)} MiB) into dist/`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

await build();
