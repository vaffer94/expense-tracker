// Settings: starting balance, category management, and the NFC tag URLs.
import { api, esc, failed, fmtMoney, icon, toast } from './api.js';
import { renderManager } from './categories.js';

const tagUrl = id => `${location.origin}/?add=expense&category=${id}`;
const parseAmount = raw => {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

let managerReady = false;

export async function render() {
  renderBalance();
  renderTags();
  if (!managerReady) {
    managerReady = true;
    renderManager(document.getElementById('mng-list'));
  }
}

async function renderBalance() {
  const input = document.getElementById('starting-balance');
  const button = document.getElementById('save-balance');
  try {
    const { starting_balance } = await api.settings();
    input.value = starting_balance ? String(starting_balance).replace('.', ',') : '';
  } catch (err) { return failed(err); }

  button.onclick = async () => {
    const value = input.value.trim() === '' ? 0 : parseAmount(input.value);
    if (Number.isNaN(value)) return toast('That is not a number', true);
    try {
      await api.saveSettings({ starting_balance: value });
      document.dispatchEvent(new Event('data-changed'));
      toast(`Starting balance set to ${fmtMoney(value)}`);
    } catch (err) { failed(err); }
  };
}

async function renderTags() {
  const list = document.getElementById('nfc-list');
  list.innerHTML = '<li class="skel" style="height:66px"></li>'.repeat(2);
  let categories;
  try {
    categories = await api.categories();
  } catch (err) { return failed(err); }

  list.innerHTML = categories.length
    ? categories.map(c => `
        <li>
          <span class="avatar" style="background:${esc(c.color)}22;color:${esc(c.color)}">${icon(c.icon)}</span>
          <span style="flex:1;min-width:0">
            <span>${esc(c.name)} <span class="muted">#${c.id}</span></span>
            <span class="url">${esc(tagUrl(c.id))}</span>
          </span>
          <button class="cp" data-url="${esc(tagUrl(c.id))}" aria-label="Copy URL">${icon('ui-copy')}</button>
        </li>`).join('')
    : `<li class="empty">No categories yet.</li>`;

  list.onclick = async e => {
    const url = e.target.closest('[data-url]')?.dataset.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('URL copied');
    } catch {
      prompt('Copy this URL:', url);   // clipboard API needs HTTPS; LAN http falls back
    }
  };
}
