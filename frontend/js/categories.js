// Category editing widgets, shared by the transaction sheet's inline "new category" form and by
// the management screen in Settings. The old full-height picker sheet is gone: category selection
// now lives inline in the transaction sheet.
import { ICON_NAMES, api, esc, failed, icon, mountSheet, toast } from './api.js';

export const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
                        '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#78716c'];

export const avatar = (c, extra = '') =>
  `<span class="avatar" style="background:${esc(c.color)}22;color:${esc(c.color)};${extra}">${icon(c.icon)}</span>`;

/** Name input, icon grid and colour swatches. Selection state lives in the DOM, read by readEditor. */
export function editorFields({ name = '', iconName = ICON_NAMES[0], color = PALETTE[0] } = {}) {
  return `
    <input class="row" data-f="cat-name" placeholder="Category name" maxlength="40" value="${esc(name)}">
    <div class="icon-grid" data-f="cat-icons">
      ${ICON_NAMES.map(n => `<button type="button" data-icon="${n}" class="${n === iconName ? 'on' : ''}">${icon(n)}</button>`).join('')}
    </div>
    <div class="swatches">
      ${PALETTE.map(c => `<button type="button" data-color="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}
    </div>`;
}

export const readEditor = el => ({
  name: el.querySelector('[data-f="cat-name"]').value.trim(),
  icon: el.querySelector('[data-f="cat-icons"] .on')?.dataset.icon,
  color: el.querySelector('.swatches .on')?.dataset.color,
});

/** Single-select behaviour for the icon grid and swatch row. Returns true if it handled the click. */
export function handleEditorClick(e) {
  const button = e.target.closest('.icon-grid button, .swatches button');
  if (!button) return false;
  button.parentElement.querySelector('.on')?.classList.remove('on');
  button.classList.add('on');
  return true;
}

/* ------------------------------------------------------------------ */
/* Settings › manage categories and subcategories                      */
/* ------------------------------------------------------------------ */

export async function renderManager(host) {
  let categories = [];

  async function refresh() {
    try {
      categories = await api.categories();
    } catch (err) { return failed(err); }

    host.innerHTML = categories.map(c => `
      <li class="mng" data-cat="${c.id}">
        <div class="mng-head">
          ${avatar(c)}
          <span class="grow">${esc(c.name)} <span class="muted">${c.kind}</span></span>
          <button class="icon-btn" data-act="edit-cat" aria-label="Edit ${esc(c.name)}">${icon('ui-pencil')}</button>
        </div>
        <ul class="mng-subs">
          ${c.subcategories.map(s => `
            <li data-sub="${s.id}">
              <span class="grow">${esc(s.name)}</span>
              <button class="icon-btn" data-act="edit-sub" aria-label="Edit ${esc(s.name)}">${icon('ui-pencil')}</button>
            </li>`).join('')}
          <li><button class="link" data-act="new-sub">+ Add subcategory</button></li>
        </ul>
      </li>`).join('') + `<li><button class="btn wide ghost" data-act="new-cat">+ Add category</button></li>`;
  }

  /** Wraps a save: run it, refresh the list, tell the rest of the app, close the sheet. */
  const commit = async (fn, close) => {
    try {
      await fn();
      await refresh();
      document.dispatchEvent(new Event('data-changed'));
      close();
    } catch (err) { failed(err); }
  };

  function openCategorySheet(category) {
    const editing = Boolean(category);
    const { el, close } = mountSheet(`
      <div class="sheet-head">
        <button type="button" class="icon-btn" data-act="close" aria-label="Cancel">${icon('ui-x')}</button>
        <h2>${editing ? 'Edit' : 'New'} category</h2>
        <button type="button" class="btn compact" data-act="save">${editing ? 'Save' : 'Create'}</button>
      </div>
      ${editing ? '' : `
        <div class="field"><span class="lbl">Kind</span>
          <div class="segmented small" data-f="kind">
            <button type="button" data-kind="expense" class="on">Expense</button>
            <button type="button" data-kind="income">Income</button>
          </div>
        </div>`}
      ${editorFields(editing ? { name: category.name, iconName: category.icon, color: category.color } : {})}
      ${editing ? `<button type="button" class="btn wide ghost danger-text" data-act="archive">Archive category</button>` : ''}
    `);

    el.addEventListener('click', async e => {
      if (handleEditorClick(e)) return;
      const kindBtn = e.target.closest('[data-f="kind"] button');
      if (kindBtn) {
        kindBtn.parentElement.querySelector('.on')?.classList.remove('on');
        return kindBtn.classList.add('on');
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return close();

      if (act === 'save') {
        const body = readEditor(el);
        if (!body.name) return toast('Give the category a name', true);
        if (editing) return commit(() => api.updateCategory(category.id, body), close);
        body.kind = el.querySelector('[data-f="kind"] .on').dataset.kind;
        return commit(() => api.createCategory(body), close);
      }

      if (act === 'archive') {
        if (!confirm(`Archive "${category.name}"?\n\nIt disappears from the picker, but past transactions and chart slices are kept.`)) return;
        return commit(() => api.archiveCategory(category.id), close);
      }
    });
  }

  function openSubcategorySheet(category, sub) {
    const editing = Boolean(sub);
    const parents = categories.filter(c => c.kind === category.kind);
    const { el, close } = mountSheet(`
      <div class="sheet-head">
        <button type="button" class="icon-btn" data-act="close" aria-label="Cancel">${icon('ui-x')}</button>
        <h2>${editing ? 'Edit' : 'New'} subcategory</h2>
        <button type="button" class="btn compact" data-act="save">${editing ? 'Save' : 'Create'}</button>
      </div>
      <div class="field"><span class="lbl">Name</span>
        <input class="row" data-f="sub-name" placeholder="Subcategory name" maxlength="40" value="${esc(sub?.name ?? '')}">
      </div>
      ${editing ? `
        <div class="field"><span class="lbl">Belongs to</span>
          <select class="row" data-f="sub-parent">
            ${parents.map(p => `<option value="${p.id}" ${p.id === category.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <p class="hint">Moving it changes where new transactions land. Past ones keep the category
        they were logged under.</p>
        <button type="button" class="btn wide ghost danger-text" data-act="archive">Archive subcategory</button>
      ` : ''}
    `);

    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return close();

      if (act === 'save') {
        const name = el.querySelector('[data-f="sub-name"]').value.trim();
        if (!name) return toast('Give the subcategory a name', true);
        if (!editing) return commit(() => api.createSubcategory({ name, category_id: category.id }), close);
        const parent = Number(el.querySelector('[data-f="sub-parent"]').value);
        return commit(() => api.updateSubcategory(sub.id, { name, category_id: parent }), close);
      }

      if (act === 'archive') {
        if (!confirm(`Archive "${sub.name}"?\n\nPast transactions keep it.`)) return;
        return commit(() => api.archiveSubcategory(sub.id), close);
      }
    });
  }

  host.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const category = categories.find(c => c.id === Number(e.target.closest('.mng')?.dataset.cat));
    const subId = Number(e.target.closest('[data-sub]')?.dataset.sub);

    if (act === 'new-cat') openCategorySheet(null);
    if (act === 'edit-cat') openCategorySheet(category);
    if (act === 'new-sub') openSubcategorySheet(category, null);
    if (act === 'edit-sub') openSubcategorySheet(category, category.subcategories.find(s => s.id === subId));
  });

  await refresh();
}
