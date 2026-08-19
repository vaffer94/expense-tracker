// Trends view: income vs expense over time, plus a category breakdown for the range.
import { api, esc, failed, fmtMoney, icon, localDate } from './api.js';

const RANGES = {
  '1M': { months: 1, granularity: 'day' },
  '3M': { months: 3, granularity: 'week' },
  '1Y': { months: 12, granularity: 'month' },
};

let selected = '1M';
let line = null;

const $ = id => document.getElementById(id);

export function initTrends() {
  $('range-seg').addEventListener('click', e => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    selected = btn.dataset.range;
    [...e.currentTarget.children].forEach(b => b.classList.toggle('on', b === btn));
    render();
  });
}

function periodLabel(period, granularity) {
  const d = new Date(period.length === 7 ? `${period}-01T00:00:00` : `${period}T00:00:00`);
  const opts = granularity === 'month' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(navigator.language, opts).format(d);
}

export async function render() {
  const { months, granularity } = RANGES[selected];
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const from = new Date(to.getFullYear(), to.getMonth() - months, to.getDate());
  const params = { from: localDate(from), to: localDate(to) };

  try {
    const [trends, comparison] = await Promise.all([
      api.trends({ ...params, granularity }),
      api.comparison({ ...params, type: 'expense' }),
    ]);
    renderLine(trends);
    renderComparison(comparison);
  } catch (err) {
    failed(err);
  }
}

function renderLine({ buckets, granularity }) {
  line?.destroy();
  const series = (key, color) => ({
    label: key === 'income' ? 'Income' : 'Expenses',
    data: buckets.map(b => b[key]),
    borderColor: color,
    backgroundColor: color,
    tension: .3,
    pointRadius: buckets.length > 40 ? 0 : 2,
    pointHitRadius: 12,
    borderWidth: 2,
  });

  // The balance is typically an order of magnitude larger than per-bucket flows; on a shared axis
  // it flattens the other two lines into the floor, so it gets its own axis on the right.
  const balance = {
    label: 'Total',
    data: buckets.map(b => b.balance),
    borderColor: '#e8eaf0',
    backgroundColor: '#e8eaf0',
    borderWidth: 2.5,
    tension: 0,          // a cumulative total must not be smoothed: the curve would overshoot into
    pointRadius: 0,      // values the balance never actually held
    pointHitRadius: 12,
    yAxisID: 'y2',
  };

  line = new Chart($('line'), {
    type: 'line',
    data: {
      labels: buckets.map(b => periodLabel(b.period, granularity)),
      datasets: [series('income', '#22c55e'), series('expense', '#ef4444'), balance],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8b93a7', boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8b93a7', maxTicksLimit: 6, autoSkip: true } },
        y: { grid: { color: '#262b36' }, ticks: { color: '#8b93a7', maxTicksLimit: 5 }, beginAtZero: true },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#8b93a7', maxTicksLimit: 5 },
        },
      },
    },
  });
}

function monthLabel(period) {
  const d = new Date(`${period}-01T00:00:00`);
  return new Intl.DateTimeFormat(navigator.language, { month: 'short' }).format(d);
}

function changeLabel(change) {
  if (change === null) return '<span class="chg flat">—</span>';
  const cls = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return `<span class="chg ${cls}">${change > 0 ? '+' : ''}${change.toFixed(0)}%</span>`;
}

/** One row per category, each a small bar chart of months. Plain CSS: a dozen canvases on a phone
 *  would cost more than they show. */
function renderComparison({ months, categories }) {
  const note = $('compare-note');
  note.hidden = months.length > 1;
  note.textContent = 'Only one month in this range — pick 3M or 1Y to compare months.';

  $('compare').innerHTML = categories.length
    ? categories.map(c => {
        const max = Math.max(...c.buckets.map(b => b.amount), 0) || 1;
        return `
        <li>
          <div class="cmp-head">
            <span class="avatar" style="background:${esc(c.color)}22;color:${esc(c.color)}">${icon(c.icon)}</span>
            <span class="nm">${esc(c.name)}</span>
            <span class="amt">${fmtMoney(c.total)}</span>
          </div>
          <div class="cmp-bars">
            ${c.buckets.map(b => `
              <div class="cmp-col">
                <div class="cmp-bar" style="height:${Math.max(2, b.amount / max * 100)}%;background:${esc(c.color)}"
                     title="${fmtMoney(b.amount)}"></div>
                <span class="mn">${monthLabel(b.period)}</span>
                ${months.length > 1 ? changeLabel(b.change_pct) : ''}
              </div>`).join('')}
          </div>
        </li>`;
      }).join('')
    : `<li class="empty">No expenses in this range</li>`;
}
