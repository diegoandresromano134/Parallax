/* ==========================================================================
   PARALLAX · Componentes de interfaz del Panel de Gestoría
   Modal, confirmación, toasts, formularios y tablas declarativas.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, icon } = PLX;
  const esc = util.esc;
  const doc = document;

  const ui = {};

  /* ---------- Badges ---------- */
  ui.badge = (text, tone = 'neutral', dot = false) => {
    const cls = { cyan: 'badge-cyan', magenta: 'badge-magenta', grad: 'badge-grad', outline: 'badge-outline', solid: 'badge-solid' }[tone] || '';
    return `<span class="badge ${cls}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>`;
  };

  /* ---------- Toasts ---------- */
  ui.toast = (msg, type = 'ok') => {
    const stack = doc.getElementById('toasts');
    const el = doc.createElement('div');
    el.className = `toast${type === 'warn' ? ' is-warn' : ''}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `${icon(type === 'warn' ? 'alert' : 'check')}<div>${esc(msg)}</div>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 320);
    }, 3600);
  };

  /* ---------- Modal ---------- */
  const dlg = () => doc.getElementById('modal');
  let modalCtx = null;

  /**
   * Abre un modal.
   * opts: { title, sub, body (html), size: 'wide'|'narrow', submitLabel, cancelLabel,
   *         danger, footLeft (html), onSubmit(values, form) → false para mantener abierto,
   *         onMount(dialog), onAction: { name: fn(el, e) }, noFooter }
   */
  ui.modal = (opts) => {
    const d = dlg();
    const prev = modalCtx;
    modalCtx = opts;
    // Reemplazar contenido sin cerrar el <dialog> evita eventos «close» diferidos
    if (prev && prev !== opts && prev.onClose && !prev._submitted) prev.onClose();
    d.className = `modal${opts.size ? ` is-${opts.size}` : ''}`;
    const footer = opts.noFooter
      ? ''
      : `<footer class="modal-foot">
          ${opts.footLeft ? `<div class="left">${opts.footLeft}</div>` : ''}
          <button type="button" class="btn btn-ghost" data-modal-close>${esc(opts.cancelLabel || 'Cancelar')}</button>
          ${opts.onSubmit ? `<button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}">${esc(opts.submitLabel || 'Guardar')}</button>` : ''}
        </footer>`;
    d.innerHTML = `
      <form class="modal-form" method="dialog" novalidate>
        <header class="modal-head">
          <div>
            <h2 class="modal-title" id="modal-title">${esc(opts.title)}</h2>
            ${opts.sub ? `<p class="modal-sub">${opts.sub}</p>` : ''}
          </div>
          <button type="button" class="btn btn-icon btn-ghost" data-modal-close aria-label="Cerrar">${icon('x')}</button>
        </header>
        <div class="modal-body">${opts.body || ''}</div>
        ${footer}
      </form>`;
    const form = d.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!opts.onSubmit) return ui.close();
      if (!ui.validate(form)) return;
      opts._submitted = true;
      const r = opts.onSubmit(ui.read(form), form, e);
      if (r === false) opts._submitted = false;
      else if (modalCtx === opts) ui.close();
    });
    if (!d.open) d.showModal();
    const first = d.querySelector('.modal-body [autofocus], .modal-body input:not([type=hidden]):not([type=checkbox]), .modal-body select, .modal-body textarea');
    if (first && !opts.noAutofocus) first.focus();
    if (opts.onMount) opts.onMount(d, form);
    return d;
  };

  ui.close = () => {
    const ctx = modalCtx;
    modalCtx = null;
    const d = dlg();
    if (d.open) d.close();
    if (ctx && ctx.onClose && !ctx._submitted) ctx.onClose();
  };

  // Tecla Escape: cerrar por la misma vía que el resto
  if (dlg()) {
    dlg().addEventListener('cancel', (e) => {
      e.preventDefault();
      ui.close();
    });
  }

  // Delegación de eventos dentro del modal
  doc.addEventListener('click', (e) => {
    const d = dlg();
    if (!d || !d.open) return;
    if (e.target === d) return ui.close(); // clic en el fondo
    if (e.target.closest('[data-modal-close]')) return ui.close();
    const a = e.target.closest('[data-maction]');
    if (a && modalCtx && modalCtx.onAction && modalCtx.onAction[a.dataset.maction]) {
      e.preventDefault();
      modalCtx.onAction[a.dataset.maction](a, e);
    }
  });

  /** Confirmación asíncrona. */
  ui.confirm = ({ title, message, confirmLabel = 'Confirmar', danger = false }) =>
    new Promise((resolve) => {
      const d = ui.modal({
        title,
        size: 'narrow',
        body: `<p class="text-2">${message}</p>`,
        submitLabel: confirmLabel,
        danger,
        noAutofocus: true,
        onSubmit: () => resolve(true),
        onClose: () => resolve(false)
      });
      const btn = d.querySelector('button[type=submit]');
      if (btn) btn.focus();
    });

  /* ---------- Formularios declarativos ---------- */
  /**
   * fields: [{ name, label, type: text|email|number|date|datetime-local|month|select|textarea|checkbox|checks|switch|section|html,
   *            required, options: [{value,label}|string] | groups: [{label, options}], step, min, max,
   *            placeholder, hint, span: 2, attrs, value }]
   */
  ui.form = (fields, values = {}) =>
    `<div class="form-grid">${fields.map((f) => ui.field(f, values)).join('')}</div>`;

  ui.field = (f, values = {}) => {
    if (f.type === 'section') return `<div class="form-section">${esc(f.label)}</div>`;
    if (f.type === 'html') return `<div class="${f.span === 2 ? 'span-2' : ''}">${f.html}</div>`;
    const id = `f-${f.name}-${Math.random().toString(36).slice(2, 6)}`;
    const v = f.value !== undefined ? f.value : values[f.name];
    const val = v == null ? '' : v;
    const req = f.required ? ' required' : '';
    const attrs = f.attrs || '';
    const span = f.span === 2 ? ' span-2' : '';
    const label = `<label for="${id}">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ''}</label>`;
    const hint = f.hint ? `<span class="hint">${f.hint}</span>` : '';
    let control = '';

    switch (f.type) {
      case 'select': {
        const opt = (o) => {
          const ov = typeof o === 'object' ? o.value : o;
          const ol = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(ov)}"${String(ov) === String(val) ? ' selected' : ''}>${esc(ol)}</option>`;
        };
        const ph = f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : '';
        const body = f.groups
          ? f.groups.map((g) => `<optgroup label="${esc(g.label)}">${g.options.map(opt).join('')}</optgroup>`).join('')
          : (f.options || []).map(opt).join('');
        control = `<select class="select" id="${id}" name="${f.name}"${req} ${attrs}>${ph}${body}</select>`;
        break;
      }
      case 'textarea':
        control = `<textarea class="textarea" id="${id}" name="${f.name}"${req} placeholder="${esc(f.placeholder || '')}" ${attrs}>${esc(val)}</textarea>`;
        break;
      case 'checkbox':
        return `<div class="field${span}"><label class="check"><input type="checkbox" name="${f.name}"${val ? ' checked' : ''} ${attrs}><span>${esc(f.label)}</span></label>${hint}</div>`;
      case 'switch':
        return `<div class="field${span}"><label class="switch"><input type="checkbox" name="${f.name}"${val ? ' checked' : ''} ${attrs}><span class="track"></span><span>${esc(f.label)}</span></label>${hint}</div>`;
      case 'checks': {
        const sel = Array.isArray(val) ? val : [];
        const items = (f.options || [])
          .map((o) => `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(o)}"${sel.includes(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`)
          .join('');
        return `<div class="field span-2"><span class="label">${esc(f.label)}</span><div class="checks" data-checks="${f.name}">${items}</div>${hint}</div>`;
      }
      default: {
        const type = f.type || 'text';
        const extra = [
          f.step != null ? `step="${f.step}"` : '',
          f.min != null ? `min="${f.min}"` : '',
          f.max != null ? `max="${f.max}"` : '',
          f.maxlength ? `maxlength="${f.maxlength}"` : '',
          type === 'number' ? 'inputmode="decimal"' : ''
        ].join(' ');
        control = `<input class="input${type === 'number' ? ' num' : ''}${f.cls ? ` ${f.cls}` : ''}" id="${id}" type="${type}" name="${f.name}" value="${esc(val)}"${req} placeholder="${esc(f.placeholder || '')}" ${extra} ${attrs}>`;
      }
    }
    return `<div class="field${span}">${label}${control}${hint}<span class="error-msg" hidden></span></div>`;
  };

  /** Lee un formulario a objeto tipado (number → Number, checkbox → bool, checks → array). */
  ui.read = (form) => {
    const out = {};
    Array.from(form.elements).forEach((el) => {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') {
        if (el.closest('[data-checks]')) {
          out[el.name] = out[el.name] || [];
          if (el.checked) out[el.name].push(el.value);
        } else {
          out[el.name] = el.checked;
        }
      } else if (el.type === 'number') {
        out[el.name] = el.value === '' ? null : Number(el.value);
      } else {
        out[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
      }
    });
    return out;
  };

  /** Validación nativa con mensajes en español. */
  ui.validate = (form) => {
    let ok = true;
    let first = null;
    Array.from(form.elements).forEach((el) => {
      if (!el.name || !el.willValidate || el.type === 'checkbox') return;
      const field = el.closest('.field');
      const msgEl = field && field.querySelector('.error-msg');
      let msg = '';
      if (el.required && !String(el.value).trim()) msg = 'Campo obligatorio.';
      else if (el.validity.typeMismatch && el.type === 'email') msg = 'Email inválido.';
      else if (el.validity.rangeUnderflow) msg = `Debe ser mayor o igual a ${el.min}.`;
      else if (el.validity.rangeOverflow) msg = `Debe ser menor o igual a ${el.max}.`;
      else if (el.validity.badInput || el.validity.stepMismatch) msg = 'Valor inválido.';
      else if (el.dataset.validate === 'cuit' && !util.isCuit(el.value)) msg = 'CUIT inválido (verificá los 11 dígitos).';
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msgEl) {
        msgEl.textContent = msg;
        msgEl.hidden = !msg;
      }
      if (msg) {
        ok = false;
        if (!first) first = el;
      }
    });
    if (first) first.focus();
    return ok;
  };

  /* ---------- Tablas ---------- */
  /**
   * cols: [{ label, cls, cell: (row) => html, label2 (data-label para móvil), primary }]
   */
  ui.table = ({ cols, rows, empty = 'Sin registros.', emptyIcon = 'inbox', stack = true, foot = '', rowAttr }) => {
    if (!rows.length) {
      return `<div class="empty">${icon(emptyIcon)}<span>${empty}</span></div>`;
    }
    const head = cols.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('');
    const body = rows
      .map((r) => {
        const tds = cols
          .map((c) => `<td class="${c.cls || ''}${c.primary ? ' primary' : ''}" data-label="${esc(c.mlabel != null ? c.mlabel : c.label)}"><div class="cell">${c.cell(r)}</div></td>`)
          .join('');
        return `<tr ${rowAttr ? rowAttr(r) : ''}>${tds}</tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table class="tbl${stack ? ' stack-sm' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
  };

  ui.empty = (msg, ic = 'inbox') => `<div class="empty">${icon(ic)}<span>${msg}</span></div>`;

  ui.iconBtn = (action, ic, label, extra = '', cls = '') =>
    `<button type="button" class="btn btn-icon btn-sm btn-ghost ${cls}" data-action="${action}" ${extra} title="${esc(label)}" aria-label="${esc(label)}">${icon(ic, 'i-sm')}</button>`;

  ui.tabs = (items, active) =>
    `<nav class="tabs" role="tablist">${items
      .map((t) => `<a class="tab${t.id === active ? ' is-active' : ''}" role="tab" aria-selected="${t.id === active}" href="${t.href}">${esc(t.label)}${t.n != null ? ` <span class="n">${t.n}</span>` : ''}</a>`)
      .join('')}</nav>`;

  ui.kpi = ({ label, value, hint = '', ic = 'pulse', tone = '' }) =>
    `<div class="pcard kpi${tone ? ` tone-${tone}` : ''}">
       <div class="kpi-label">${icon(ic, 'i-sm')} ${esc(label)}</div>
       <div class="kpi-value">${value}</div>
       ${hint ? `<div class="kpi-hint">${hint}</div>` : ''}
     </div>`;

  /** Selector de período mensual (etiquetas en español, independiente del idioma del navegador). */
  ui.periodNav = (periodo, action = 'period') => {
    const actual = util.periodOf();
    const opts = [];
    for (let d = 3; d >= -24; d--) opts.push(util.shiftPeriod(actual, d));
    if (!opts.includes(periodo)) opts.push(periodo);
    opts.sort().reverse();
    return `<div class="period-nav" role="group" aria-label="Período">
       ${ui.iconBtn(`${action}-prev`, 'chevron-left', 'Mes anterior')}
       <select data-change="${action}-set" aria-label="Seleccionar período">
         ${opts.map((p) => `<option value="${p}"${p === periodo ? ' selected' : ''}>${util.periodLabel(p)}${p === actual ? ' · en curso' : ''}</option>`).join('')}
       </select>
       ${ui.iconBtn(`${action}-next`, 'chevron-right', 'Mes siguiente')}
     </div>`;
  };

  /* ---------- Tooltip de gráficos ---------- */
  let tip = null;
  doc.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    if (!tip) {
      tip = doc.createElement('div');
      tip.className = 'chart-tip';
      doc.body.appendChild(tip);
    }
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, 90), root.innerWidth - 90)}px`;
    tip.style.top = `${r.top}px`;
  });
  doc.addEventListener('pointerout', (e) => {
    if (tip && e.target.closest('[data-tip]')) tip.hidden = true;
  });
  root.addEventListener('scroll', () => { if (tip) tip.hidden = true; }, { passive: true, capture: true });

  PLX.ui = ui;
})(window);
