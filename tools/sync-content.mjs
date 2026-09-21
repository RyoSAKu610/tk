import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePaperFeed } from '../src/shared/studio-core.js';
import { fetchRemoteResearch } from './research-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = resolve(process.env.RESEARCHPHANTOM_PARENT ?? '/Users/monokuma/Documents/意思ある賢者たちへ');
const feedSource = join(parent, 'src/research-feed.json');
const feedTarget = join(root, 'public/data/research-feed.json');
const soundSource = join(parent, 'assets/audio/page-turns');
const soundTarget = join(root, 'public/audio/page-turns');
const soundFiles = ['manifest.json', 'LICENSES.md', 'paper-01.mp3', 'paper-02.mp3', 'paper-03.mp3', 'paper-04.mp3', 'paper-05.mp3'];

function sameResearchContent(left, right) {
  return left.sourceDate === right.sourceDate && JSON.stringify(left.papers) === JSON.stringify(right.papers);
}

async function syncRemote() {
  const current = JSON.parse(await readFile(feedTarget, 'utf8'));
  const currentPapers = validatePaperFeed(current);
  const remote = await fetchRemoteResearch();
  const remoteFeed = {
    version: 1,
    source: 'https://github.com/howly23v/ResearchPhantom',
    sourceDate: remote.sourceDate,
    syncedAt: new Date().toISOString(),
    quality: { complete: remote.papers.length, total: remote.papers.length },
    papers: remote.papers,
  };
  const remotePapers = validatePaperFeed(remoteFeed);
  const minimumCount = Math.max(75, Math.floor(currentPapers.length * 0.9));
  if (remotePapers.length < minimumCount) {
    throw new Error(`Remote feed shrink rejected: ${remotePapers.length} papers; minimum safe count is ${minimumCount}`);
  }
  const retained = remotePapers.filter((paper) => currentPapers.some((currentPaper) => currentPaper.id === paper.id)).length;
  if (retained < Math.floor(currentPapers.length * 0.8)) {
    throw new Error(`Remote feed identity change rejected: retained ${retained}/${currentPapers.length} current ids`);
  }
  if (sameResearchContent(current, remoteFeed)) {
    console.log(`Remote feed is unchanged (${remotePapers.length} papers)`);
    return;
  }
  await writeFile(feedTarget, `${JSON.stringify(remoteFeed, null, 2)}\n`, 'utf8');
  console.log(`Updated remote feed to ${remotePapers.length} papers (${remote.sourceDate})`);
}

async function syncLocal() {
  const feed = JSON.parse(await readFile(feedSource, 'utf8'));
  const papers = validatePaperFeed(feed);
  await mkdir(dirname(feedTarget), { recursive: true });
  await copyFile(feedSource, feedTarget);
  await mkdir(soundTarget, { recursive: true });
  for (const file of soundFiles) await copyFile(join(soundSource, file), join(soundTarget, basename(file)));
  console.log(`Synced ${papers.length} papers and ${soundFiles.length - 2} page sounds from ${parent}`);
}

if (process.argv.includes('--remote')) await syncRemote();
else await syncLocal();
