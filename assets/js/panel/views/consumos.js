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

  /* ---------- Formularios ---------- */
  PLX.forms.consumo = (id, preset = {}) => {
    const c = id ? store.get('consumos', id) : null;
    const groups = h.insumoGroups({ incluirInactivos: !!c, tipos: ['consumible', 'tiempo', 'unidad'] });
    if (!groups.length) return ui.toast('El inventario está vacío: cargá recursos en Inventario.', 'warn');
    const locOpts = h.locOptions();
    if (!locOpts.length) return ui.toast('Primero creá un legajo.', 'warn');
    const firstIns = store.get('insumos', groups[0].options[0].value);
    const v = c ? Object.assign({}, c) : Object.assign({ fecha: util.todayStr(), cantidad: 1, insumoId: firstIns.id, precioUnitario: firstIns.precio }, preset);

    ui.modal({
      title: c ? 'Editar consumo' : 'Registrar consumo',
      sub: 'Uso de insumos, equipos, mobiliario u horas por un cliente. Lo incluido en su abono se descuenta al facturar.',
      submitLabel: c ? 'Guardar cambios' : 'Registrar consumo',
      body:
        ui.form([
          { name: 'locatarioId', label: 'Cliente', type: 'select', required: true, placeholder: 'Seleccioná un cliente', options: locOpts },
          { name: 'fecha', label: 'Fecha', type: 'date', required: true },
          { name: 'insumoId', label: 'Recurso del inventario', type: 'select', required: true, groups, span: 2 },
          { name: 'cantidad', label: 'Cantidad', type: 'number', required: true, min: 0.01, step: 0.01 },
          { name: 'precioUnitario', label: 'Precio unitario (ARS, neto)', type: 'number', required: true, min: 0, step: 0.01, hint: 'Tomado del inventario; editable para casos puntuales.' },
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
          ui.toast(`Consumo registrado: ${util.num(data.cantidad)} ${ins.unidad} de ${h.insLabel(ins)} · ${h.locName(data.locatarioId)}.`);
        }
        const per = util.periodOf(data.fecha);
        if (billing.emitido(store.db, data.locatarioId, per)) {
          setTimeout(() => ui.toast(`El resumen de ${util.periodLabel(per)} de este locatario ya fue emitido: re-emitilo para incorporar el cambio.`, 'warn'), 400);
        }
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

  /** Lo incluido en el abono frente a lo consumido, para un cliente y período. */
  function excedentes(st) {
    const res = billing.compute(store.db, st.loc, st.periodo);
    if (!res.incluidos.length) return '';
    return `<section class="pcard" style="margin-bottom:16px">
      <header class="pcard-head"><div><h2 class="pcard-title">${icon('contract', 'i-sm')} Incluido en el abono · ${esc(h.locName(st.loc))}</h2><p class="pcard-sub">Lo que supere lo incluido se factura como excedente en ${util.periodLabel(st.periodo)}</p></div></header>
      <div class="pcard-body"><div class="incl-grid">${res.incluidos.map((x) => {
        const pct = x.incluido ? Math.min(100, (x.usado / x.incluido) * 100) : 0;
        const lin = res.lineas.find((l) => l.tipo === 'consumo' && l.insumoId === x.insumoId);
        return `<div class="incl">
          <div class="incl-top"><span>${esc(x.concepto)}</span><span class="mono small">${util.num(x.usado)} / ${util.num(x.incluido)} ${esc(x.unidad)}</span></div>
          <div class="meter" role="img" aria-label="${util.num(x.usado)} de ${util.num(x.incluido)} usados"><i style="width:${pct.toFixed(1)}%"></i></div>
          <span class="small ${lin ? 'is-low' : 'muted'}">${lin ? `Excedente: ${util.num(lin.cantidad)} ${esc(x.unidad)} · ${util.money(lin.neto)}` : `Disponible: ${util.num(Math.max(0, x.incluido - x.usado))} ${esc(x.unidad)}`}</span>
        </div>`;
      }).join('')}</div></div>
    </section>`;
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
        <select class="select" data-change="loc" aria-label="Filtrar por cliente">
          <option value="">Todos los clientes</option>
          ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.loc ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="select" data-change="cat" aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          ${domain.CATEGORIAS.map((c) => `<option value="${c.id}"${c.id === st.cat ? ' selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-consumos" type="search" placeholder="Buscar recurso o detalle" value="${esc(st.q || '')}" data-input="q"></div>
        <button class="btn btn-sm" data-action="export">${icon('download', 'i-sm')} CSV</button>
      </div>

      <div class="chips" aria-label="Totales por categoría">
        ${domain.CATEGORIAS.map((c) => `<button type="button" class="chip" data-action="cat-chip" data-cat="${c.id}" style="${st.cat === c.id ? 'border-color:var(--cyan);color:var(--text)' : ''}">${esc(c.nombre)} <strong>${util.money0(porCat[c.id] || 0)}</strong></button>`).join('')}
        <span class="chip" style="border-color:rgba(63,230,245,.35)">Total del período <strong>${util.money0(util.sum(Object.values(porCat)))}</strong></span>
      </div>

      ${st.loc ? excedentes(st) : ''}

      ${emitidos ? `<div class="note is-magenta" style="margin-bottom:16px">${icon('info', 'i-sm')}<div>Hay <strong>${emitidos}</strong> resúmenes emitidos para ${util.periodLabel(st.periodo)}. Los cambios en consumos de ese período se reflejan al re-emitir el resumen correspondiente.</div></div>` : ''}

      <section class="pcard">
        ${ui.table({
          rows,
          empty: `Sin consumos registrados en ${util.periodLabel(st.periodo)}.`,
          emptyIcon: 'package',
          cols: [
            { label: 'Fecha', cell: (c) => `<span class="mono small">${util.fmtDate(c.fecha)}</span>` },
            { label: 'Cliente', cell: (c) => `<span class="strong">${esc(h.locName(c.locatarioId))}</span>${c.accesoId ? '<span class="sub">desde check-in</span>' : ''}` },
            {
              label: 'Recurso', primary: true, cell: (c) => {
                const ins = store.get('insumos', c.insumoId) || {};
                return `<span class="strong">${esc(h.insLabel(store.get('insumos', c.insumoId)))}</span><span class="sub">${esc(domain.catNombre(ins.categoria))}${c.nota ? ` · ${esc(c.nota)}` : ''}</span>`;
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

  PLX.views.consumos = {
    title: 'Gestoría de Consumos',

    render(ctx) {
      const st = (ctx.state.registro = ctx.state.registro || {});
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Gestoría de Consumos</h1>
            <p class="page-sub">Uso de espacios, equipos, mobiliario, papelería, insumos y horas por cada cliente. Los recursos se administran en <a href="#inventario" style="color:var(--cyan)">Inventario</a>.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary btn-sm" data-action="nuevo">${icon('plus', 'i-sm')} Registrar consumo</button>
          </div>
        </div>
        ${tabRegistro(st)}`;
    },

    inputs: {
      q(el, e, ctx) { ctx.state.registro.q = el.value; ctx.render(); }
    },

    changes: {
      loc(el, e, ctx) { ctx.state.registro.loc = el.value; ctx.render(); },
      cat(el, e, ctx) { ctx.state.registro.cat = el.value; ctx.render(); },
      'period-set'(el, e, ctx) { if (el.value) { ctx.state.registro.periodo = el.value; ctx.render(); } }
    },

    actions: {
      nuevo: (el, e, ctx) => PLX.forms.consumo(null, ctx.state.registro.loc ? { locatarioId: ctx.state.registro.loc } : {}),
      editar: (el) => PLX.forms.consumo(el.dataset.id),
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
        const ok = await ui.confirm({ title: 'Eliminar consumo', message: `Se eliminará el registro de <strong>${esc(h.insLabel(store.get('insumos', c.insumoId)))}</strong> (${util.fmtDate(c.fecha)}) de ${esc(h.locName(c.locatarioId))}.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('consumos', c.id); ui.toast('Consumo eliminado.'); }
      },
      export(el, e, ctx) {
        const st = ctx.state.registro;
        const rows = [['Fecha', 'N° cliente', 'Cliente', 'Razón social', 'Categoría', 'Cuenta contable', 'Recurso', 'Cantidad', 'Unidad', 'Precio unitario', 'Importe neto', 'Detalle']];
        const cfg = store.config();
        filtrar(st).forEach((c) => {
          const ins = store.get('insumos', c.insumoId) || {};
          const l = h.loc(c.locatarioId) || {};
          rows.push([util.fmtDate(c.fecha), l.numeroCliente, l.nombreComercial, l.razonSocial, domain.catNombre(ins.categoria), cfg.cuentas[ins.categoria] || '', h.insLabel(store.get('insumos', c.insumoId)), util.csvNum(c.cantidad), ins.unidad, util.csvNum(c.precioUnitario), util.csvNum(c.cantidad * c.precioUnitario), c.nota]);
        });
        util.download(`parallax-consumos-${st.periodo}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Consumos exportados.');
      }
    }
  };
})(window);
