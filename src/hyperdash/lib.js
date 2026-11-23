/**
 * Small, dependency-free helpers shared by every Hyperdash demo section.
 */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Price with market-appropriate decimals, grouped. */
export function price(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('en-US', { minimumFractionDigits: Math.min(decimals, 2), maximumFractionDigits: decimals });
}

export function money(value, { compact: useCompact = false, decimals = 2 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  if (useCompact) return `$${compact.format(numeric)}`;
  return Math.abs(numeric) >= 100 ? usdWhole.format(numeric) : usd.format(numeric);
}

export function signedMoney(value, options) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${money(Math.abs(numeric), options)}`;
}

export function compactNumber(value, decimals = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return compact.format(numeric).replace('.0', '').replace(/([A-Z])$/, ' $1').replace(/\s/g, '').replace(/(\d)([A-Z])/g, `$1${''}`) || decimal.format(numeric);
}

export function percent(value, { sign = true, decimals = 2 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const prefix = sign && numeric > 0 ? '+' : numeric < 0 ? '−' : '';
  return `${prefix}${Math.abs(numeric).toFixed(decimals)}%`;
}

export function integer(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric).toLocaleString('en-US') : '—';
}

export function timeUTC(ms, { seconds = false } = {}) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().replace('T', ' ').replace(seconds ? /\.\d+Z$/ : /:\d{2}\.\d+Z$/, '').replace('Z', ' UTC');
}

export function clockUTC(ms = Date.now()) {
  const date = new Date(ms);
  return `${date.toISOString().slice(11, 19)} UTC`;
}

export function ago(ms, reference = Date.now()) {
  const delta = Math.max(0, reference - ms);
  if (delta < 1_000) return `${delta} ms ago`;
  if (delta < 60_000) return `${Math.round(delta / 1_000)} s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} h ago`;
  return `${Math.round(delta / 86_400_000)} d ago`;
}

export function bytesLabel(count) {
  if (count < 1_024) return `${count} B`;
  if (count < 1_048_576) return `${(count / 1_024).toFixed(1)} KB`;
  return `${(count / 1_048_576).toFixed(2)} MB`;
}

/** Colorise JSON without a parser dependency: tokenises the already-valid string. */
export function highlightJson(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?/g, (match, string, colon) => (
      colon
        ? `<span class="tok-key">${string}</span><span class="tok-punct">${colon}</span>`
        : `<span class="tok-string">${string}</span>`
    ))
    .replace(/\b(true|false|null)\b/g, '<span class="tok-bool">$1</span>')
    .replace(/(:\s*)(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi, '$1<span class="tok-number">$2</span>')
    .replace(/([[\]{}])/g, '<span class="tok-punct">$1</span>');
}

export function highlightShell(value) {
  return escapeHtml(value)
    .replace(/(^|\n)(curl|export|npm|npx|node|python|pip|claude|import|const|await|from)(\b)/g, '$1<span class="tok-keyword">$2</span>')
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="tok-string">$1</span>')
    .replace(/(\s)(-H|--header|\\)(\s|$)/g, '$1<span class="tok-flag">$2</span>$3')
    .replace(/\b(hdk_sk_[A-Za-z0-9_…]+)\b/g, '<span class="tok-secret">$1</span>');
}

export async function copyText(text, { label = 'Copied' } = {}) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast(label);
    return true;
  } catch {
    toast('Copy failed — select the text manually');
    return false;
  }
}

let toastHost = null;
export function toast(message, { tone = 'ok', timeout = 2_600 } = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: `toast toast--${tone}` }, message);
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(() => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 240);
  }, timeout);
}

export function debounce(fn, wait = 140) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function onVisible(node, callback, { threshold = 0.18, once = true } = {}) {
  if (!('IntersectionObserver' in window)) { callback(); return () => {}; }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      callback(entry);
      if (once) observer.disconnect();
    }
  }, { threshold });
  observer.observe(node);
  return () => observer.disconnect();
}

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Select element with grouping from an option list. */
export function fillSelect(select, options, { value = null } = {}) {
  select.innerHTML = '';
  for (const option of options) {
    if (option.group) {
      const group = el('optgroup', { label: option.group });
      for (const child of option.options) {
        group.append(el('option', { value: child.value, selected: child.value === value || undefined }, child.label));
      }
      select.append(group);
      continue;
    }
    select.append(el('option', { value: option.value, selected: option.value === value || undefined }, option.label));
  }
  if (value !== null) select.value = value;
  return select;
}

export function splitPath(path) {
  return path.split('/').filter(Boolean);
}
