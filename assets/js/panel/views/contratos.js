/* ==========================================================================
   PARALLAX · Vista: Gestoría de Contratos
   Contratos de locación de servicios (Abonos de Membresía), recursos
   incluidos del inventario y   modalidades de abono. Relación estrictamente comercial entre partes.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, billing, domain, icon } = PLX;
  const esc = util.esc;

  const LEGAL_NOTE = `<div class="note">${icon('contract', 'i-sm')}<div><strong>Contrato de locación de servicios.</strong> Vincula a PARALLAX como prestador de infraestructura y servicios compartidos con el cliente (locatario), en una relación de naturaleza estrictamente comercial entre partes independientes. Cada cliente conserva plena autonomía sobre su organización, su actividad y las personas que designa.</div></div>`;

  /* ---------- Formularios ---------- */
  function siguienteNumero(anio) {
    const max = store.all('contratos')
      .map((c) => (c.numero || '').match(/^PLX-(\d{4})-(\d+)$/))
      .filter((m) => m && m[1] === String(anio))
      .reduce((acc, m) => Math.max(acc, Number(m[2])), 0);
    return `PLX-${anio}-${String(max + 1).padStart(3, '0')}`;
  }

  /** Fila del editor de recursos del contrato. */
  function filaRecurso(contratoId, sel = '', cant = 1) {
    const asig = h.asignaciones();
    const grupos = domain.CATEGORIAS.map((cat) => {
      const ops = store.where('insumos', (i) => i.categoria === cat.id && (i.activo || i.id === sel))
        .sort((a, b) => (a.codigo || a.nombre).localeCompare(b.codigo || b.nombre, 'es', { numeric: true }))
        .map((i) => {
          const ocupado = i.tipo === 'unidad' && asig[i.id] && asig[i.id].id !== contratoId;
          const extra = i.tipo === 'unidad' ? (ocupado ? ` · asignado a ${h.locName(asig[i.id].locatarioId)}` : ' · unidad') : ` · incluido por ${i.unidad}`;
          return `<option value="${i.id}"${i.id === sel ? ' selected' : ''}${ocupado && i.id !== sel ? ' disabled' : ''}>${esc(h.insLabel(i))}${esc(extra)}</option>`;
        });
      return ops.length ? `<optgroup label="${esc(cat.nombre)}">${ops.join('')}</optgroup>` : '';
    }).join('');
    const esUnidad = sel && (store.get('insumos', sel) || {}).tipo === 'unidad';
    return `<div class="item-row">
      <select class="select" aria-label="Recurso"><option value="">Elegí un recurso…</option>${grupos}</select>
      <input class="input num" type="number" min="0" step="1" value="${cant}" aria-label="Cantidad incluida por mes"${esUnidad ? ' disabled' : ''}>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-maction="rm-rec" aria-label="Quitar">${icon('x', 'i-sm')}</button>
    </div>`;
  }

  PLX.forms.contrato = (id, preset = {}) => {
    const c = id ? store.get('contratos', id) : null;
    const hoy = util.todayStr();
    const v = c
      ? Object.assign({}, c)
      : Object.assign({
          numero: siguienteNumero(hoy.slice(0, 4)),
          puestos: 1,
          fechaInicio: hoy,
          fechaFin: util.addDays(util.periodRange(util.shiftPeriod(util.periodOf(), 11)).end, 0),
          ajuste: 'Trimestral por IPC',
          diaVencimiento: 10,
          estado: 'vigente',
          servicios: domain.SERVICIOS_INCLUIDOS.slice(0, 5)
        }, preset);
    const planes = store.all('planes');
    if (!c && !v.planId && planes[0]) v.planId = planes[0].id;
    if (!c && v.montoMensual == null) {
      const p = store.get('planes', v.planId);
      v.montoMensual = p ? p.precioPuesto * (v.puestos || 1) : 0;
    }

    if (!store.all('locatarios').length) {
      ui.toast('Primero creá el legajo del cliente.', 'warn');
      return PLX.forms.legajo();
    }
    const recursosIni = (v.recursos || []).slice();

    ui.modal({
      title: c ? `Contrato ${c.numero}` : 'Nuevo contrato',
      sub: 'Contrato de locación de servicios · Abono de Membresía',
      size: 'wide',
      submitLabel: c ? 'Guardar cambios' : 'Crear contrato',
      body:
        ui.form([
          { type: 'section', label: 'Partes' },
          { name: 'locatarioId', label: 'Cliente (legajo)', type: 'select', required: true, placeholder: 'Seleccioná un cliente', options: h.locOptions(), hint: '¿No figura? Crealo en <a href="#legajos" style="color:var(--cyan)">Legajos</a>.' },
          { name: 'numero', label: 'Número de contrato', required: true, maxlength: 30, cls: 'mono' },
          { type: 'section', label: 'Abono de Membresía' },
          { name: 'planId', label: 'Modalidad', type: 'select', required: true, options: planes.map((p) => ({ value: p.id, label: `${p.nombre} — ${util.money0(p.precioPuesto)} por puesto` })) },
          { name: 'puestos', label: 'Puestos', type: 'number', required: true, min: 1, max: 999, step: 1 },
          { name: 'montoMensual', label: 'Abono mensual (ARS, neto)', type: 'number', required: true, min: 0, step: 0.01, hint: 'Se sugiere según modalidad × puestos; podés ajustarlo.' },
          { name: 'ajuste', label: 'Actualización del abono', type: 'select', options: domain.AJUSTES },
          { name: 'diaVencimiento', label: 'Día de vencimiento de pago', type: 'number', min: 1, max: 28, step: 1 },
          { type: 'section', label: 'Recursos del contrato' },
          { type: 'html', span: 2, html: `
            <p class="small muted" style="margin-bottom:10px">Elegí del <a href="#inventario" style="color:var(--cyan)">Inventario</a> lo que usa este cliente. <strong>Unidades numeradas</strong> (oficina, escritorio, locker, silla) quedan asignadas mientras el contrato esté vigente. <strong>Consumibles y horas</strong> (resmas, hojas, horas de sala) se incluyen por mes en el abono: lo que se use de más se factura como excedente.</p>
            <div id="ct-items" class="items">${recursosIni.map((r) => filaRecurso(c ? c.id : null, r.insumoId, r.cantidad)).join('')}</div>
            <button type="button" class="btn btn-sm" data-maction="add-rec">${icon('plus', 'i-sm')} Agregar recurso</button>` },          { type: 'section', label: 'Vigencia' },
          { name: 'fechaInicio', label: 'Inicio', type: 'date', required: true },
          { name: 'fechaFin', label: 'Finalización', type: 'date', hint: 'Dejar vacío para plazo indeterminado.' },
          { name: 'estado', label: 'Estado', type: 'select', options: domain.ESTADOS_CONTRATO.map((e) => ({ value: e.id, label: e.nombre })), hint: 'Los contratos suspendidos no generan abono.' },
          { name: 'servicios', label: 'Servicios incluidos', type: 'checks', options: domain.SERVICIOS_INCLUIDOS },
          { name: 'notas', label: 'Notas', type: 'textarea', span: 2, placeholder: 'Condiciones particulares acordadas entre las partes.' },
          { type: 'html', span: 2, html: LEGAL_NOTE }
        ], v),
      onAction: {
        'add-rec': () => {
          const cont = document.getElementById('ct-items');
          cont.insertAdjacentHTML('beforeend', filaRecurso(c ? c.id : null));
          cont.lastElementChild.querySelector('select').focus();
        },
        'rm-rec': (el) => el.closest('.item-row').remove()
      },
      onMount(d, form) {
        d.addEventListener('change', (e) => {
          if (!e.target.matches('#ct-items select')) return;
          const i = store.get('insumos', e.target.value);
          const q = e.target.closest('.item-row').querySelector('input');
          if (i && i.tipo === 'unidad') { q.value = 1; q.disabled = true; } else q.disabled = false;
        });
        const monto = form.elements.montoMensual;
        let tocado = !!c;
        monto.addEventListener('input', () => { tocado = true; });
        const sugerir = () => {
          if (tocado) return;
          const p = store.get('planes', form.elements.planId.value);
          const n = Number(form.elements.puestos.value) || 0;
          if (p) monto.value = (p.precioPuesto * n).toFixed(2);
        };
        form.elements.planId.addEventListener('change', sugerir);
        form.elements.puestos.addEventListener('input', sugerir);
      },
      onSubmit(data, form) {
        if (data.fechaFin && data.fechaFin < data.fechaInicio) {
          ui.toast('La finalización no puede ser anterior al inicio.', 'warn');
          form.elements.fechaFin.focus();
          return false;
        }
        const dup = store.all('contratos').find((x) => x.numero === data.numero && (!c || x.id !== c.id));
        if (dup) {
          ui.toast(`Ya existe un contrato con el número ${data.numero}.`, 'warn');
          form.elements.numero.focus();
          return false;
        }
        data.fechaFin = data.fechaFin || null;
        const recursos = Array.from(form.querySelectorAll('#ct-items .item-row'))
          .map((r) => ({ insumoId: r.querySelector('select').value, cantidad: Number(r.querySelector('input').value) || 0 }))
          .filter((x) => x.insumoId && x.cantidad > 0);
        const ids = recursos.map((x) => x.insumoId);
        if (new Set(ids).size !== ids.length) { ui.toast('Hay un recurso repetido en el contrato.', 'warn'); return false; }
        const asig = h.asignaciones();
        const choque = recursos.map((x) => store.get('insumos', x.insumoId)).find((i) => i.tipo === 'unidad' && asig[i.id] && (!c || asig[i.id].id !== c.id) && data.estado !== 'finalizado');
        if (choque) { ui.toast(`${h.insLabel(choque)} ya está asignado al contrato ${asig[choque.id].numero}.`, 'warn'); return false; }
        recursos.forEach((x) => { if (store.get('insumos', x.insumoId).tipo === 'unidad') x.cantidad = 1; });
        data.recursos = recursos;
        if (c) {
          store.update('contratos', c.id, data);
          ui.toast(`Contrato ${data.numero} actualizado.`);
        } else {
          store.insert('contratos', data, 'con');
          ui.toast(`Contrato ${data.numero} creado.`);
        }
      }
    });
  };

  PLX.forms.plan = (id) => {
    const p = id ? store.get('planes', id) : null;
    ui.modal({
      title: p ? p.nombre : 'Nueva modalidad de abono',
      size: 'narrow',
      body: ui.form([
        { name: 'nombre', label: 'Nombre', required: true, span: 2, maxlength: 80 },
        { name: 'precioPuesto', label: 'Precio por puesto / mes (ARS)', type: 'number', min: 0, step: 0.01, required: true, span: 2 },
        { name: 'descripcion', label: 'Descripción', type: 'textarea', span: 2 }
      ], p || {}),
      onSubmit(data) {
        if (p) store.update('planes', p.id, data);
        else store.insert('planes', data, 'plan');
        ui.toast('Modalidad guardada.');
      }
    });
  };

  /* ---------- Render de pestañas ---------- */
  function tabContratos(st) {
    const q = util.normalize(st.q);
    const filtro = st.estado || '';
    const rows = store.all('contratos')
      .map((c) => ({ c, e: billing.estadoContrato(c), l: h.loc(c.locatarioId) }))
      .filter(({ c, e, l }) => {
        if (filtro && e.id !== filtro && !(filtro === 'vigente' && e.id === 'por-vencer')) return false;
        if (!q) return true;
        return util.normalize(`${c.numero} ${l ? l.nombreComercial + ' ' + l.razonSocial : ''} ${h.planName(c.planId)}`).includes(q);
      })
      .sort((a, b) => (a.c.numero < b.c.numero ? -1 : 1));

    const totalVig = util.sum(rows.filter((r) => r.e.id === 'vigente' || r.e.id === 'por-vencer'), (r) => r.c.montoMensual);

    return `
      <div class="toolbar">
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-contratos" type="search" placeholder="Buscar por número, cliente o modalidad" value="${esc(st.q || '')}" data-input="q"></div>
        <select class="select" data-change="estado" aria-label="Filtrar por estado">
          ${[['', 'Todos los estados'], ['vigente', 'Vigentes'], ['por-vencer', 'Por vencer'], ['vencido', 'Vencidos'], ['proximo', 'Próximos a iniciar'], ['suspendido', 'Suspendidos'], ['finalizado', 'Finalizados']]
            .map(([v, l]) => `<option value="${v}"${v === filtro ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <span class="grow"></span>
        <button class="btn btn-sm" data-action="export-contratos">${icon('download', 'i-sm')} Exportar CSV</button>
      </div>
      <section class="pcard">
        ${ui.table({
          rows,
          empty: 'No hay contratos que coincidan con el filtro.',
          emptyIcon: 'contract',
          cols: [
            { label: 'Contrato', primary: true, cell: ({ c }) => `<span class="strong mono">${esc(c.numero)}</span><span class="sub">Locación de servicios</span>` },
            { label: 'Cliente', cell: ({ l }) => l ? `<span class="strong">${esc(l.nombreComercial)}</span><span class="sub"><span class="mono">${esc(l.numeroCliente || '')}</span> · ${esc(l.razonSocial || 'Razón social pendiente')}</span>` : '—' },
            { label: 'Modalidad', cell: ({ c }) => `${esc(h.planName(c.planId))}<span class="sub">${c.puestos} ${c.puestos === 1 ? 'puesto' : 'puestos'}</span>` },
            { label: 'Abono mensual', cls: 'num', cell: ({ c }) => util.money(c.montoMensual) },
            { label: 'Recursos', cell: ({ c }) => {
              const rs = (c.recursos || []).map((r) => store.get('insumos', r.insumoId)).filter(Boolean);
              const u = rs.filter((i) => i.tipo === 'unidad');
              return rs.length ? `<div class="tags">${u.slice(0, 3).map((i) => `<span class="tag is-loan">${esc(i.codigo || i.nombre)}</span>`).join('')}${u.length > 3 ? `<span class="tag">+${u.length - 3}</span>` : ''}${rs.length - u.length ? `<span class="tag">${rs.length - u.length} incluidos</span>` : ''}</div>` : '<span class="muted">—</span>';
            } },
            { label: 'Vigencia', cell: ({ c }) => `<span class="mono small">${util.fmtDate(c.fechaInicio)} → ${c.fechaFin ? util.fmtDate(c.fechaFin) : 'indeterminado'}</span><span class="sub">${esc(c.ajuste || '')}</span>` },
            { label: 'Estado', cell: ({ c }) => h.contratoBadge(c) },
            {
              label: '', cls: 'actions', cell: ({ c }) =>
                ui.iconBtn('editar-contrato', 'edit', 'Editar contrato', `data-id="${c.id}"`) +
                (c.estado === 'vigente'
                  ? ui.iconBtn('suspender', 'minus', 'Suspender contrato', `data-id="${c.id}"`)
                  : ui.iconBtn('reactivar', 'refresh', 'Marcar como vigente', `data-id="${c.id}"`)) +
                ui.iconBtn('eliminar-contrato', 'trash', 'Eliminar contrato', `data-id="${c.id}"`)
            }
          ],
          foot: rows.length ? `<tr><td colspan="3" data-label="">Total abonos vigentes (mensual)</td><td class="num" data-label="Total">${util.money(totalVig)}</td><td colspan="4" data-label=""></td></tr>` : ''
        })}
      </section>`;
  }

  function tabModalidades() {
    const planes = store.all('planes');
    return `
      <section class="pcard">
        ${ui.table({
          rows: planes,
          empty: 'No hay modalidades cargadas.',
          cols: [
            { label: 'Modalidad', primary: true, cell: (p) => `<span class="strong">${esc(p.nombre)}</span>` },
            { label: 'Descripción', cell: (p) => `<span class="text-2 small">${esc(p.descripcion || '')}</span>` },
            { label: 'Precio por puesto / mes', cls: 'num', cell: (p) => util.money(p.precioPuesto) },
            { label: 'Contratos', cls: 'num', cell: (p) => store.where('contratos', (c) => c.planId === p.id).length },
            { label: '', cls: 'actions', cell: (p) => ui.iconBtn('editar-plan', 'edit', 'Editar modalidad', `data-id="${p.id}"`) + ui.iconBtn('eliminar-plan', 'trash', 'Eliminar modalidad', `data-id="${p.id}"`) }
          ]
        })}
      </section>
      <p class="small muted" style="margin-top:12px">El precio por puesto se usa como sugerencia al crear contratos; el abono de cada contrato puede pactarse libremente entre las partes.</p>`;
  }

  PLX.views.contratos = {
    title: 'Gestoría de Contratos',

    render(ctx) {
      const st = ctx.state;
      const tab = ctx.sub === 'modalidades' ? 'modalidades' : 'contratos';
      st[tab] = st[tab] || {};
      const btn = tab === 'contratos'
        ? `<button class="btn btn-primary btn-sm" data-action="nuevo-contrato">${icon('plus', 'i-sm')} Nuevo contrato</button>`
        : `<button class="btn btn-primary btn-sm" data-action="nuevo-plan">${icon('plus', 'i-sm')} Nueva modalidad</button>`;
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Gestoría de Contratos</h1>
            <p class="page-sub">Contratos de locación de servicios, Abonos de Membresía y recursos incluidos para cada cliente.</p>
          </div>
          <div class="page-actions">${btn}</div>
        </div>
        ${ui.tabs([
          { id: 'contratos', label: 'Contratos', href: '#contratos', n: store.all('contratos').length },
          { id: 'modalidades', label: 'Modalidades de abono', href: '#contratos-modalidades', n: store.all('planes').length }
        ], tab)}
        ${tab === 'contratos' ? tabContratos(st[tab]) : tabModalidades()}
        ${tab === 'contratos' ? `<div style="margin-top:16px">${LEGAL_NOTE}</div>` : ''}`;
    },

    inputs: {
      q(el, e, ctx) {
        ctx.state.contratos.q = el.value;
        ctx.render();
      }
    },

    changes: {
      estado(el, e, ctx) {
        ctx.state.contratos.estado = el.value;
        ctx.render();
      }
    },

    actions: {
      'nuevo-contrato': () => PLX.forms.contrato(),
      'nuevo-plan': () => PLX.forms.plan(),
      'editar-contrato': (el) => PLX.forms.contrato(el.dataset.id),
      'editar-plan': (el) => PLX.forms.plan(el.dataset.id),
      suspender: async (el) => {
        const c = store.get('contratos', el.dataset.id);
        const ok = await ui.confirm({ title: 'Suspender contrato', message: `El contrato <strong>${esc(c.numero)}</strong> dejará de generar abono mientras esté suspendido.`, confirmLabel: 'Suspender', danger: true });
        if (ok) { store.update('contratos', c.id, { estado: 'suspendido' }); ui.toast(`Contrato ${c.numero} suspendido.`); }
      },
      reactivar: (el) => {
        const c = store.get('contratos', el.dataset.id);
        store.update('contratos', c.id, { estado: 'vigente' });
        ui.toast(`Contrato ${c.numero} marcado como vigente.`);
      },
      'eliminar-contrato': async (el) => {
        const c = store.get('contratos', el.dataset.id);
        const ok = await ui.confirm({ title: 'Eliminar contrato', message: `Se eliminará el contrato <strong>${esc(c.numero)}</strong>. Los resúmenes ya emitidos se conservan. Para cerrar un vínculo vigente, preferí marcarlo como «Finalizado».`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('contratos', c.id); ui.toast(`Contrato ${c.numero} eliminado.`); }
      },
      'eliminar-plan': async (el) => {
        const p = store.get('planes', el.dataset.id);
        if (store.where('contratos', (c) => c.planId === p.id).length) {
          ui.toast('La modalidad está asignada a contratos; no puede eliminarse.', 'warn');
          return;
        }
        const ok = await ui.confirm({ title: 'Eliminar modalidad', message: `Se eliminará <strong>${esc(p.nombre)}</strong>.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('planes', p.id); ui.toast('Modalidad eliminada.'); }
      },
      'export-contratos': () => {
        const rows = [['Número', 'N° cliente', 'Cliente', 'Razón social', 'CUIT', 'Modalidad', 'Puestos', 'Abono mensual', 'Inicio', 'Finalización', 'Actualización', 'Estado', 'Recursos']];
        store.all('contratos').forEach((c) => {
          const l = h.loc(c.locatarioId) || {};
          rows.push([c.numero, l.numeroCliente, l.nombreComercial, l.razonSocial, l.cuit, h.planName(c.planId), c.puestos, util.csvNum(c.montoMensual), util.fmtDate(c.fechaInicio), c.fechaFin ? util.fmtDate(c.fechaFin) : '', c.ajuste, billing.estadoContrato(c).nombre, (c.recursos || []).map((r) => { const i = store.get('insumos', r.insumoId); return i ? (i.tipo === 'unidad' ? h.insLabel(i) : `${r.cantidad} ${i.unidad} ${i.nombre}`) : ''; }).join(' | ')]);
        });
        util.download(`parallax-contratos-${util.todayStr()}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Contratos exportados.');
      }
    }
  };
})(window);
