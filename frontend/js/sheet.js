// Add / edit transaction bottom sheet. Category and subcategory are chosen inline: there is no
// separate picker screen.
import { api, esc, failed, icon, localInput, mountSheet, toast, withOffset } from './api.js';
import { avatar, editorFields, handleEditorClick, readEditor } from './categories.js';

const GRID_SLOTS = 9;   // three rows; beyond that the grid collapses behind a "…" tile

const parseAmount = raw => {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function openSheet({ type = 'expense', transaction = null, category = null, focusAmount = false } = {}) {
  const editing = Boolean(transaction);
  const kind = editing ? transaction.type : type;

  let categories = [];
  let picked = category ?? (editing ? transaction.category : null);
  let pickedSub = editing ? transaction.subcategory : null;
  let expanded = false;

  const initial = {
    amount: editing ? String(transaction.amount) : '',
    when: localInput(editing ? new Date(transaction.timestamp) : new Date()),
    notes: editing ? (transaction.notes ?? '') : '',
    categoryId: picked?.id ?? null,
    subId: pickedSub?.id ?? null,
  };

  // Save sits in the header: the keyboard covers the bottom of the sheet, and this form opens with
  // the amount focused. A real <form> gives Enter-to-submit, blocked while Save is disabled.
  const { el, close, tryClose } = mountSheet(`
    <form novalidate>
      <div class="sheet-head">
        <button type="button" class="icon-btn" data-act="cancel" aria-label="Cancel">${icon('ui-x')}</button>
        <h2>${editing ? 'Edit' : 'New'} ${kind}</h2>
        <button type="submit" class="btn compact" data-act="save">Save</button>
      </div>
      <div class="amount-row">
        <span class="cur">€</span>
        <input id="amount" inputmode="decimal" enterkeyhint="done" placeholder="0,00" value="${esc(initial.amount)}">
      </div>
      <div class="field"><span class="lbl">Category</span>
        <div class="cat-grid" data-f="cats"></div>
        <div class="inline-form" data-f="cat-form" hidden></div>
      </div>
      <div class="field" data-f="sub-field" hidden><span class="lbl">Subcategory <span class="muted">optional</span></span>
        <div class="chips" data-f="subs"></div>
        <div class="inline-form" data-f="sub-form" hidden></div>
      </div>
      <label class="field"><span class="lbl">Date &amp; time</span>
        <input class="row" type="datetime-local" data-f="when" value="${initial.when}">
      </label>
      <label class="field"><span class="lbl">Notes</span>
        <input class="row" data-f="notes" enterkeyhint="done" placeholder="Optional" maxlength="500" value="${esc(initial.notes)}">
      </label>
    </form>
  `);

  const $ = sel => el.querySelector(sel);
  const amountEl = $('#amount');
  const saveEl = $('[data-act="save"]');

  function renderGrid() {
    const grid = $('[data-f="cats"]');
    const overflowing = categories.length > GRID_SLOTS - 1 && !expanded;
    const shown = overflowing ? categories.slice(0, GRID_SLOTS - 1) : categories;

    grid.innerHTML = shown.map(c => `
      <button type="button" class="tile ${picked?.id === c.id ? 'on' : ''}" data-act="pick" data-id="${c.id}">
        ${avatar(c)}<span>${esc(c.name)}</span>
      </button>`).join('')
      + (overflowing
          ? `<button type="button" class="tile more" data-act="expand"><span class="dots">…</span><span>${categories.length - shown.length} more</span></button>`
          : `<button type="button" class="tile add" data-act="new-cat"><span class="plus">+</span><span>New</span></button>`);
  }

  function renderSubs() {
    const field = $('[data-f="sub-field"]');
    if (!picked) { field.hidden = true; return; }
    field.hidden = false;
    const subs = picked.subcategories ?? [];
    $('[data-f="subs"]').innerHTML = subs.map(s => `
      <button type="button" class="chip-btn ${pickedSub?.id === s.id ? 'on' : ''}" data-act="pick-sub" data-id="${s.id}">
        ${esc(s.name)}
      </button>`).join('')
      + `<button type="button" class="chip-btn add" data-act="new-sub">+</button>`;
  }

  function sync() {
    saveEl.disabled = !(parseAmount(amountEl.value) > 0 && picked);
    el.dataset.guard =
      amountEl.value !== initial.amount || $('[data-f="notes"]').value !== initial.notes ||
      $('[data-f="when"]').value !== initial.when || (picked?.id ?? null) !== initial.categoryId ||
      (pickedSub?.id ?? null) !== initial.subId
        ? 'on' : 'off';
  }

  async function loadCategories(selectId = null) {
    try {
      categories = await api.categories({ kind });
    } catch (err) { return failed(err); }
    if (selectId) {
      picked = categories.find(c => c.id === selectId) ?? picked;
      pickedSub = null;
    } else if (picked) {
      // refresh the selected category so its subcategory list is current
      picked = categories.find(c => c.id === picked.id) ?? picked;
    }
    renderGrid();
    renderSubs();
    sync();
  }

  el.addEventListener('input', sync);
  el.addEventListener('click', async e => {
    if (handleEditorClick(e)) return;
    const target = e.target.closest('[data-act]');
    const act = target?.dataset.act;
    if (!act) return;
    const id = Number(target.dataset.id);

    if (act === 'cancel') return tryClose();
    if (act === 'expand') { expanded = true; return renderGrid(); }

    if (act === 'pick') {
      // Changing category drops the subcategory: it belonged to the previous parent.
      picked = categories.find(c => c.id === id);
      pickedSub = null;
      renderGrid(); renderSubs(); sync();
    }

    if (act === 'pick-sub') {
      const sub = picked.subcategories.find(s => s.id === id);
      pickedSub = pickedSub?.id === id ? null : sub;
      renderSubs(); sync();
    }

    if (act === 'new-cat') {
      const form = $('[data-f="cat-form"]');
      form.hidden = false;
      form.innerHTML = editorFields() + `
        <div class="form-actions">
          <button type="button" class="btn ghost" data-act="cancel-cat">Cancel</button>
          <button type="button" class="btn" data-act="create-cat">Create</button>
        </div>`;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (act === 'cancel-cat') { const f = $('[data-f="cat-form"]'); f.hidden = true; f.innerHTML = ''; }

    if (act === 'create-cat') {
      const form = $('[data-f="cat-form"]');
      const body = { ...readEditor(form), kind };
      if (!body.name) return toast('Give the category a name', true);
      try {
        const created = await api.createCategory(body);
        form.hidden = true; form.innerHTML = '';
        await loadCategories(created.id);
        document.dispatchEvent(new Event('data-changed'));
      } catch (err) { failed(err); }
    }

    if (act === 'new-sub') {
      const form = $('[data-f="sub-form"]');
      form.hidden = false;
      form.innerHTML = `
        <input class="row" data-f="sub-name" placeholder="Subcategory name" maxlength="40">
        <div class="form-actions">
          <button type="button" class="btn ghost" data-act="cancel-sub">Cancel</button>
          <button type="button" class="btn" data-act="create-sub">Create</button>
        </div>`;
      form.querySelector('[data-f="sub-name"]').focus();
    }
    if (act === 'cancel-sub') { const f = $('[data-f="sub-form"]'); f.hidden = true; f.innerHTML = ''; }

    if (act === 'create-sub') {
      const form = $('[data-f="sub-form"]');
      const name = form.querySelector('[data-f="sub-name"]').value.trim();
      if (!name) return toast('Give the subcategory a name', true);
      try {
        const created = await api.createSubcategory({ name, category_id: picked.id });
        form.hidden = true; form.innerHTML = '';
        await loadCategories();
        pickedSub = picked.subcategories.find(s => s.id === created.id) ?? null;
        renderSubs(); sync();
        document.dispatchEvent(new Event('data-changed'));
      } catch (err) { failed(err); }
    }
  });

  $('form').addEventListener('submit', e => { e.preventDefault(); save(); });

  async function save() {
    saveEl.disabled = true;
    const when = $('[data-f="when"]').value;
    const body = {
      amount: parseAmount(amountEl.value),
      category_id: picked.id,
      subcategory_id: pickedSub?.id ?? null,
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

  loadCategories();
  sync();
  if (focusAmount) setTimeout(() => amountEl.focus(), 320);
}
