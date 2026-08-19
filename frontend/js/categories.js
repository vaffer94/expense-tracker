// Category picker: select, create inline, and manage (rename / recolor / re-icon / archive).
import { ICON_NAMES, api, esc, failed, icon, toast } from './api.js';
import { mountSheet } from './sheet.js';

export const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
                        '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#78716c'];

const avatar = c => `<span class="avatar" style="background:${esc(c.color)}22;color:${esc(c.color)}">${icon(c.icon)}</span>`;

/** Icon grid + colour swatches, shared by the create and edit forms. */
function editorFields(prefix, { name = '', iconName = ICON_NAMES[0], color = PALETTE[0] } = {}) {
  return `
    <input class="row" data-f="${prefix}-name" placeholder="Category name" maxlength="40" value="${esc(name)}">
    <div class="icon-grid" data-f="${prefix}-icons" style="margin-top:10px">
      ${ICON_NAMES.map(n => `<button type="button" data-icon="${n}" class="${n === iconName ? 'on' : ''}">${icon(n)}</button>`).join('')}
    </div>
    <div class="swatches" style="margin-top:12px">
      ${PALETTE.map(c => `<button type="button" data-color="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}
    </div>`;
}

const readEditor = (el, prefix) => ({
  name: el.querySelector(`[data-f="${prefix}-name"]`).value.trim(),
  icon: el.querySelector(`[data-f="${prefix}-icons"] .on`)?.dataset.icon,
  color: el.querySelector('.swatches .on')?.dataset.color,
});

/**
 * Full-height picker over whatever sheet is already open.
 * `kind` is inherited from the open flow — never a choice made here.
 */
export function openPicker(kind, onPick) {
  const { el, close } = mountSheet(`
    <div class="sheet-head">
      <button class="icon-btn" data-act="close" aria-label="Close">${icon('ui-x')}</button>
      <h2>${kind === 'expense' ? 'Expense' : 'Income'} category</h2>
    </div>
    <ul class="cat-list" data-list></ul>
    <div class="pinned" data-pinned></div>
  `, { tall: true });

  const list = el.querySelector('[data-list]');
  const pinned = el.querySelector('[data-pinned]');
  let categories = [];

  async function refresh() {
    try {
      categories = await api.categories({ kind });
    } catch (err) { return failed(err); }
    list.innerHTML = categories.length
      ? categories.map(c => `
          <li data-id="${c.id}">
            ${avatar(c)}
            <button class="nm" style="text-align:left" data-act="select">${esc(c.name)}</button>
            <button class="icon-btn" data-act="manage" aria-label="Edit ${esc(c.name)}">${icon('ui-pencil')}</button>
          </li>`).join('')
      : `<li style="background:none"><span class="muted">No categories yet — add one below.</span></li>`;
  }

  function collapsed() {
    pinned.innerHTML = `<button class="btn wide ghost" data-act="new">+ Add new category</button>`;
  }

  function showForm(category) {
    const editing = Boolean(category);
    pinned.innerHTML = `
      ${editorFields('f', category ? { name: category.name, iconName: category.icon, color: category.color } : {})}
      <div class="form-actions">
        ${editing ? `<button class="btn ghost" data-act="archive">Archive</button>` : ''}
        <button class="btn ghost" data-act="cancel-form">Cancel</button>
        <button class="btn" data-act="${editing ? 'update' : 'create'}">${editing ? 'Save' : 'Create'}</button>
      </div>`;
    pinned.dataset.editing = editing ? category.id : '';
    pinned.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  el.addEventListener('click', async e => {
    const iconBtn = e.target.closest('.icon-grid button');
    if (iconBtn) {
      iconBtn.parentElement.querySelector('.on')?.classList.remove('on');
      return iconBtn.classList.add('on');
    }
    const swatch = e.target.closest('.swatches button');
    if (swatch) {
      swatch.parentElement.querySelector('.on')?.classList.remove('on');
      return swatch.classList.add('on');
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const id = Number(e.target.closest('li')?.dataset.id) || Number(pinned.dataset.editing);

    if (act === 'close') close();
    if (act === 'select') { onPick(categories.find(c => c.id === id)); close(); }
    if (act === 'manage') showForm(categories.find(c => c.id === id));
    if (act === 'new') showForm(null);
    if (act === 'cancel-form') collapsed();

    if (act === 'create') {
      const body = { ...readEditor(pinned, 'f'), kind };
      if (!body.name) return toast('Give the category a name', true);
      try {
        const created = await api.createCategory(body);
        document.dispatchEvent(new Event('data-changed'));
        onPick(created);           // immediately selected for the transaction in progress
        close();
      } catch (err) { failed(err); }
    }

    if (act === 'update') {
      const body = readEditor(pinned, 'f');
      if (!body.name) return toast('Give the category a name', true);
      try {
        await api.updateCategory(id, body);
        collapsed();
        await refresh();
        document.dispatchEvent(new Event('data-changed'));
      } catch (err) { failed(err); }
    }

    if (act === 'archive') {
      const category = categories.find(c => c.id === id);
      if (!confirm(`Archive "${category.name}"?\n\nIt disappears from this picker, but past transactions and chart slices are kept.`)) return;
      try {
        await api.archiveCategory(id);
        collapsed();
        await refresh();
        document.dispatchEvent(new Event('data-changed'));
        toast('Category archived');
      } catch (err) { failed(err); }
    }
  });

  collapsed();
  refresh();
  return { close, showForm };
}

/** Straight into the create form — used by the "create your first category" empty state. */
export function openNewCategory(kind, onPick) {
  openPicker(kind, onPick).showForm(null);
}
