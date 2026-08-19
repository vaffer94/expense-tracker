// Settings: the NFC tag URLs. Categories are user-created, so their IDs are only knowable here.
import { api, esc, failed, icon, toast } from './api.js';

const tagUrl = id => `${location.origin}/?add=expense&category=${id}`;

export async function render() {
  const list = document.getElementById('nfc-list');
  list.innerHTML = '<li class="skel" style="height:66px"></li>'.repeat(3);
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
