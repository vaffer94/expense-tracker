// Fetch wrappers plus the handful of helpers every view needs (formatting, toasts, icons).

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const money = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: 'EUR' });
const time = new Intl.DateTimeFormat(navigator.language, { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat(navigator.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtMoney = n => money.format(n);
export const fmtSigned = (type, n) => (type === 'expense' ? '−' : '+') + money.format(n);
export const fmtTime = d => time.format(d);
export const fmtDayTime = d => dayTime.format(d);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const icon = name => `<svg class="i"><use href="#${esc(name)}"></use></svg>`;

/* ---- dates: the API wants local wall-clock boundaries, so never round-trip through UTC ---- */
const pad = n => String(n).padStart(2, '0');
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localInput = d => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function withOffset(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${localInput(d)}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

export const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/* ---- transport ---- */
class ApiError extends Error {}

function detailOf(body, status) {
  const d = body && body.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(e => e.msg?.replace(/^Value error, /, '') ?? 'invalid input').join('; ');
  return `Request failed (${status})`;
}

async function req(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Network error - is the server reachable?');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(detailOf(data, res.status));
  return data;
}

const qs = params => {
  const clean = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? '?' + new URLSearchParams(clean) : '';
};

export const api = {
  categories: p => req('GET', '/api/categories' + qs(p)),
  createCategory: body => req('POST', '/api/categories', body),
  updateCategory: (id, body) => req('PATCH', `/api/categories/${id}`, body),
  archiveCategory: id => req('DELETE', `/api/categories/${id}`),
  restoreCategory: id => req('PATCH', `/api/categories/${id}/restore`, {}),

  subcategories: p => req('GET', '/api/subcategories' + qs(p)),
  createSubcategory: body => req('POST', '/api/subcategories', body),
  updateSubcategory: (id, body) => req('PATCH', `/api/subcategories/${id}`, body),
  archiveSubcategory: id => req('DELETE', `/api/subcategories/${id}`),

  settings: () => req('GET', '/api/settings'),
  saveSettings: body => req('PUT', '/api/settings', body),

  transactions: p => req('GET', '/api/transactions' + qs(p)),
  createTransaction: body => req('POST', '/api/transactions', body),
  updateTransaction: (id, body) => req('PATCH', `/api/transactions/${id}`, body),
  deleteTransaction: id => req('DELETE', `/api/transactions/${id}`),

  summary: p => req('GET', '/api/dashboard/summary' + qs({ ...p, tz: TZ })),
  byCategory: p => req('GET', '/api/dashboard/by-category' + qs({ ...p, tz: TZ })),
  trends: p => req('GET', '/api/dashboard/trends' + qs({ ...p, tz: TZ })),
  comparison: p => req('GET', '/api/dashboard/monthly-comparison' + qs({ ...p, tz: TZ })),
};

/* ---- toasts: every failure surfaces, nothing fails silently ---- */
export function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

export const failed = err => toast(err instanceof Error ? err.message : String(err), true);

/* ---- icons: the vendored sprite is the single source of truth for icon names ---- */
export let ICON_NAMES = [];

export async function loadSprite() {
  const svg = await fetch('vendor/lucide-sprite.svg').then(r => r.text());
  const host = document.createElement('div');
  host.hidden = true;
  host.innerHTML = svg;
  document.body.prepend(host);
  ICON_NAMES = [...host.querySelectorAll('symbol')].map(s => s.id).filter(id => !id.startsWith('ui-'));
  // Re-point <use> elements that were parsed before the sprite existed.
  document.querySelectorAll('use').forEach(u => u.setAttribute('href', u.getAttribute('href')));
}
