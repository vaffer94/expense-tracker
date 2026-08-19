// Home view: month summary, expense pie, transaction list.
import {
  addMonths, api, esc, failed, fmtDayTime, fmtMoney, fmtSigned, icon, localDate, monthStart,
} from './api.js';
import { openSheet } from './sheet.js';

const PAGE = 50;
const monthLabel = new Intl.DateTimeFormat(navigator.language, { month: 'long', year: 'numeric' });

let month = monthStart(new Date());
let filterCategory = null;
let group = 'category';
let moneyType = 'expense';
let loaded = [];
let total = 0;
let loading = false;
let pie = null;

const $ = id => document.getElementById(id);
const range = () => ({ from: localDate(month), to: localDate(addMonths(month, 1)) });

export function initHome() {
  $('prev-month').onclick = () => { month = addMonths(month, -1); filterCategory = null; render(); };
  $('next-month').onclick = () => { month = addMonths(month, 1); filterCategory = null; render(); };
  $('clear-filter').onclick = () => { filterCategory = null; render(); };

  for (const [id, key, set] of [['pie-group', 'group', v => group = v], ['pie-type', 'type', v => moneyType = v]]) {
    $(id).addEventListener('click', e => {
      const btn = e.target.closest(`[data-${key}]`);
      if (!btn) return;
      set(btn.dataset[key]);
      [...e.currentTarget.children].forEach(b => b.classList.toggle('on', b === btn));
      filterCategory = null;
      render();
    });
  }

  $('tx-list').addEventListener('click', onListClick);
  bindSwipe($('tx-list'));

  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadMore();
  }).observe($('tx-sentinel'));

  document.addEventListener('data-changed', () => render());
}

export async function render() {
  $('month-label').textContent = monthLabel.format(month);
  const params = range();
  $('tx-list').innerHTML = loaded.length ? $('tx-list').innerHTML : skeleton();

  try {
    const [summary, breakdown, categories] = await Promise.all([
      api.summary(params),
      api.byCategory({ ...params, type: moneyType, group }),
      api.categories(),
    ]);
    renderSummary(summary);
    renderChart(breakdown, categories.length, summary.transaction_count);
  } catch (err) {
    failed(err);
  }

  loaded = [];
  total = 0;
  $('tx-list').innerHTML = '';
  await loadMore();
}

function skeleton() {
  return '<li class="skel"></li>'.repeat(4);
}

function renderSummary({ total_income, total_expense, net }) {
  $('sum-income').textContent = fmtMoney(total_income);
  $('sum-expense').textContent = fmtMoney(total_expense);
  // The month's own net lives in the header, as a subtitle under the month name.
  const netEl = $('month-net');
  netEl.textContent = (net > 0 ? '+' : '') + fmtMoney(net);
  netEl.className = net < 0 ? 'neg' : 'pos';
}

