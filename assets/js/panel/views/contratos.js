/* ==========================================================================
   PARALLAX · Vista: Gestoría de Contratos
   Contratos de locación de servicios (Abonos de Membresía), locatarios y
   modalidades de abono. Relación estrictamente comercial entre partes.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, billing, domain, icon } = PLX;
  const esc = util.esc;

  const LEGAL_NOTE = `<div class="note">${icon('contract', 'i-sm')}<div><strong>Contrato de locación de servicios.</strong> Vincula a PARALLAX como prestador de infraestructura y servicios compartidos con el locatario, en una relación de naturaleza estrictamente comercial entre partes independientes. Cada locatario conserva plena autonomía sobre su organización, su actividad y las personas que designa.</div></div>`;

  /* ---------- Formularios ---------- */
  function siguienteNumero(anio) {
    const max = store.all('contratos')
      .map((c) => (c.numero || '').match(/^PLX-(\d{4})-(\d+)$/))
      .filter((m) => m && m[1] === String(anio))
      .reduce((acc, m) => Math.max(acc, Number(m[2])), 0);
    return `PLX-${anio}-${String(max + 1).padStart(3, '0')}`;
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
          horasSala: 8,
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
      ui.toast('Primero registrá un locatario.', 'warn');
      return PLX.forms.locatario();
    }

    ui.modal({
      title: c ? `Contrato ${c.numero}` : 'Nuevo contrato',
      sub: 'Contrato de locación de servicios · Abono de Membresía',
      size: 'wide',
      submitLabel: c ? 'Guardar cambios' : 'Crear contrato',
      body:
        ui.form([
          { type: 'section', label: 'Partes' },
          { name: 'locatarioId', label: 'Locatario', type: 'select', required: true, placeholder: 'Seleccioná un locatario', options: h.locOptions(), hint: '¿No figura? Registralo en la pestaña «Locatarios».' },
          { name: 'numero', label: 'Número de contrato', required: true, maxlength: 30, cls: 'mono' },
          { type: 'section', label: 'Abono de Membresía' },
          { name: 'planId', label: 'Modalidad', type: 'select', required: true, options: planes.map((p) => ({ value: p.id, label: `${p.nombre} — ${util.money0(p.precioPuesto)} por puesto` })) },
          { name: 'puestos', label: 'Puestos', type: 'number', required: true, min: 1, max: 999, step: 1 },
          { name: 'montoMensual', label: 'Abono mensual (ARS, neto)', type: 'number', required: true, min: 0, step: 0.01, hint: 'Se sugiere según modalidad × puestos; podés ajustarlo.' },
          { name: 'ajuste', label: 'Actualización del abono', type: 'select', options: domain.AJUSTES },
          { name: 'diaVencimiento', label: 'Día de vencimiento de pago', type: 'number', min: 1, max: 28, step: 1 },
          { name: 'horasSala', label: 'Horas de sala incluidas por mes', type: 'number', min: 0, step: 1 },
          { type: 'section', label: 'Vigencia' },
          { name: 'fechaInicio', label: 'Inicio', type: 'date', required: true },
          { name: 'fechaFin', label: 'Finalización', type: 'date', hint: 'Dejar vacío para plazo indeterminado.' },
          { name: 'estado', label: 'Estado', type: 'select', options: domain.ESTADOS_CONTRATO.map((e) => ({ value: e.id, label: e.nombre })), hint: 'Los contratos suspendidos no generan abono.' },
          { name: 'servicios', label: 'Servicios incluidos', type: 'checks', options: domain.SERVICIOS_INCLUIDOS },
          { name: 'notas', label: 'Notas', type: 'textarea', span: 2, placeholder: 'Condiciones particulares acordadas entre las partes.' },
          { type: 'html', span: 2, html: LEGAL_NOTE }
        ], v),
      onMount(d, form) {
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

  PLX.forms.locatario = (id, preset = {}) => {
    const l = id ? store.get('locatarios', id) : null;
    const v = l
      ? Object.assign({}, l, {
          contactoNombre: l.contacto && l.contacto.nombre,
          contactoEmail: l.contacto && l.contacto.email,
          contactoTelefono: l.contacto && l.contacto.telefono
        })
      : Object.assign({ tipo: 'empresa', condicionIva: 'Responsable Inscripto', principal: false }, preset);

    ui.modal({
      title: l ? l.nombreComercial : 'Nuevo locatario',
      sub: 'Empresa o profesional independiente que contrata servicios de PARALLAX.',
      submitLabel: l ? 'Guardar cambios' : 'Registrar locatario',
      body: ui.form([
        { name: 'nombreComercial', label: 'Nombre comercial', required: true, maxlength: 120 },
        { name: 'razonSocial', label: 'Razón social', maxlength: 160, hint: 'Requerida para emitir resúmenes.' },
        { name: 'tipo', label: 'Tipo', type: 'select', options: domain.TIPOS_LOCATARIO.map((t) => ({ value: t.id, label: t.nombre })) },
        { name: 'cuit', label: 'CUIT', placeholder: '30-12345678-9', maxlength: 13, cls: 'mono', attrs: 'data-validate="cuit" inputmode="numeric"' },
        { name: 'condicionIva', label: 'Condición frente al IVA', type: 'select', options: domain.CONDICIONES_IVA },
        { name: 'domicilio', label: 'Domicilio', maxlength: 200 },
        { type: 'section', label: 'Contacto administrativo' },
        { name: 'contactoNombre', label: 'Nombre', maxlength: 120 },
        { name: 'contactoEmail', label: 'Email', type: 'email', maxlength: 160 },
        { name: 'contactoTelefono', label: 'Teléfono', type: 'tel', maxlength: 40 },
        { name: 'principal', label: 'Cuenta principal', type: 'switch', hint: 'Se destaca en listados y resúmenes.' },
        { name: 'notas', label: 'Notas', type: 'textarea', span: 2 }
      ], v),
      onSubmit(data) {
        const rec = {
          nombreComercial: data.nombreComercial,
          razonSocial: data.razonSocial,
          tipo: data.tipo,
          cuit: util.fmtCuit(data.cuit),
          condicionIva: data.condicionIva,
          domicilio: data.domicilio,
          principal: !!data.principal,
          contacto: { nombre: data.contactoNombre, email: data.contactoEmail, telefono: data.contactoTelefono },
          notas: data.notas
        };
        if (l) {
          store.update('locatarios', l.id, rec);
          ui.toast(`Locatario ${rec.nombreComercial} actualizado.`);
        } else {
          const nuevo = store.insert('locatarios', rec, 'loc');
          ui.toast(`Locatario ${rec.nombreComercial} registrado.`);
          if (preset.onCreated) preset.onCreated(nuevo);
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
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-contratos" type="search" placeholder="Buscar por número, locatario o modalidad" value="${esc(st.q || '')}" data-input="q"></div>
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
            { label: 'Locatario', cell: ({ l }) => l ? `<span class="strong">${esc(l.nombreComercial)}</span><span class="sub">${esc(l.razonSocial || 'Razón social pendiente')}</span>` : '—' },
            { label: 'Modalidad', cell: ({ c }) => `${esc(h.planName(c.planId))}<span class="sub">${c.puestos} ${c.puestos === 1 ? 'puesto' : 'puestos'}</span>` },
            { label: 'Abono mensual', cls: 'num', cell: ({ c }) => util.money(c.montoMensual) },
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
          foot: rows.length ? `<tr><td colspan="3" data-label="">Total abonos vigentes (mensual)</td><td class="num" data-label="Total">${util.money(totalVig)}</td><td colspan="3" data-label=""></td></tr>` : ''
        })}
      </section>`;
  }

  function tabLocatarios(st) {
    const q = util.normalize(st.q);
    const locs = store.all('locatarios')
      .filter((l) => !q || util.normalize(`${l.nombreComercial} ${l.razonSocial} ${l.cuit}`).includes(q))
      .sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || a.nombreComercial.localeCompare(b.nombreComercial));

    const cards = locs.map((l) => {
      const ca = h.contratoActivo(l.id);
      const nPers = store.where('personas', (p) => p.locatarioId === l.id).length;
      const tipo = domain.TIPOS_LOCATARIO.find((t) => t.id === l.tipo);
      return `
        <article class="pcard loc-card">
          <div class="loc-card-head">
            <span class="avatar">${esc(util.initials(l.nombreComercial))}</span>
            <div class="grow">
              <h3>${esc(l.nombreComercial)}</h3>
              <p class="rs">${l.razonSocial ? esc(l.razonSocial) : '<span style="color:#f0a0fa">Razón social pendiente</span>'}</p>
            </div>
          </div>
          <div class="loc-badges">
            ${l.principal ? ui.badge('Cuenta principal', 'grad') : ''}
            ${ui.badge(tipo ? tipo.nombre : 'Empresa', 'outline')}
            ${l.demo ? ui.badge('Demo', 'outline') : ''}
          </div>
          <dl class="loc-meta">
            <div><dt>CUIT</dt><dd class="mono">${l.cuit ? esc(l.cuit) : '<span style="color:#f0a0fa">Pendiente</span>'}</dd></div>
            <div><dt>Condición IVA</dt><dd>${esc(l.condicionIva || '—')}</dd></div>
            <div><dt>Contrato vigente</dt><dd>${ca ? `<span class="mono">${esc(ca.numero)}</span><br><span class="muted small">${esc(h.planName(ca.planId))}</span>` : '<span class="muted">Sin contrato vigente</span>'}</dd></div>
            <div><dt>Personas autorizadas</dt><dd>${nPers}</dd></div>
            <div style="grid-column:1/-1"><dt>Contacto</dt><dd>${l.contacto && (l.contacto.nombre || l.contacto.email) ? `${esc(l.contacto.nombre || '')} ${l.contacto.email ? `<a href="mailto:${esc(l.contacto.email)}" style="color:var(--cyan)">${esc(l.contacto.email)}</a>` : ''}` : '<span class="muted">Sin datos</span>'}</dd></div>
          </dl>
          <div class="loc-card-foot">
            <button class="btn btn-xs" data-action="editar-locatario" data-id="${l.id}">${icon('edit', 'i-sm')} Editar</button>
            <button class="btn btn-xs" data-action="contrato-para" data-id="${l.id}">${icon('plus', 'i-sm')} Contrato</button>
            <a class="btn btn-xs" href="#/facturacion" data-action="ver-gastos" data-id="${l.id}">${icon('receipt', 'i-sm')} Gastos</a>
            <button class="btn btn-xs btn-ghost" data-action="eliminar-locatario" data-id="${l.id}" aria-label="Eliminar locatario">${icon('trash', 'i-sm')}</button>
          </div>
        </article>`;
    }).join('');

    return `
      <div class="toolbar">
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-locatarios" type="search" placeholder="Buscar por nombre, razón social o CUIT" value="${esc(st.q || '')}" data-input="q"></div>
      </div>
      ${locs.length ? `<div class="grid grid-cards">${cards}</div>` : `<section class="pcard">${ui.empty('No hay locatarios que coincidan.', 'office')}</section>`}`;
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
      const tab = ['locatarios', 'modalidades'].includes(ctx.sub) ? ctx.sub : 'contratos';
      st[tab] = st[tab] || {};
      const btn = {
        contratos: `<button class="btn btn-primary btn-sm" data-action="nuevo-contrato">${icon('plus', 'i-sm')} Nuevo contrato</button>`,
        locatarios: `<button class="btn btn-primary btn-sm" data-action="nuevo-locatario">${icon('plus', 'i-sm')} Nuevo locatario</button>`,
        modalidades: `<button class="btn btn-primary btn-sm" data-action="nuevo-plan">${icon('plus', 'i-sm')} Nueva modalidad</button>`
      }[tab];
      const body = tab === 'contratos' ? tabContratos(st[tab]) : tab === 'locatarios' ? tabLocatarios(st[tab]) : tabModalidades();
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Gestoría de Contratos</h1>
            <p class="page-sub">Contratos de locación de servicios y Abonos de Membresía de cada locatario.</p>
          </div>
          <div class="page-actions">${btn}</div>
        </div>
        ${ui.tabs([
          { id: 'contratos', label: 'Contratos', href: '#/contratos', n: store.all('contratos').length },
          { id: 'locatarios', label: 'Locatarios', href: '#/contratos/locatarios', n: store.all('locatarios').length },
          { id: 'modalidades', label: 'Modalidades de abono', href: '#/contratos/modalidades', n: store.all('planes').length }
        ], tab)}
        ${body}
        ${tab === 'contratos' ? `<div style="margin-top:16px">${LEGAL_NOTE}</div>` : ''}`;
    },

    inputs: {
      q(el, e, ctx) {
        const tab = ['locatarios', 'modalidades'].includes(ctx.sub) ? ctx.sub : 'contratos';
        ctx.state[tab].q = el.value;
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
      'nuevo-locatario': () => PLX.forms.locatario(),
      'nuevo-plan': () => PLX.forms.plan(),
      'editar-contrato': (el) => PLX.forms.contrato(el.dataset.id),
      'editar-locatario': (el) => PLX.forms.locatario(el.dataset.id),
      'editar-plan': (el) => PLX.forms.plan(el.dataset.id),
      'contrato-para': (el) => PLX.forms.contrato(null, { locatarioId: el.dataset.id }),
      'ver-gastos': (el, e) => {
        const st = (PLX.app.state.facturacion = PLX.app.state.facturacion || {});
        st.locatarioId = el.dataset.id;
        location.hash = '#/facturacion';
      },
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
      'eliminar-locatario': async (el) => {
        const l = store.get('locatarios', el.dataset.id);
        const usos = ['contratos', 'consumos', 'accesos', 'personas', 'resumenes'].reduce((n, col) => n + store.where(col, (x) => x.locatarioId === l.id).length, 0);
        if (usos) {
          ui.toast(`${l.nombreComercial} tiene contratos o registros asociados; no puede eliminarse.`, 'warn');
          return;
        }
        const ok = await ui.confirm({ title: 'Eliminar locatario', message: `Se eliminará <strong>${esc(l.nombreComercial)}</strong>.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('locatarios', l.id); ui.toast('Locatario eliminado.'); }
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
        const rows = [['Número', 'Locatario', 'Razón social', 'CUIT', 'Modalidad', 'Puestos', 'Abono mensual', 'Inicio', 'Finalización', 'Actualización', 'Estado']];
        store.all('contratos').forEach((c) => {
          const l = h.loc(c.locatarioId) || {};
          rows.push([c.numero, l.nombreComercial, l.razonSocial, l.cuit, h.planName(c.planId), c.puestos, util.csvNum(c.montoMensual), util.fmtDate(c.fechaInicio), c.fechaFin ? util.fmtDate(c.fechaFin) : '', c.ajuste, billing.estadoContrato(c).nombre]);
        });
        util.download(`parallax-contratos-${util.todayStr()}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Contratos exportados.');
      }
    }
  };
})(window);
