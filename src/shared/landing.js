import { createPageSoundController, loadPapers, persistLibrary } from './studio-core.js';

const paperCount = document.querySelector('#paper-count');
const verifiedCount = document.querySelector('#verified-count');
const latestPaper = document.querySelector('#latest-paper');
const libraryCount = document.querySelector('#library-count');
const choice = document.querySelector('#sound-choice');
const preview = document.querySelector('#sound-preview');
const status = document.querySelector('#sound-status');
const syncNotice = document.querySelector('#sync-notice');

const library = persistLibrary();
const renderLibraryCount = () => {
  libraryCount.textContent = `本棚 ${library.list().length}冊`;
};
renderLibraryCount();
library.subscribe(renderLibraryCount);

loadPapers()
  .then((papers) => {
    paperCount.textContent = `全 ${papers.length} 篇`;
    const verified = papers.filter((paper) => paper?.dataQuality?.sectionClassification === 'verified').length;
    verifiedCount.textContent = `${verified} / ${papers.length} 篇`;
    syncNotice.textContent = `日次更新は論文フィードのみ · 手動確認済み ${verified} / ${papers.length} 篇 · 音声・動画・AIモーションは原文確認とレビュー後に追加`;
    const dated = papers.filter((paper) => paper.published).sort((a, b) => b.published.localeCompare(a.published));
    latestPaper.textContent = dated[0] ? `${dated[0].published} 刷` : '同期済み';
  })
  .catch(() => {
    paperCount.textContent = '読込に失敗';
    verifiedCount.textContent = '確認状況を読込失敗';
    syncNotice.textContent = '日次更新の対象は論文フィードのみです。音声・動画はレビュー後に追加します。';
    latestPaper.textContent = '論文データを読み込めませんでした';
  });

createPageSoundController()
  .then((controller) => {
    choice.replaceChildren();
    const random = document.createElement('option');
    random.value = 'random';
    random.textContent = 'ランダム（直前回避）';
    choice.append(random);
    for (const sound of controller.listSounds()) {
      const option = document.createElement('option');
      option.value = sound.id;
      option.textContent = sound.label;
      choice.append(option);
    }
    const state = controller.getState();
    choice.value = state.mode === 'manual' ? state.selectedId : 'random';
    choice.disabled = false;
    preview.disabled = false;
    status.textContent = '試聴できます';
    choice.addEventListener('change', () => {
      if (choice.value === 'random') controller.setMode('random');
      else controller.select(choice.value);
      status.textContent = choice.selectedOptions[0]?.textContent ?? '選択済み';
    });
    preview.addEventListener('click', async () => {
      preview.disabled = true;
      status.textContent = '再生中…';
      const result = await controller.play();
      const sound = controller.listSounds().find((item) => item.id === result.id);
      status.textContent = result.fallback ? '代替音で再生しました' : `${sound?.label ?? result.id} を再生`;
      preview.disabled = false;
    });
  })
  .catch(() => {
    choice.disabled = true;
    preview.disabled = true;
    status.textContent = '音源を読み込めませんでした';
  });