function renderChart({ slices }, categoryCount, txCount) {
  const wrap = $('chart-card').querySelector('.chart-wrap');
  const legend = $('legend');
  const empty = $('chart-empty');
  pie?.destroy();
  pie = null;

  const show = slices.length > 0;
  wrap.hidden = !show;
  legend.hidden = !show;
  empty.hidden = show;

  if (!show) {
    empty.innerHTML = categoryCount === 0
      ? `Create your first category to get started<br><button class="btn" id="first-cat">New expense</button>`
      : `No ${txCount ? 'activity of this kind' : 'activity'} recorded in ${monthLabel.format(month)}`;
    const btn = $('first-cat');
    if (btn) btn.onclick = () => openSheet({ type: 'expense', newCategory: true });
    legend.innerHTML = '';
    return;
  }

  pie = new Chart($('pie'), {
    type: 'pie',
    data: {
      labels: slices.map(s => s.name),
      datasets: [{
        data: slices.map(s => s.amount),
        backgroundColor: slices.map(s => s.color),
        borderColor: '#171a21',
        borderWidth: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtMoney(ctx.raw)}` } },
      },
      onClick: (_, els) => {
        if (!els.length) return;
        toggleFilter(slices[els[0].index]);
      },
    },
  });

  legend.innerHTML = slices.map((s, i) => `
    <li data-slice="${i}" class="${filterCategory && sliceKey(filterCategory) !== sliceKey(s) ? 'dim' : ''}">
      <span class="dot" style="background:${esc(s.color)}"></span>
      <span class="nm">${esc(s.name)}</span>
      <span>${fmtMoney(s.amount)}</span>
      <span class="pc">${s.percentage.toFixed(1)}%</span>
    </li>`).join('');
  legend.onclick = e => {
    const index = e.target.closest('[data-slice]')?.dataset.slice;
    if (index === undefined) return;
    toggleFilter(slices[Number(index)]);
  };
}

const sliceKey = s => `${s.category_id}:${s.subcategory_id ?? ''}`;

function toggleFilter(slice) {
  filterCategory = filterCategory && sliceKey(filterCategory) === sliceKey(slice) ? null : slice;
  render();
}

async function loadMore() {
  if (loading || (loaded.length && loaded.length >= total)) return;
  loading = true;
  try {
    const page = await api.transactions({
      ...range(),
      limit: PAGE,
      offset: loaded.length,
      category_id: filterCategory?.category_id,
      subcategory_id: filterCategory?.subcategory_id,
    });
    total = page.total;
    loaded = loaded.concat(page.items);
    $('tx-list').insertAdjacentHTML('beforeend', page.items.map(row).join(''));
  } catch (err) {
    failed(err);
  } finally {
    loading = false;
    $('list-empty').hidden = loaded.length > 0;
    const chip = $('clear-filter');
    chip.hidden = !filterCategory;
    if (filterCategory) chip.textContent = `${filterCategory.name} ✕`;
  }
}

function row(t) {
  const when = new Date(t.timestamp);
  const sub = [t.subcategory?.name, t.notes].filter(Boolean).join(' · ');
  return `
    <li class="tx" data-id="${t.id}">
      <button class="tx-del" data-act="delete" aria-label="Delete">${icon('ui-trash-2')}</button>
      <div class="tx-inner">
        <span class="avatar" style="background:${esc(t.category.color)}22;color:${esc(t.category.color)}">${icon(t.category.icon)}</span>
        <span class="tx-main">
          <span class="nm">${esc(t.category.name)}</span>
          <span class="sub">${esc(sub)}</span>
        </span>
        <span class="tx-right">
          <span class="tx-amt ${t.type === 'expense' ? 'neg' : 'pos'}">${fmtSigned(t.type, t.amount)}</span>
          <span class="tx-when">${esc(fmtDayTime(when))}</span>
        </span>
      </div>
    </li>`;
}

function onListClick(e) {
  const li = e.target.closest('.tx');
  if (!li) return;
  const t = loaded.find(x => x.id === Number(li.dataset.id));
  if (!t) return;

  if (e.target.closest('[data-act="delete"]')) return remove(li, t);
  if (li.classList.contains('swiped')) return li.classList.remove('swiped');
  openSheet({ transaction: t });
}

async function remove(li, t) {
  if (!confirm(`Delete this ${t.type} of ${fmtMoney(t.amount)}?`)) return;
  li.remove();                       // optimistic; a failure re-renders the truth
  try {
    await api.deleteTransaction(t.id);
    loaded = loaded.filter(x => x.id !== t.id);
    total -= 1;
    document.dispatchEvent(new Event('data-changed'));
  } catch (err) {
    failed(err);
    render();
  }
}

/** Touch swipe-left reveals the delete action; hover does the same on desktop (CSS). */
function bindSwipe(list) {
  let startX = 0, target = null;
  list.addEventListener('touchstart', e => {
    target = e.target.closest('.tx');
    startX = e.touches[0].clientX;
  }, { passive: true });
  list.addEventListener('touchend', e => {
    if (!target) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (dx < -50) target.classList.add('swiped');
    else if (dx > 50) target.classList.remove('swiped');
    target = null;
  });
}

export const currentMonth = () => month;
