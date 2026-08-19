// Category editing widgets, shared by the transaction sheet's inline "new category" form and by
// the management screen in Settings. The old full-height picker sheet is gone: category selection
// now lives inline in the transaction sheet.
import { ICON_NAMES, api, esc, failed, icon, toast } from './api.js';

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
        <div class="mng-form" hidden></div>
      </li>`).join('') + `<li><button class="btn wide ghost" data-act="new-cat">+ Add category</button></li>`;
  }

  function formHost(target) {
    const form = target.closest('.mng')?.querySelector('.mng-form') ?? host.querySelector('.mng-form');
    return form;
  }

  host.addEventListener('click', async e => {
    if (handleEditorClick(e)) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    const li = e.target.closest('.mng');
    const categoryId = Number(li?.dataset.cat);
    const category = categories.find(c => c.id === categoryId);
    const subId = Number(e.target.closest('[data-sub]')?.dataset.sub);
    const form = act === 'new-cat' ? host.querySelector('.mng-form') : formHost(e.target);

    const show = html => {
      host.querySelectorAll('.mng-form').forEach(f => { f.hidden = true; f.innerHTML = ''; });
      if (!form) return;
      form.hidden = false;
      form.innerHTML = html;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    if (act === 'edit-cat') {
      show(editorFields(category ? { name: category.name, iconName: category.icon, color: category.color } : {}) + `
        <div class="form-actions">
          <button class="btn ghost" data-act="archive-cat">Archive</button>
          <button class="btn ghost" data-act="cancel">Cancel</button>
          <button class="btn" data-act="save-cat">Save</button>
        </div>`);
    }

    if (act === 'new-cat') {
      const kind = prompt('Category kind: type "expense" or "income"', 'expense');
      if (kind !== 'expense' && kind !== 'income') return;
      host.querySelector('.mng-form')?.removeAttribute('hidden');
      const target = host.querySelector('.mng-form');
      if (!target) return;
      target.dataset.kind = kind;
      target.innerHTML = editorFields() + `
        <div class="form-actions">
          <button class="btn ghost" data-act="cancel">Cancel</button>
          <button class="btn" data-act="create-cat">Create ${kind}</button>
        </div>`;
    }

    if (act === 'new-sub' || act === 'edit-sub') {
      const existing = act === 'edit-sub' ? category.subcategories.find(s => s.id === subId) : null;
      const parents = categories.filter(c => c.kind === category.kind);
      show(`
        <input class="row" data-f="sub-name" placeholder="Subcategory name" maxlength="40"
               value="${esc(existing?.name ?? '')}">
        ${existing ? `
          <label class="field" style="margin-top:10px"><span class="lbl">Belongs to</span>
            <select class="row" data-f="sub-parent">
              ${parents.map(p => `<option value="${p.id}" ${p.id === category.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </label>` : ''}
        <div class="form-actions">
          ${existing ? `<button class="btn ghost" data-act="archive-sub" data-id="${existing.id}">Archive</button>` : ''}
          <button class="btn ghost" data-act="cancel">Cancel</button>
          <button class="btn" data-act="${existing ? 'save-sub' : 'create-sub'}" data-id="${existing?.id ?? ''}">
            ${existing ? 'Save' : 'Create'}
          </button>
        </div>`);
    }

    if (act === 'cancel') {
      host.querySelectorAll('.mng-form').forEach(f => { f.hidden = true; f.innerHTML = ''; });
    }

    const done = async fn => {
      try {
        await fn();
        await refresh();
        document.dispatchEvent(new Event('data-changed'));
      } catch (err) { failed(err); }
    };

    if (act === 'save-cat') {
      const body = readEditor(form);
      if (!body.name) return toast('Give the category a name', true);
      await done(() => api.updateCategory(categoryId, body));
    }

    if (act === 'create-cat') {
      const target = host.querySelector('.mng-form');
      const body = { ...readEditor(target), kind: target.dataset.kind };
      if (!body.name) return toast('Give the category a name', true);
      await done(() => api.createCategory(body));
    }

    if (act === 'archive-cat') {
      if (!confirm(`Archive "${category.name}"?\n\nIt disappears from the picker, but past transactions and chart slices are kept.`)) return;
      await done(() => api.archiveCategory(categoryId));
    }

    if (act === 'create-sub') {
      const name = form.querySelector('[data-f="sub-name"]').value.trim();
      if (!name) return toast('Give the subcategory a name', true);
      await done(() => api.createSubcategory({ name, category_id: categoryId }));
    }

    if (act === 'save-sub') {
      const id = Number(e.target.closest('[data-act]').dataset.id);
      const name = form.querySelector('[data-f="sub-name"]').value.trim();
      const parent = Number(form.querySelector('[data-f="sub-parent"]').value);
      if (!name) return toast('Give the subcategory a name', true);
      await done(() => api.updateSubcategory(id, { name, category_id: parent }));
    }

    if (act === 'archive-sub') {
      const id = Number(e.target.closest('[data-act]').dataset.id);
      if (!confirm('Archive this subcategory?\n\nPast transactions keep it.')) return;
      await done(() => api.archiveSubcategory(id));
    }
  });

  await refresh();
}
