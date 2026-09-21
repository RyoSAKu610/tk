import {
  loadPapers,
  createPaperNavigator,
  createPageSoundController,
  persistLibrary,
} from '../shared/studio-core.js';
import { buildMotionModel } from './motion-model.js';

const CHAPTER_DURATION = 6;
const CHAPTER_COUNT = 6;
const TOTAL_DURATION = CHAPTER_DURATION * CHAPTER_COUNT;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const REVIEWED_KEY = 'research-phantom-studio:reviewed:v1';
const LEGACY_REVIEWED_KEY = 'researchphantom-studio-read-v1';

const el = Object.fromEntries(
  [
    'app','paper-search','paper-list','result-count','all-count','favorite-count','unread-count','paper-count-heading','paper-index','paper-category','paper-title','paper-meta','favorite-button','read-button','source-link',
    'visual-stage','chapter-number','chapter-label','chapter-title','chapter-body','chapter-tabs','timeline-scrubber','scrubber-fill','time-current','time-total','play-button','previous-step','next-step','playback-speed',
    'primary-line','comparison-line','confidence-area','data-points','effect-value','effect-dot','effect-number','metric-effect','metric-confidence','metric-samples','metric-direction','metric-effect-note','metric-direction-note','metric-grid','paper-result','method-list','result-heading','method-heading',
    'download-props','sound-select','sound-volume','volume-output','sound-preview','sound-status','progress-ring','read-percent','read-total','saved-total','mobile-library-button','paper-rail','rail-close','rail-backdrop','demo-video','video-fallback','toast'
  ].map((id) => [id.replaceAll('-', '_'), document.getElementById(id)])
);

