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
    const [trends, breakdown] = await Promise.all([
      api.trends({ ...params, granularity }),
      api.byCategory({ ...params, type: 'expense' }),
    ]);
    renderLine(trends);
    renderBars(breakdown.slices);
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

  line = new Chart($('line'), {
    type: 'line',
    data: {
      labels: buckets.map(b => periodLabel(b.period, granularity)),
      datasets: [series('income', '#22c55e'), series('expense', '#ef4444')],
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
      },
    },
  });
}

function renderBars(slices) {
  const max = Math.max(...slices.map(s => s.amount), 0);
  $('bars').innerHTML = slices.length
    ? slices.map(s => `
        <li>
          <span class="avatar" style="background:${esc(s.color)}22;color:${esc(s.color)}">${icon(s.icon)}</span>
          <span>
            <span class="nm">${esc(s.name)}</span>
            <span class="track"><span class="fill" style="width:${(s.amount / max * 100).toFixed(1)}%;background:${esc(s.color)}"></span></span>
          </span>
          <span class="amt">${fmtMoney(s.amount)}</span>
        </li>`).join('')
    : `<li class="empty">No expenses in this range</li>`;
}
