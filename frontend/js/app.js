// Boot, hash routing, and the NFC deep-link handoff.
import { api, failed, loadSprite, toast } from './api.js';
import * as home from './home.js';
import * as settings from './settings.js';
import * as trends from './trends.js';
import { openSheet } from './sheet.js';

const VIEWS = {
  '#/': { el: 'view-home', render: home.render },
  '#/trends': { el: 'view-trends', render: trends.render },
  '#/settings': { el: 'view-settings', render: settings.render },
};

function route() {
  const hash = VIEWS[location.hash] ? location.hash : '#/';
  for (const [key, view] of Object.entries(VIEWS)) {
    document.getElementById(view.el).hidden = key !== hash;
  }
  document.getElementById('btn-trends').classList.toggle('on', hash === '#/trends');
  VIEWS[hash].render();
}

/** NFC tag: /?add=expense&category=<id> opens the sheet ready to type an amount. */
async function handleTagLink() {
  const params = new URLSearchParams(location.search);
  const type = params.get('add');
  const categoryId = Number(params.get('category'));
  if (type !== 'expense' && type !== 'income') return;

  history.replaceState(null, '', location.pathname + location.hash);

  let category = null;
  if (categoryId) {
    try {
      category = (await api.categories({ kind: type })).find(c => c.id === categoryId) ?? null;
    } catch (err) { failed(err); }
    if (!category) toast('That category no longer exists.', true);
  }
  openSheet({ type, category, focusAmount: true });
}

async function boot() {
  try {
    await loadSprite();
  } catch (err) {
    failed(err);
  }
  home.initHome();
  trends.initTrends();

  document.getElementById('btn-expense').onclick = () => openSheet({ type: 'expense' });
  document.getElementById('btn-income').onclick = () => openSheet({ type: 'income' });
  document.getElementById('btn-trends').onclick = () => {
    location.hash = location.hash === '#/trends' ? '#/' : '#/trends';
  };

  addEventListener('hashchange', route);
  document.addEventListener('data-changed', () => {
    if (location.hash === '#/trends') trends.render();
  });

  route();
  await handleTagLink();
}

boot();
