/* ==========================================================================
   PARALLAX · Vista: Reservas de salas
   Calendario semanal por sala, reservas para cualquier cliente, cancelación
   (con o sin cargo) y administración de las salas.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, icon, backend, agenda } = PLX;
  const esc = util.esc;
  const R = () => PLX.reglas.reservas;

  /* ---------- Nueva reserva ---------- */
  PLX.forms.reserva = (preset = {}) => {
    const salas = store.all('salas').filter((s) => s.activa !== false);
    if (!salas.length) return ui.toast('Primero cargá una sala.', 'warn');
    const { horas, duraciones } = agenda.opcionesHorario(store.db);
    ui.modal({
      title: 'Nueva reserva',
      sub: 'Se carga como consumo del cliente; las horas incluidas en su abono se descuentan al facturar.',
      submitLabel: 'Reservar',
      body: ui.form([
        { name: 'locatarioId', label: 'Cliente', type: 'select', required: true, placeholder: 'Seleccioná un cliente', options: h.locOptions(), value: preset.locatarioId || '' },
        { name: 'salaId', label: 'Sala', type: 'select', options: salas.map((s) => ({ value: s.id, label: `${s.nombre} · ${s.capacidad || '—'} personas` })), value: preset.salaId || salas[0].id },
        { name: 'fecha', label: 'Fecha', type: 'date', required: true, value: preset.fecha || util.todayStr() },
        { name: 'desde', label: 'Desde', type: 'select', options: horas, value: preset.hora || horas[2] || horas[0] },
        { name: 'duracion', label: 'Duración', type: 'select', options: duraciones, value: 60 },
        { name: 'personas', label: 'Personas', type: 'number', min: 1, step: 1 },
        { name: 'titulo', label: 'Motivo', span: 2, maxlength: 120, placeholder: 'Ej.: reunión con clientes' }
      ]),
      onSubmit(d) {
        const datos = { salaId: d.salaId, locatarioId: d.locatarioId, fecha: d.fecha, desde: d.desde, hasta: agenda.sumar(d.desde, d.duracion), titulo: d.titulo, personas: d.personas };
        const err = R().validar(store.db, datos);
        if (err) { ui.toast(err, 'warn'); return false; }
        const { reserva, consumo } = R().armar(store.db, datos, { id: util.uid('rsv'), consumoId: util.uid('cns'), fecha: new Date().toISOString(), origen: 'administracion' });
        if (consumo) store.insert('consumos', consumo);
        store.insert('reservas', reserva);
        ui.toast(`Reserva confirmada: ${store.get('salas', d.salaId).nombre}, ${util.fmtDate(d.fecha)} de ${datos.desde} a ${datos.hasta}.`);
      }
    });
  };

  function detalle(id) {
    const r = store.get('reservas', id);
    const sala = store.get('salas', r.salaId) || {};
    const cns = r.consumoId ? store.get('consumos', r.consumoId) : null;
    const pol = R().cancelacion(store.db, r);
    ui.modal({
      title: `${sala.nombre} · ${util.fmtDate(r.fecha)}`,
      sub: `${r.desde} a ${r.hasta} · ${esc(h.locName(r.locatarioId))}`,
      size: 'narrow',
      cancelLabel: 'Cerrar',
      footLeft: r.estado !== 'cancelada' && !pol.yaPaso ? `<button type="button" class="btn btn-sm btn-danger" data-maction="cancelar">${icon('x', 'i-sm')} Cancelar</button>${pol.tarde ? `<button type="button" class="btn btn-sm btn-ghost" data-maction="sin-cargo">Cancelar sin cargo</button>` : ''}` : '',
      body: `<dl class="loc-meta">
          <div><dt>Cliente</dt><dd>${esc(h.locName(r.locatarioId))}</dd></div>
          <div><dt>Motivo</dt><dd>${esc(r.titulo || '—')}</dd></div>
          <div><dt>Personas</dt><dd>${r.personas || '—'}</dd></div>
          <div><dt>Reservó</dt><dd>${r.origen === 'miembro' ? 'El miembro' : 'Administración'}</dd></div>
          <div><dt>Cargo</dt><dd>${cns ? `${util.num(cns.cantidad)} × ${util.money(cns.precioUnitario)}` : 'Sin cargo'}</dd></div>
          <div><dt>Estado</dt><dd>${r.estado === 'cancelada' ? 'Cancelada' : 'Confirmada'}</dd></div>
        </dl>
        ${pol.tarde && r.estado !== 'cancelada' && !pol.yaPaso ? `<p class="small muted" style="margin-top:12px">Faltan menos de ${pol.horas} h: según la política, al cancelar se mantiene el cargo. Podés cancelar sin cargo como excepción.</p>` : ''}`,
      onAction: {
        cancelar: () => { try { const x = backend.reservas.cancelarLocal(r.id); ui.close(); ui.toast(x.cargoMantenido ? 'Reserva cancelada; se mantiene el cargo por cancelación tardía.' : 'Reserva cancelada sin cargo.'); } catch (e) { ui.toast(e.message, 'warn'); } },
        'sin-cargo': () => { backend.reservas.cancelarLocal(r.id, { forzarSinCargo: true }); ui.close(); ui.toast('Reserva cancelada sin cargo.'); }
      }
    });
  }

  /* ---------- Salas ---------- */
  PLX.forms.sala = (id) => {
    const s = id ? store.get('salas', id) : null;
    const opts = store.all('insumos').filter((i) => i.tipo === 'tiempo' && i.activo).map((i) => ({ value: i.id, label: `${PLX.h.insLabel(i)} — ${util.money0(i.precio)} / ${i.unidad}` }));
    ui.modal({
      title: s ? s.nombre : 'Nueva sala',
      size: 'narrow',
      body: ui.form([
        { name: 'nombre', label: 'Nombre', required: true, span: 2, maxlength: 60 },
        { name: 'capacidad', label: 'Capacidad (personas)', type: 'number', min: 1, step: 1 },
        { name: 'color', label: 'Color en el calendario', type: 'select', options: [{ value: 'cyan', label: 'Cyan' }, { value: 'magenta', label: 'Magenta' }, { value: 'violet', label: 'Violeta' }] },
        { name: 'insumoId', label: 'Se cobra como', type: 'select', span: 2, options: [{ value: '', label: 'Sin cargo' }].concat(opts), hint: 'Recurso «por tiempo» del Inventario. Las horas incluidas en cada contrato se descuentan.' },
        { name: 'equipamiento', label: 'Equipamiento', span: 2, maxlength: 160 },
        { name: 'activa', label: 'Disponible para reservar', type: 'switch', span: 2 }
      ], s || { color: 'cyan', insumoId: 'ins_sala', activa: true, capacidad: 6 }),
      onSubmit(d) {
        if (s) store.update('salas', s.id, d);
        else store.insert('salas', d, 'sala');
        ui.toast('Sala guardada.');
      }
    });
  };

  PLX.views.reservas = {
    title: 'Reservas de salas',

    render(ctx) {
      const st = ctx.state;
      const tab = ctx.sub === 'salas' ? 'salas' : 'calendario';
      st.lunes = st.lunes || agenda.lunes();
      const hoy = util.todayStr();
      const proximas = store.all('reservas').filter((r) => r.estado !== 'cancelada' && r.fecha >= hoy).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde)).slice(0, 10);
      const head = `
        <div class="page-head">
          <div><h1 class="page-title">Reservas de salas</h1><p class="page-sub">Los miembros reservan solos desde su Área de Miembros; acá ves y administrás todas las reservas.</p></div>
          <div class="page-actions">${tab === 'calendario' ? `<button class="btn btn-primary btn-sm" data-action="nueva">${icon('plus', 'i-sm')} Nueva reserva</button>` : `<button class="btn btn-primary btn-sm" data-action="nueva-sala">${icon('plus', 'i-sm')} Nueva sala</button>`}</div>
        </div>
        ${ui.tabs([{ id: 'calendario', label: 'Calendario', href: '#reservas' }, { id: 'salas', label: 'Salas', href: '#reservas-salas', n: store.all('salas').length }], tab)}`;

      if (tab === 'salas') {
        return `${head}<section class="pcard">${ui.table({
          rows: store.all('salas'),
          empty: 'No hay salas cargadas.',
          cols: [
            { label: 'Sala', primary: true, cell: (s) => `<span class="strong"><i class="ag-dot ag-${esc(s.color || 'cyan')}"></i> ${esc(s.nombre)}</span><span class="sub">${esc(s.equipamiento || '')}</span>` },
            { label: 'Capacidad', cls: 'num', cell: (s) => s.capacidad || '—' },
            { label: 'Se cobra como', cell: (s) => esc(s.insumoId ? h.insLabel(store.get('insumos', s.insumoId)) : 'Sin cargo') },
            { label: 'Estado', cell: (s) => (s.activa !== false ? ui.badge('Disponible', 'cyan', true) : ui.badge('No disponible', 'outline')) },
            { label: '', cls: 'actions', cell: (s) => ui.iconBtn('editar-sala', 'edit', 'Editar sala', `data-id="${s.id}"`) }
          ]
        })}</section>`;
      }

      return `${head}
        <section class="pcard"><div class="pcard-body">${agenda.render({ db: store.db, salaId: st.salaId, lunes: st.lunes, modo: 'admin', nombreDe: (id) => h.locName(id) })}</div></section>
        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head"><h2 class="pcard-title">${icon('calendar', 'i-sm')} Próximas reservas</h2></header>
          <div class="pcard-body flush">${proximas.length ? `<div class="list">${proximas.map((r) => `
            <button type="button" class="list-item link-btn" style="width:100%" data-action="reserva" data-id="${r.id}">
              <span class="avatar"><i class="ag-dot ag-${esc((store.get('salas', r.salaId) || {}).color || 'cyan')}"></i></span>
              <div class="grow"><div class="title">${esc(util.fmtDayShort(r.fecha))} · ${r.desde}–${r.hasta} · ${esc((store.get('salas', r.salaId) || {}).nombre || '')}</div><div class="meta">${esc(h.locName(r.locatarioId))}${r.titulo ? ` · ${esc(r.titulo)}` : ''}${r.origen === 'miembro' ? ' · reservó el miembro' : ''}</div></div>
            </button>`).join('')}</div>` : ui.empty('No hay reservas próximas.', 'calendar')}</div>
        </section>
        <p class="small muted" style="margin-top:12px">Horarios, duración máxima y política de cancelación se definen en Configuración.</p>`;
    },

    actions: {
      nueva: (el, e, ctx) => PLX.forms.reserva({ salaId: ctx.state.salaId }),
      'nueva-sala': () => PLX.forms.sala(),
      'editar-sala': (el) => PLX.forms.sala(el.dataset.id),
      slot: (el, e, ctx) => PLX.forms.reserva({ salaId: ctx.state.salaId || (store.all('salas')[0] || {}).id, fecha: el.dataset.fecha, hora: el.dataset.hora }),
      reserva: (el) => detalle(el.dataset.id),
      'ag-sala'(el, e, ctx) { ctx.state.salaId = el.dataset.sala; ctx.render(); },
      'ag-prev'(el, e, ctx) { ctx.state.lunes = util.addDays(ctx.state.lunes, -7); ctx.render(); },
      'ag-next'(el, e, ctx) { ctx.state.lunes = util.addDays(ctx.state.lunes, 7); ctx.render(); },
      'ag-hoy'(el, e, ctx) { ctx.state.lunes = agenda.lunes(); ctx.render(); }
    }
  };
})(window);
