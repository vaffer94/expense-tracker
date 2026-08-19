// Add / edit transaction bottom sheet.
import { api, esc, failed, icon, localInput, toast, withOffset } from './api.js';
import { openPicker } from './categories.js';

/** Slide a sheet up over a dimmed backdrop. Returns { el, close }. */
export function mountSheet(html, { tall = false, onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (tall ? ' tall' : '');
  sheet.innerHTML = `<div class="grip"></div>` + html;
  root.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.classList.add('in'); sheet.classList.add('in'); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('in');
    sheet.classList.remove('in');
    setTimeout(() => { backdrop.remove(); sheet.remove(); }, 260);
    onClose?.();
  };
  const tryClose = () => { if (sheet.dataset.guard !== 'on' || confirm('Discard this entry?')) close(); };
  backdrop.addEventListener('click', tryClose);

  // swipe down to dismiss
  let startY = null;
  sheet.addEventListener('touchstart', e => { startY = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', e => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transform = '';
    startY = null;
    if (dy > 90) tryClose();
  });

  return { el: sheet, close, tryClose };
}

const parseAmount = raw => {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function openSheet({ type = 'expense', transaction = null, category = null, focusAmount = false } = {}) {
  const editing = Boolean(transaction);
  const kind = editing ? transaction.type : type;
  let picked = category ?? (editing ? transaction.category : null);

  const initial = {
    amount: editing ? String(transaction.amount) : '',
    when: localInput(editing ? new Date(transaction.timestamp) : new Date()),
    notes: editing ? (transaction.notes ?? '') : '',
    categoryId: picked?.id ?? null,
  };

  const { el, close, tryClose } = mountSheet(`
    <div class="sheet-head">
      <button class="icon-btn" data-act="cancel" aria-label="Cancel">${icon('ui-x')}</button>
      <h2>${editing ? 'Edit' : 'New'} ${kind}</h2>
    </div>
    <div class="amount-row">
      <span class="cur">€</span>
      <input id="amount" inputmode="decimal" placeholder="0,00" value="${esc(initial.amount)}">
    </div>
    <label class="field"><span class="lbl">Category</span>
      <button class="row" data-act="pick"></button>
    </label>
    <label class="field"><span class="lbl">Date &amp; time</span>
      <input class="row" type="datetime-local" data-f="when" value="${initial.when}">
    </label>
    <label class="field"><span class="lbl">Notes</span>
      <input class="row" data-f="notes" placeholder="Optional" maxlength="500" value="${esc(initial.notes)}">
    </label>
    <button class="btn wide" data-act="save">Save ${kind}</button>
  `);

  const $ = sel => el.querySelector(sel);
  const amountEl = $('#amount');
  const pickEl = $('[data-act="pick"]');
  const saveEl = $('[data-act="save"]');

  function renderCategory() {
    pickEl.innerHTML = picked
      ? `<span class="avatar" style="background:${esc(picked.color)}22;color:${esc(picked.color)}">${icon(picked.icon)}</span>
         <span class="grow">${esc(picked.name)}</span>`
      : `<span class="grow muted">Select category</span>`;
  }

  function sync() {
    saveEl.disabled = !(parseAmount(amountEl.value) > 0 && picked);
    el.dataset.guard =
      amountEl.value !== initial.amount || $('[data-f="notes"]').value !== initial.notes ||
      $('[data-f="when"]').value !== initial.when || (picked?.id ?? null) !== initial.categoryId
        ? 'on' : 'off';
  }

  el.addEventListener('input', sync);
  el.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') tryClose();
    if (act === 'pick') openPicker(kind, cat => { picked = cat; renderCategory(); sync(); });
    if (act === 'save') await save();
  });

  async function save() {
    saveEl.disabled = true;
    const when = $('[data-f="when"]').value;
    const body = {
      amount: parseAmount(amountEl.value),
      category_id: picked.id,
      timestamp: withOffset(when ? new Date(when) : new Date()),
      notes: $('[data-f="notes"]').value.trim() || null,
    };
    try {
      if (editing) await api.updateTransaction(transaction.id, body);
      else await api.createTransaction({ ...body, type: kind });
      el.dataset.guard = 'off';
      close();
      document.dispatchEvent(new Event('data-changed'));
      toast(editing ? 'Updated' : `${kind === 'expense' ? 'Expense' : 'Income'} saved`);
    } catch (err) {
      failed(err);
      saveEl.disabled = false;
    }
  }

  renderCategory();
  sync();
  if (focusAmount) setTimeout(() => amountEl.focus(), 320);
}
