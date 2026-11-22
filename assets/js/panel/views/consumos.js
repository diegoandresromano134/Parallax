/* ==========================================================================
   PARALLAX · Vista: Gestoría de Consumos
   Registro exacto del uso de utilería, mobiliario, papelería, otros insumos y
   servicios adicionales por parte de cada locatario.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, billing, domain, icon } = PLX;
  const esc = util.esc;
  const UNIDADES = ['unidad', 'página', 'hora', 'día', 'mes', 'kg', 'bloque', 'envío', 'litro', 'caja'];

  /* ---------- Formularios ---------- */
  PLX.forms.consumo = (id, preset = {}) => {
    const c = id ? store.get('consumos', id) : null;
    const groups = h.insumoGroups(!!c);
    if (!groups.length) return ui.toast('El catálogo de insumos está vacío.', 'warn');
    const locOpts = h.locOptions();
    if (!locOpts.length) return ui.toast('Primero registrá un locatario.', 'warn');
    const firstIns = store.get('insumos', groups[0].options[0].value);
    const v = c ? Object.assign({}, c) : Object.assign({ fecha: util.todayStr(), cantidad: 1, insumoId: firstIns.id, precioUnitario: firstIns.precio }, preset);

    ui.modal({
      title: c ? 'Editar consumo' : 'Registrar consumo',
      sub: 'Uso de insumos, mobiliario, utilería o servicios adicionales por un locatario.',
      submitLabel: c ? 'Guardar cambios' : 'Registrar consumo',
      body:
        ui.form([
          { name: 'locatarioId', label: 'Locatario', type: 'select', required: true, placeholder: 'Seleccioná un locatario', options: locOpts },
          { name: 'fecha', label: 'Fecha', type: 'date', required: true },
          { name: 'insumoId', label: 'Insumo o servicio', type: 'select', required: true, groups, span: 2 },
          { name: 'cantidad', label: 'Cantidad', type: 'number', required: true, min: 0.01, step: 0.01 },
          { name: 'precioUnitario', label: 'Precio unitario (ARS, neto)', type: 'number', required: true, min: 0, step: 0.01, hint: 'Tomado del catálogo; editable para casos puntuales.' },
          { name: 'nota', label: 'Detalle u observación', span: 2, maxlength: 200 }
        ], v) + '<div class="calc-line" style="margin-top:16px"><span id="calc-desc">Importe</span><strong id="calc-total">$ 0,00</strong></div>',
      onMount(d, form) {
        const calc = () => {
          const ins = store.get('insumos', form.elements.insumoId.value);
          const q = Number(form.elements.cantidad.value) || 0;
          const pu = Number(form.elements.precioUnitario.value) || 0;
          d.querySelector('#calc-desc').textContent = ins ? `${util.num(q)} ${ins.unidad} × ${util.money(pu)}` : 'Importe';
          d.querySelector('#calc-total').textContent = util.money(q * pu);
        };
        form.elements.insumoId.addEventListener('change', () => {
          const ins = store.get('insumos', form.elements.insumoId.value);
          if (ins) form.elements.precioUnitario.value = ins.precio;
          calc();
        });
        form.elements.cantidad.addEventListener('input', calc);
        form.elements.precioUnitario.addEventListener('input', calc);
        calc();
      },
      onSubmit(data) {
        if (c) {
          store.update('consumos', c.id, data);
          ui.toast('Consumo actualizado.');
        } else {
          store.insert('consumos', data, 'cns');
          const ins = store.get('insumos', data.insumoId);
          ui.toast(`Consumo registrado: ${util.num(data.cantidad)} ${ins.unidad} de ${ins.nombre} · ${h.locName(data.locatarioId)}.`);
        }
        const per = util.periodOf(data.fecha);
        if (billing.emitido(store.db, data.locatarioId, per)) {
          setTimeout(() => ui.toast(`El resumen de ${util.periodLabel(per)} de este locatario ya fue emitido: re-emitilo para incorporar el cambio.`, 'warn'), 400);
        }
      }
    });
  };

  PLX.forms.insumo = (id) => {
    const i = id ? store.get('insumos', id) : null;
    ui.modal({
      title: i ? i.nombre : 'Nuevo insumo o servicio',
      size: 'narrow',
      body: ui.form([
        { name: 'nombre', label: 'Nombre', required: true, span: 2, maxlength: 120 },
        { name: 'categoria', label: 'Categoría', type: 'select', options: domain.CATEGORIAS.map((c) => ({ value: c.id, label: c.nombre })) },
        { name: 'unidad', label: 'Unidad', type: 'select', options: UNIDADES },
        { name: 'precio', label: 'Precio unitario (ARS, neto)', type: 'number', min: 0, step: 0.01, required: true, span: 2 },
        { name: 'activo', label: 'Disponible para registrar consumos', type: 'switch', span: 2 }
      ], i || { categoria: 'papeleria', unidad: 'unidad', activo: true }),
      onSubmit(data) {
        if (i) store.update('insumos', i.id, data);
        else store.insert('insumos', data, 'ins');
        ui.toast('Catálogo actualizado.');
      }
    });
  };

  /* ---------- Render ---------- */
  function filtrar(st) {
    const q = util.normalize(st.q);
    return billing.consumosDelPeriodo(store.db, st.loc || null, st.periodo)
      .filter((c) => {
        const ins = store.get('insumos', c.insumoId) || {};
        if (st.cat && ins.categoria !== st.cat) return false;
        if (q && !util.normalize(`${ins.nombre} ${c.nota} ${h.locName(c.locatarioId)}`).includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creadoEn || '').localeCompare(a.creadoEn || ''));
  }

  function tabRegistro(st) {
    st.periodo = st.periodo || util.periodOf();
    const rows = filtrar(st);
    const total = util.sum(rows, (c) => c.cantidad * c.precioUnitario);
    const porCat = {};
    billing.consumosDelPeriodo(store.db, st.loc || null, st.periodo).forEach((c) => {
      const ins = store.get('insumos', c.insumoId) || {};
      porCat[ins.categoria] = (porCat[ins.categoria] || 0) + c.cantidad * c.precioUnitario;
    });
    const emitidos = store.all('resumenes').filter((r) => r.periodo === st.periodo && r.estado === 'emitido').length;

    return `
      <div class="toolbar">
        ${ui.periodNav(st.periodo)}
        <select class="select" data-change="loc" aria-label="Filtrar por locatario">
          <option value="">Todos los locatarios</option>
          ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.loc ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="select" data-change="cat" aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          ${domain.CATEGORIAS.map((c) => `<option value="${c.id}"${c.id === st.cat ? ' selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-consumos" type="search" placeholder="Buscar insumo o detalle" value="${esc(st.q || '')}" data-input="q"></div>
        <button class="btn btn-sm" data-action="export">${icon('download', 'i-sm')} CSV</button>
      </div>

      <div class="chips" aria-label="Totales por categoría">
        ${domain.CATEGORIAS.map((c) => `<button type="button" class="chip" data-action="cat-chip" data-cat="${c.id}" style="${st.cat === c.id ? 'border-color:var(--cyan);color:var(--text)' : ''}">${esc(c.nombre)} <strong>${util.money0(porCat[c.id] || 0)}</strong></button>`).join('')}
        <span class="chip" style="border-color:rgba(63,230,245,.35)">Total del período <strong>${util.money0(util.sum(Object.values(porCat)))}</strong></span>
      </div>

      ${emitidos ? `<div class="note is-magenta" style="margin-bottom:16px">${icon('info', 'i-sm')}<div>Hay <strong>${emitidos}</strong> resúmenes emitidos para ${util.periodLabel(st.periodo)}. Los cambios en consumos de ese período se reflejan al re-emitir el resumen correspondiente.</div></div>` : ''}

      <section class="pcard">
        ${ui.table({
          rows,
          empty: `Sin consumos registrados en ${util.periodLabel(st.periodo)}.`,
          emptyIcon: 'package',
          cols: [
            { label: 'Fecha', cell: (c) => `<span class="mono small">${util.fmtDate(c.fecha)}</span>` },
            { label: 'Locatario', cell: (c) => `<span class="strong">${esc(h.locName(c.locatarioId))}</span>` },
            {
              label: 'Insumo', primary: true, cell: (c) => {
                const ins = store.get('insumos', c.insumoId) || {};
                return `<span class="strong">${esc(ins.nombre || 'Insumo eliminado')}</span><span class="sub">${esc(domain.catNombre(ins.categoria))}${c.nota ? ` · ${esc(c.nota)}` : ''}</span>`;
              }
            },
            { label: 'Cantidad', cls: 'num', cell: (c) => `${util.num(c.cantidad)} <span class="muted">${esc((store.get('insumos', c.insumoId) || {}).unidad || '')}</span>` },
            { label: 'P. unitario', cls: 'num', cell: (c) => util.money(c.precioUnitario) },
            { label: 'Importe', cls: 'num', cell: (c) => `<span class="strong">${util.money(c.cantidad * c.precioUnitario)}</span>` },
            { label: '', cls: 'actions', cell: (c) => ui.iconBtn('editar', 'edit', 'Editar consumo', `data-id="${c.id}"`) + ui.iconBtn('eliminar', 'trash', 'Eliminar consumo', `data-id="${c.id}"`) }
          ],
          foot: rows.length ? `<tr><td colspan="5" data-label="">${rows.length} registros${st.cat || st.loc || st.q ? ' (filtrados)' : ''}</td><td class="num" data-label="Total">${util.money(total)}</td><td data-label=""></td></tr>` : ''
        })}
      </section>`;
  }

  function tabCatalogo(st) {
    const usos = {};
    store.all('consumos').forEach((c) => (usos[c.insumoId] = (usos[c.insumoId] || 0) + 1));
    const rows = store.all('insumos')
      .filter((i) => !st.cat || i.categoria === st.cat)
      .sort((a, b) => domain.CATEGORIAS.findIndex((c) => c.id === a.categoria) - domain.CATEGORIAS.findIndex((c) => c.id === b.categoria) || a.nombre.localeCompare(b.nombre));
    return `
      <div class="toolbar">
        <select class="select" data-change="cat" aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          ${domain.CATEGORIAS.map((c) => `<option value="${c.id}"${c.id === st.cat ? ' selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
      </div>
      <section class="pcard">
        ${ui.table({
          rows,
          empty: 'No hay insumos en esta categoría.',
          emptyIcon: 'package',
          cols: [
            { label: 'Insumo o servicio', primary: true, cell: (i) => `<span class="strong">${esc(i.nombre)}</span>` },
            { label: 'Categoría', cell: (i) => ui.badge(domain.catNombre(i.categoria), 'outline') },
            { label: 'Unidad', cell: (i) => esc(i.unidad) },
            { label: 'Precio unitario', cls: 'num', cell: (i) => util.money(i.precio) },
            { label: 'Registros', cls: 'num', cell: (i) => usos[i.id] || 0 },
            { label: 'Estado', cell: (i) => (i.activo ? ui.badge('Disponible', 'cyan', true) : ui.badge('Pausado', 'outline', true)) },
            {
              label: '', cls: 'actions', cell: (i) =>
                ui.iconBtn('editar-insumo', 'edit', 'Editar insumo', `data-id="${i.id}"`) +
                ui.iconBtn('toggle-insumo', i.activo ? 'minus' : 'check', i.activo ? 'Pausar' : 'Reactivar', `data-id="${i.id}"`) +
                ui.iconBtn('eliminar-insumo', 'trash', 'Eliminar insumo', `data-id="${i.id}"`)
            }
          ]
        })}
      </section>
      <p class="small muted" style="margin-top:12px">Cada consumo guarda el precio unitario vigente al momento de registrarlo: actualizar el catálogo no modifica registros anteriores.</p>`;
  }

  PLX.views.consumos = {
    title: 'Gestoría de Consumos',

    render(ctx) {
      const tab = ctx.sub === 'catalogo' ? 'catalogo' : 'registro';
      const st = (ctx.state[tab] = ctx.state[tab] || {});
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Gestoría de Consumos</h1>
            <p class="page-sub">Registro del uso de utilería, mobiliario, papelería y otros insumos por cada locatario.</p>
          </div>
          <div class="page-actions">
            ${tab === 'registro'
              ? `<button class="btn btn-primary btn-sm" data-action="nuevo">${icon('plus', 'i-sm')} Registrar consumo</button>`
              : `<button class="btn btn-primary btn-sm" data-action="nuevo-insumo">${icon('plus', 'i-sm')} Nuevo insumo</button>`}
          </div>
        </div>
        ${ui.tabs([
          { id: 'registro', label: 'Registro de consumos', href: '#/consumos' },
          { id: 'catalogo', label: 'Catálogo de insumos', href: '#/consumos/catalogo', n: store.all('insumos').length }
        ], tab)}
        ${tab === 'registro' ? tabRegistro(st) : tabCatalogo(st)}`;
    },

    inputs: {
      q(el, e, ctx) { ctx.state.registro.q = el.value; ctx.render(); }
    },

    changes: {
      loc(el, e, ctx) { ctx.state.registro.loc = el.value; ctx.render(); },
      cat(el, e, ctx) {
        const tab = ctx.sub === 'catalogo' ? 'catalogo' : 'registro';
        ctx.state[tab].cat = el.value;
        ctx.render();
      },
      'period-set'(el, e, ctx) { if (el.value) { ctx.state.registro.periodo = el.value; ctx.render(); } }
    },

    actions: {
      nuevo: (el, e, ctx) => PLX.forms.consumo(null, ctx.state.registro.loc ? { locatarioId: ctx.state.registro.loc } : {}),
      'nuevo-insumo': () => PLX.forms.insumo(),
      editar: (el) => PLX.forms.consumo(el.dataset.id),
      'editar-insumo': (el) => PLX.forms.insumo(el.dataset.id),
      'period-prev'(el, e, ctx) { ctx.state.registro.periodo = util.shiftPeriod(ctx.state.registro.periodo, -1); ctx.render(); },
      'period-next'(el, e, ctx) { ctx.state.registro.periodo = util.shiftPeriod(ctx.state.registro.periodo, 1); ctx.render(); },
      'cat-chip'(el, e, ctx) {
        const st = ctx.state.registro;
        st.cat = st.cat === el.dataset.cat ? '' : el.dataset.cat;
        ctx.render();
      },
      async eliminar(el) {
        const c = store.get('consumos', el.dataset.id);
        const ins = store.get('insumos', c.insumoId) || {};
        const ok = await ui.confirm({ title: 'Eliminar consumo', message: `Se eliminará el registro de <strong>${esc(ins.nombre || 'insumo')}</strong> (${util.fmtDate(c.fecha)}) de ${esc(h.locName(c.locatarioId))}.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('consumos', c.id); ui.toast('Consumo eliminado.'); }
      },
      'toggle-insumo'(el) {
        const i = store.get('insumos', el.dataset.id);
        store.update('insumos', i.id, { activo: !i.activo });
        ui.toast(`${i.nombre}: ${i.activo ? 'disponible' : 'pausado'}.`);
      },
      async 'eliminar-insumo'(el) {
        const i = store.get('insumos', el.dataset.id);
        if (store.where('consumos', (c) => c.insumoId === i.id).length) {
          ui.toast('El insumo tiene consumos registrados: pausalo en lugar de eliminarlo.', 'warn');
          return;
        }
        const ok = await ui.confirm({ title: 'Eliminar insumo', message: `Se eliminará <strong>${esc(i.nombre)}</strong> del catálogo.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('insumos', i.id); ui.toast('Insumo eliminado.'); }
      },
      export(el, e, ctx) {
        const st = ctx.state.registro;
        const rows = [['Fecha', 'Locatario', 'Razón social', 'Categoría', 'Cuenta contable', 'Insumo', 'Cantidad', 'Unidad', 'Precio unitario', 'Importe neto', 'Detalle']];
        const cfg = store.config();
        filtrar(st).forEach((c) => {
          const ins = store.get('insumos', c.insumoId) || {};
          const l = h.loc(c.locatarioId) || {};
          rows.push([util.fmtDate(c.fecha), l.nombreComercial, l.razonSocial, domain.catNombre(ins.categoria), cfg.cuentas[ins.categoria] || '', ins.nombre, util.csvNum(c.cantidad), ins.unidad, util.csvNum(c.precioUnitario), util.csvNum(c.cantidad * c.precioUnitario), c.nota]);
        });
        util.download(`parallax-consumos-${st.periodo}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Consumos exportados.');
      }
    }
  };
})(window);