const state = {
  papers: [],
  filtered: [],
  selected: null,
  selectedIndex: 0,
  filter: 'all',
  query: '',
  progress: 0,
  playing: false,
  speed: 1,
  lastFrame: 0,
  raf: 0,
  navigator: null,
  sound: null,
  favorites: null,
  reads: null,
  motion: null,
  toastTimer: 0,
  scrubbing: false,
  railReturnFocus: null,
  demoVideoFailed: false,
};

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function esc(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function text(value, fallback = '') { const result = String(value ?? '').trim(); return result || fallback; }
function formatTime(seconds) { const safe = clamp(seconds, 0, TOTAL_DURATION); return `${String(Math.floor(safe / 60)).padStart(2,'0')}:${String(Math.floor(safe % 60)).padStart(2,'0')}`; }

function requestedPaperIndex(papers) {
  const requestedId = new URLSearchParams(location.search).get('paper');
  if (!requestedId) return 0;
  const index = papers.findIndex((paper) => paper.id === requestedId);
  return index >= 0 ? index : 0;
}

function syncPaperUrl(paper) {
  const url = new URL(location.href);
  if (url.searchParams.get('paper') === paper.id) return;
  url.searchParams.set('paper', paper.id);
  history.replaceState({ paperId: paper.id }, '', url);
}

function paperAuthors(paper) {
  const authors = Array.isArray(paper.authors) ? paper.authors.filter(Boolean) : [];
  return authors.length ? authors.join(', ') : text(paper.source, 'ResearchPhantom');
}

function paperCategories(paper) {
  const categories = Array.isArray(paper.categories) ? paper.categories.filter(Boolean) : [];
  return categories.length ? categories : ['Research'];
}

function pointToSvg(point, key) {
  return { x: 120 + point.t * 720, y: 420 - point[key] * 3.3 };
}

function pathFromPoints(points, key) {
  return points.map((point,index) => { const p = pointToSvg(point,key); return `${index ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(' ');
}

function buildChart(model) {
  const primaryPath = pathFromPoints(model.schematicPoints,'primary');
  const comparisonPath = pathFromPoints(model.schematicPoints,'comparison');
  const upper = model.schematicPoints.map((point) => ({...point,primary:clamp(point.primary + 7,0,100)}));
  const lower = [...model.schematicPoints].reverse().map((point) => ({...point,primary:clamp(point.primary - 7,0,100)}));
  const areaPath = `${pathFromPoints(upper,'primary')} ${lower.map((point) => {const p=pointToSvg(point,'primary');return `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;}).join(' ')} Z`;
  el.primary_line.setAttribute('d',primaryPath);
  el.comparison_line.setAttribute('d',comparisonPath);
  el.confidence_area.setAttribute('d',areaPath);
  el.data_points.innerHTML = model.schematicPoints.map((point) => {
    const a=pointToSvg(point,'primary'),b=pointToSvg(point,'comparison');
    return `<circle class="data-point" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="5"></circle><circle class="data-point comparison" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="3"></circle>`;
  }).join('');
  for (const path of [el.primary_line,el.comparison_line]) {
    const length = path.getTotalLength?.() || 900;
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.dataset.length = String(length);
  }
}

function renderPaperList() {
  const query = state.query.trim().toLocaleLowerCase('ja');
  state.filtered = state.papers.filter((paper) => {
    const matchesFilter = state.filter === 'favorites' ? state.favorites.has(paper.id) : state.filter === 'unread' ? !state.reads.has(paper.id) : true;
    if (!matchesFilter) return false;
    if (!query) return true;
    const haystack = [paper.title,paper.summary,paper.problem,paper.result,paper.impact,paperAuthors(paper),...paperCategories(paper),...(paper.methods || [])].join(' ').toLocaleLowerCase('ja');
    return haystack.includes(query);
  });
  el.result_count.textContent = `${state.filtered.length}件を表示`;
  if (!state.filtered.length) {
    el.paper_list.innerHTML = '<li class="empty-list">条件に合う論文がありません。<br>検索語やフィルターを変更してください。</li>';
    return;
  }
  el.paper_list.innerHTML = state.filtered.map((paper) => {
    const index = state.papers.findIndex((item) => item.id === paper.id);
    const active = state.selected?.id === paper.id;
    const favorite = state.favorites.has(paper.id);
    return `<li><button class="paper-item${active ? ' is-active' : ''}" type="button" data-paper-id="${esc(paper.id)}" ${active ? 'aria-current="true"' : ''}><span>${String(index + 1).padStart(2,'0')}</span><span><strong>${esc(paper.title)}</strong><small>${esc(paperCategories(paper).join(' / '))}</small></span><span class="paper-state${favorite ? ' is-favorite' : ''}" aria-label="${favorite ? 'お気に入り' : ''}">${favorite ? '★' : state.reads.has(paper.id) ? '●' : '○'}</span></button></li>`;
  }).join('');
}

function renderLibraryStats() {
  const favoriteCount = state.papers.filter((paper) => state.favorites.has(paper.id)).length;
  const readCount = state.papers.filter((paper) => state.reads.has(paper.id)).length;
  const percent = state.papers.length ? Math.round(readCount / state.papers.length * 100) : 0;
  el.paper_count_heading.textContent = `${state.papers.length} papers`;
  el.all_count.textContent = String(state.papers.length);
  el.favorite_count.textContent = String(favoriteCount);
  el.unread_count.textContent = String(state.papers.length - readCount);
  el.saved_total.textContent = String(favoriteCount);
  el.read_total.textContent = `${readCount} / ${state.papers.length}`;
  el.read_percent.textContent = `${percent}%`;
  el.progress_ring.style.setProperty('--progress', String(percent));
}

function selectPaper(paper, { fromNavigator = false, playSound = true } = {}) {
  if (!paper) return;
  const index = state.papers.findIndex((item) => item.id === paper.id);
  if (index < 0) return;
  state.selected = paper;
  state.selectedIndex = index;
  state.motion = buildMotionModel(paper);
  syncPaperUrl(paper);
  const handoff = document.querySelector('[data-paper-handoff]');
  if (handoff) handoff.href = `./character-story.html?paper=${encodeURIComponent(paper.id)}`;
  state.progress = 0;
  state.playing = false;
  updatePlayButton();
  if (!fromNavigator && state.navigator?.getIndex() !== index) state.navigator.goTo(index);

  el.paper_index.textContent = `PAPER ${String(index + 1).padStart(2,'0')} / ${String(state.papers.length).padStart(2,'0')}`;
  el.paper_category.textContent = paperCategories(paper)[0].toUpperCase();
  el.paper_title.textContent = paper.title;
  el.paper_meta.textContent = [paperAuthors(paper),paper.published,text(paper.source)].filter(Boolean).join(' · ');
  el.source_link.href = text(paper.link,'https://howly23v.github.io/ResearchPhantom/');
  el.source_link.toggleAttribute('aria-disabled',!paper.link);
  el.favorite_button.setAttribute('aria-pressed',String(state.favorites.has(paper.id)));
  el.favorite_button.querySelector('span').textContent = state.favorites.has(paper.id) ? '★' : '☆';
  el.read_button.setAttribute('aria-pressed',String(state.reads.has(paper.id)));
  el.read_button.querySelector('span').textContent = state.reads.has(paper.id) ? '●' : '○';
  el.paper_result.textContent = state.motion.result;
  const sectionsUnverified = state.motion.sectionClassification === 'unverified';
  el.result_heading.textContent = sectionsUnverified ? '結果は原文で確認' : '結論を一文で';
  el.method_heading.textContent = sectionsUnverified ? '要旨の区分は未確認' : 'どう確かめたか';
  el.method_list.innerHTML = state.motion.methods.map((method) => `<li>${esc(method)}</li>`).join('');
  el.metric_effect.textContent = state.motion.evidence.resultType;
  el.metric_confidence.textContent = state.motion.evidence.metricValue;
  el.metric_samples.textContent = state.motion.evidence.sampleValue;
  el.metric_direction.textContent = state.motion.evidence.interpretationValue;
  el.metric_effect_note.textContent = state.motion.evidence.hasStructuredMetric ? 'feed.metric に記載' : '要旨の記述';
  el.metric_direction_note.textContent = state.motion.evidence.hasStructuredMetric ? paperCategories(paper)[0] : '断定を避ける';
  const meters = state.motion.evidence.hasStructuredMetric ? [72,64,58,52] : [38,20,12,16];
  [...el.metric_grid.children].forEach((card,cardIndex) => card.style.setProperty('--meter',`${meters[cardIndex]}%`));
  buildChart(state.motion);
  renderMotion();
  const hasMatchingDemo = paper.id === 'rp-uk37f0' && !state.demoVideoFailed;
  el.demo_video.hidden = !hasMatchingDemo;
  el.video_fallback.hidden = hasMatchingDemo;
  const fallbackTitle = el.video_fallback.querySelector('strong');
  const fallbackBody = el.video_fallback.querySelector('p');
  if (paper.id === 'rp-uk37f0') {
    fallbackTitle.textContent = state.demoVideoFailed ? '動画を読み込めませんでした' : '先頭論文の完成デモ';
    fallbackBody.textContent = '上のライブモーションは引き続き操作できます。';
  } else {
    fallbackTitle.textContent = 'この論文の完成動画は未生成です';
    fallbackBody.textContent = 'Paper 01の動画を流用せず、上のライブモーションを選択論文の内容で再構成しています。';
  }
  renderPaperList();
  el.paper_list.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});
  if (playSound) state.sound?.play().catch(() => {});
  if (innerWidth <= 760) closeRail();
}

function renderMotion() {
  if (!state.motion) return;
  const elapsed = clamp(state.progress,0,1) * TOTAL_DURATION;
  const chapterIndex = clamp(Math.floor(elapsed / CHAPTER_DURATION),0,CHAPTER_COUNT - 1);
  const chapterElapsed = elapsed - chapterIndex * CHAPTER_DURATION;
  const local = clamp(chapterElapsed / CHAPTER_DURATION,0,1);
  const chapter = state.motion.chapters[chapterIndex];
  el.visual_stage.dataset.step = String(chapterIndex);
  el.visual_stage.style.setProperty('--stage-progress',String(local));
  el.chapter_number.textContent = `${String(chapterIndex + 1).padStart(2,'0')} / 06`;
  el.chapter_label.textContent = chapter.label;
  el.chapter_title.textContent = chapter.title;
  el.chapter_body.textContent = chapter.body;
  el.timeline_scrubber.value = String(Math.round(state.progress * 1000));
  el.scrubber_fill.style.setProperty('--fill',`${state.progress * 100}%`);
  el.time_current.textContent = formatTime(elapsed);
  [...el.chapter_tabs.querySelectorAll('button')].forEach((button,index) => index === chapterIndex ? button.setAttribute('aria-current','step') : button.removeAttribute('aria-current'));

  const pipelineProgress = chapterIndex === 1 ? local : chapterIndex === 2 ? 1 : 0;
  document.querySelectorAll('.pipeline-node').forEach((node,index) => node.classList.toggle('is-active',index <= Math.floor(pipelineProgress * 4)));
  const chartProgress = chapterIndex === 3 ? ease(local) : chapterIndex > 3 ? 1 : 0;
  for (const path of [el.primary_line,el.comparison_line]) {
    const length = Number(path.dataset.length || 900);
    path.style.strokeDashoffset = String(length * (1 - chartProgress));
  }
  el.data_points.style.opacity = String(clamp(chartProgress * 1.8 - .5,0,1));
  const resultProgress = chapterIndex === 4 ? ease(local) : chapterIndex > 4 ? 1 : 0;
  el.effect_value.style.opacity = String(.12 + resultProgress * .88);
  el.effect_dot.style.opacity = String(.18 + resultProgress * .82);
  el.effect_number.textContent = state.motion.evidence.resultType;
}

function ease(value) { return value < .5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2; }

function tick(now) {
  if (!state.playing) return;
  if (!state.lastFrame) state.lastFrame = now;
  const delta = Math.min(.1,(now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.progress += delta * state.speed / TOTAL_DURATION;
  if (state.progress >= 1) { state.progress = 1; state.playing = false; updatePlayButton(); }
  renderMotion();
  if (state.playing) state.raf = requestAnimationFrame(tick);
}

function setPlaying(playing) {
  if (playing && state.progress >= .999) state.progress = 0;
  state.playing = Boolean(playing);
  state.lastFrame = 0;
  cancelAnimationFrame(state.raf);
  updatePlayButton();
  if (state.playing) state.raf = requestAnimationFrame(tick);
}

function updatePlayButton() {
  el.play_button.setAttribute('aria-pressed',String(state.playing));
  el.play_button.setAttribute('aria-label',state.playing ? 'データストーリーを一時停止' : 'データストーリーを再生');
  el.play_button.querySelector('span').textContent = state.playing ? '停止' : '再生';
}

function goToChapter(index,{play = false} = {}) {
  const safe = clamp(index,0,CHAPTER_COUNT - 1);
  state.progress = safe * CHAPTER_DURATION / TOTAL_DURATION + .00001;
  renderMotion();
  if (play) setPlaying(true);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  state.toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'),2200);
}

function railFocusables() {
  return [...el.paper_rail.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]')]
    .filter((node) => !node.hidden && node.getClientRects().length > 0);
}

function syncRailAccessibility() {
  const mobile = innerWidth <= 760;
  const open = el.paper_rail.classList.contains('is-open');
  el.paper_rail.inert = mobile && !open;
  if (mobile) {
    el.paper_rail.setAttribute('role', 'dialog');
    el.paper_rail.setAttribute('aria-hidden', String(!open));
    el.paper_rail.setAttribute('aria-modal', String(open));
  } else {
    el.paper_rail.removeAttribute('role');
    el.paper_rail.removeAttribute('aria-hidden');
    el.paper_rail.removeAttribute('aria-modal');
    el.rail_backdrop.hidden = true;
  }
}

function closeRail({ restoreFocus = true } = {}) {
  const wasOpen = el.paper_rail.classList.contains('is-open');
  el.paper_rail.classList.remove('is-open');
  el.mobile_library_button.setAttribute('aria-expanded','false');
  el.rail_backdrop.hidden = true;
  syncRailAccessibility();
  if (wasOpen && restoreFocus) (state.railReturnFocus ?? el.mobile_library_button).focus?.();
  state.railReturnFocus = null;
}

function openRail() {
  state.railReturnFocus = document.activeElement;
  el.paper_rail.classList.add('is-open');
  el.mobile_library_button.setAttribute('aria-expanded','true');
  el.rail_backdrop.hidden = false;
  syncRailAccessibility();
  el.paper_search.focus();
}

function exportProps() {
  if (!state.selected || !state.motion) return;
  const payload = {
    schemaVersion: 1,
    composition: 'ResearchDataMotion',
    generatedAt: new Date().toISOString(),
    paper: {
      id: state.selected.id,
      title: state.selected.title,
      authors: state.selected.authors || [],
      source: state.selected.source || '',
      link: state.selected.link || '',
      categories: paperCategories(state.selected),
    },
    narrative: state.motion.chapters.map(({key,label,title,body},index) => ({index,key,label,title,body,durationInSeconds:CHAPTER_DURATION})),
    evidence: {
      hasStructuredMetric: state.motion.evidence.hasStructuredMetric,
      rawMetric: state.motion.evidence.rawMetric,
      rawViz: state.motion.evidence.rawViz,
    },
    schematicSeries: state.motion.schematicPoints,
    disclaimer: 'The series is an explanatory schematic, not measured data. Verify exact statistics in the original paper.',
  };
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${String(state.selected.id).replace(/[^a-z0-9_-]/gi,'-')}-data-motion-props.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),0);
  showToast('Remotion用Props JSONを書き出しました');
}

async function setupSound() {
  try {
    state.sound = await createPageSoundController();
    const sounds = state.sound.listSounds();
    el.sound_select.insertAdjacentHTML('beforeend',sounds.map((sound,index) => `<option value="${esc(sound.id)}">${index + 1}. ${esc(sound.label || sound.name || sound.id)}</option>`).join(''));
    const saved = state.sound.getState();
    el.sound_select.value = saved.mode === 'manual' ? saved.selectedId : 'random';
    el.sound_volume.value = String(saved.volume);
    el.volume_output.value = `${Math.round(saved.volume * 100)}%`;
    el.sound_status.textContent = `${sounds.length}種類のページ音を利用できます`;
    state.sound.subscribe?.((soundState) => {
      el.sound_select.value = soundState.mode === 'manual' ? soundState.selectedId : 'random';
      el.sound_volume.value = String(soundState.volume);
      el.volume_output.value = `${Math.round(soundState.volume * 100)}%`;
      if (soundState.playing) el.sound_status.textContent = `${text(soundState.currentId,'ページ音')} を再生中`;
      else if (soundState.currentId) el.sound_status.textContent = `${sounds.length}種類のページ音を利用できます`;
    });
  } catch (error) {
    console.warn('Page sound unavailable',error);
    el.sound_status.textContent = '音源は最初の操作時に合成します';
  }
}

function bindEvents() {
  el.paper_search.addEventListener('input',(event) => { state.query = event.currentTarget.value; renderPaperList(); });
  el.paper_list.addEventListener('click',(event) => { const button = event.target.closest('[data-paper-id]'); if (button) state.navigator.goToId(button.dataset.paperId); });
  document.querySelector('.rail-filters').addEventListener('click',(event) => {
    const button = event.target.closest('[data-filter]'); if (!button) return;
    state.filter = button.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((chip) => { const active=chip === button; chip.classList.toggle('is-active',active); chip.setAttribute('aria-pressed',String(active)); });
    renderPaperList();
  });
  el.favorite_button.addEventListener('click',() => {
    state.favorites.toggle(state.selected);
    const saved = state.favorites.has(state.selected.id);
    el.favorite_button.setAttribute('aria-pressed',String(saved));
    el.favorite_button.querySelector('span').textContent = saved ? '★' : '☆';
    renderLibraryStats(); renderPaperList(); showToast(saved ? '知識棚のお気に入りへ保存しました' : 'お気に入りから外しました');
  });
  el.read_button.addEventListener('click',() => {
    state.reads.toggle(state.selected);
    const read = state.reads.has(state.selected.id);
    el.read_button.setAttribute('aria-pressed',String(read));
    el.read_button.querySelector('span').textContent = read ? '●' : '○';
    renderLibraryStats(); renderPaperList(); showToast(read ? '既読として記録しました' : '未読に戻しました');
  });
  el.play_button.addEventListener('click',() => setPlaying(!state.playing));
  el.previous_step.addEventListener('click',() => goToChapter(Math.floor(state.progress * CHAPTER_COUNT - .001) - 1));
  el.next_step.addEventListener('click',() => goToChapter(Math.floor(state.progress * CHAPTER_COUNT + .001) + 1));
  el.chapter_tabs.addEventListener('click',(event) => { const button = event.target.closest('[data-step]'); if (button) goToChapter(Number(button.dataset.step),{play:false}); });
  el.timeline_scrubber.addEventListener('input',(event) => { state.progress = Number(event.currentTarget.value) / 1000; renderMotion(); });
  el.timeline_scrubber.addEventListener('pointerdown',() => { state.scrubbing = state.playing; setPlaying(false); });
  el.timeline_scrubber.addEventListener('change',() => { if (state.scrubbing) setPlaying(true); state.scrubbing = false; });
  el.playback_speed.addEventListener('change',(event) => { state.speed = Number(event.currentTarget.value); showToast(`再生速度を ${state.speed}× に変更しました`); });
  el.download_props.addEventListener('click',exportProps);
  el.sound_select.addEventListener('change',(event) => {
    if (!state.sound) return;
    if (event.currentTarget.value === 'random') state.sound.setMode('random');
    else { state.sound.setMode('manual'); state.sound.select(event.currentTarget.value); }
    state.sound.play().catch(() => {});
  });
  el.sound_volume.addEventListener('input',(event) => { const volume=Number(event.currentTarget.value); el.volume_output.value=`${Math.round(volume * 100)}%`; state.sound?.setVolume(volume); });
  el.sound_preview.addEventListener('click',() => state.sound?.play().catch(() => { el.sound_status.textContent='再生できませんでした'; }));
  el.mobile_library_button.addEventListener('click',() => el.paper_rail.classList.contains('is-open') ? closeRail() : openRail());
  el.rail_close.addEventListener('click',closeRail); el.rail_backdrop.addEventListener('click',closeRail);
  el.demo_video.addEventListener('error',() => {
    state.demoVideoFailed = true;
    if (state.selected?.id === 'rp-uk37f0') {
      el.video_fallback.querySelector('strong').textContent = '動画を読み込めませんでした';
      el.video_fallback.querySelector('p').textContent = '上のライブモーションは引き続き操作できます。';
      el.video_fallback.hidden = false;
      el.demo_video.hidden = true;
    }
  });
  window.addEventListener('resize',syncRailAccessibility);
  document.addEventListener('keydown',(event) => {
    const railOpen = innerWidth <= 760 && el.paper_rail.classList.contains('is-open');
    if (event.key === 'Escape' && railOpen) {
      event.preventDefault();
      closeRail();
      return;
    }
    if (event.key === 'Tab' && railOpen) {
      const focusable = railFocusables();
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
    if (event.key === '/' && !typing) { event.preventDefault(); if (innerWidth <= 760) openRail(); el.paper_search.focus(); }
    if (typing) return;
    if (event.code === 'Space') { event.preventDefault(); setPlaying(!state.playing); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); goToChapter(Math.floor(state.progress * CHAPTER_COUNT - .001) - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goToChapter(Math.floor(state.progress * CHAPTER_COUNT + .001) + 1); }
  });
}

async function init() {
  syncRailAccessibility();
  try {
    state.favorites = persistLibrary();
    state.reads = persistLibrary({storageKey:REVIEWED_KEY});
    const legacyReads = persistLibrary({storageKey:LEGACY_REVIEWED_KEY});
    const legacyEntries = legacyReads.list();
    if (legacyEntries.length) {
      for (const entry of legacyEntries) {
        if (!state.reads.has(entry.id)) state.reads.add(entry);
      }
      legacyReads.clear();
    }
    const papers = await loadPapers();
    if (!Array.isArray(papers) || !papers.length) throw new Error('論文フィードが空です');
    state.papers = papers;
    state.navigator = createPaperNavigator(papers,{initialIndex:requestedPaperIndex(papers),onChange:(change) => selectPaper(change?.paper ?? change,{fromNavigator:true})});
    bindEvents();
    syncRailAccessibility();
    renderLibraryStats();
    selectPaper(state.navigator.current(),{fromNavigator:true,playSound:false});
    await setupSound();
    el.time_total.textContent = formatTime(TOTAL_DURATION);
    el.app.dataset.state = 'ready';
    if (!REDUCED_MOTION) setTimeout(() => setPlaying(true),520);
  } catch (error) {
    console.error(error);
    el.app.dataset.state = 'error';
    document.querySelector('.topbar').inert = true;
    document.querySelector('.workspace').inert = true;
    const loading = document.getElementById('loading-screen');
    const heading = document.createElement('strong');
    const detail = document.createElement('span');
    const retry = document.createElement('button');
    heading.textContent = 'データを読み込めませんでした';
    detail.textContent = error instanceof Error ? error.message : '不明な読み込みエラー';
    retry.type = 'button';
    retry.textContent = '再読み込み';
    retry.addEventListener('click',() => location.reload());
    loading.replaceChildren(heading,detail,retry);
    retry.focus();
  }
}

init();
