/**
 * Page chrome shared by the landing page, docs and console: design-skin
 * switching (Dash / Terminal), chart theme tokens, UTC clock, mobile menu and
 * a consistent error banner.
 */

import { $, $$, clockUTC, escapeHtml } from './lib.js';
import { describeError } from './api-client.js';

const SKIN_KEY = 'ticksmith:skin';

export function chartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: read('--accent', '#fd592b'),
    accentInk: read('--accent-ink', '#111'),
    accentAlt: read('--accent-alt', '#5aa9ff'),
    up: read('--up', '#16c784'),
    down: read('--down', '#ea3943'),
    upSoft: read('--up-soft', 'rgba(22,199,132,.2)'),
    downSoft: read('--down-soft', 'rgba(234,57,67,.2)'),
    grid: read('--line-soft', 'rgba(255,255,255,.08)'),
    muted: read('--muted', '#8b8b8b'),
    text: read('--text', '#eee'),
    surface: read('--panel', '#141414'),
  };
}

export function applySkin(name) {
  const skin = name === 'terminal' ? 'terminal' : 'dash';
  document.documentElement.dataset.skin = skin;
  for (const button of $$('[data-skin-target]')) button.setAttribute('aria-pressed', String(button.dataset.skinTarget === skin));
  try { localStorage.setItem(SKIN_KEY, skin); } catch { /* storage unavailable: skin still applies */ }
  document.dispatchEvent(new CustomEvent('site:skin', { detail: skin }));
}

export function initChrome() {
  let saved = null;
  try { saved = localStorage.getItem(SKIN_KEY); } catch { /* ignore */ }
  const query = new URLSearchParams(location.search).get('skin');
  applySkin(query || saved || document.documentElement.dataset.skin);
  for (const button of $$('[data-skin-target]')) button.addEventListener('click', () => applySkin(button.dataset.skinTarget));

  const toggle = $('[data-menu-toggle]');
  const nav = $('[data-mobile-nav]');
  const header = toggle?.closest('.site-header');
  if (toggle && nav && header) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      header.classList.toggle('is-open', open);
    });
    for (const link of $$('a', nav)) link.addEventListener('click', () => { toggle.setAttribute('aria-expanded', 'false'); header.classList.remove('is-open'); });
  }

  const tick = () => { for (const node of $$('[data-clock]')) node.textContent = clockUTC(); };
  tick();
  setInterval(tick, 1000);
}

/** Render an error into a host element. Never substitutes data. */
export function showError(host, error, { title = 'Request failed', retry = null } = {}) {
  if (!host) return;
  host.innerHTML = `<div class="error-banner" role="alert">
    <b>${escapeHtml(title)}</b>
    <span>${escapeHtml(describeError(error))}</span>
    ${retry ? '<button type="button" class="btn btn--ghost btn--sm" data-retry>Retry</button>' : ''}
  </div>`;
  if (retry) host.querySelector('[data-retry]').addEventListener('click', retry);
}

/** Small "fetched at / cached" line for a response meta. */
export function provenance(meta, elapsedMs = null) {
  if (!meta) return '';
  const fetched = meta.fetched_at ? meta.fetched_at.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '—';
  const cache = meta.cached ? `cache ${Math.round((meta.age_ms ?? 0) / 100) / 10} s old` : 'fresh';
  const upstream = (meta.upstream_types ?? []).join(', ');
  return `Hyperliquid ${upstream} · fetched ${fetched} · ${cache}${elapsedMs !== null ? ` · ${elapsedMs} ms` : ''}`;
}

/** Decimals for a price so small coins keep significant digits. */
export function pxDecimals(value) {
  const v = Math.abs(Number(value));
  if (!Number.isFinite(v) || v === 0) return 2;
  if (v >= 1000) return 1;
  if (v >= 1) return Math.min(4, Math.max(2, 5 - Math.floor(Math.log10(v)) - 1));
  return Math.min(8, 4 - Math.floor(Math.log10(v)));
}
