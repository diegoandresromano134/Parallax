/* ==========================================================================
   PARALLAX · Vista: Check-in / Check-out (Control de Accesos)
   Planilla de ingresos y egresos: quién ingresó (N° de cliente), a qué hora,
   qué espacio se le asignó, qué solicitó y, al salir, si devolvió todo.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, domain, icon } = PLX;
  const esc = util.esc;
  const PUNTOS = ['Recepción', 'Cochera', 'Acceso de servicio'];
  const PAGE = 60;

  const NOTA = `<div class="note">${icon('shield', 'i-sm')}<div>La planilla registra el uso de las instalaciones y de los recursos prestados, para la seguridad del espacio y la imputación de consumos a cada cliente. Cada cliente organiza su actividad con plena autonomía y designa por sí mismo a las personas autorizadas a ingresar.</div></div>`;

  /* ---------- Opciones de recursos según el cliente ---------- */
  function opcionesRecursos(locId, { soloEspacios = false, seleccion = '' } = {}) {
    const asig = h.asignaciones();
    const uso = h.enUso();
    const grupos = domain.CATEGORIAS
      .filter((c) => (soloEspacios ? c.id === 'espacios' : true))
      .map((c) => {
        const items = store.where('insumos', (i) => i.categoria === c.id && i.activo && (!soloEspacios || i.tipo === 'unidad'))
          .sort((a, b) => (a.codigo || a.nombre).localeCompare(b.codigo || b.nombre, 'es', { numeric: true }))
          .map((i) => {
            let nota = '';
            let disabled = false;
            if (i.tipo === 'unidad') {
              if (i.estado === 'mantenimiento') { nota = ' · en mantenimiento'; disabled = true; }
              else if (uso[i.id]) { nota = ` · en uso (${uso[i.id].nombre})`; disabled = true; }
              else if (asig[i.id]) {
                if (asig[i.id].locatarioId === locId) nota = ' · asignado por contrato';
                else { nota = ` · asignado a ${h.locName(asig[i.id].locatarioId)}`; disabled = true; }
              }
            }
            const sel = i.id === seleccion ? ' selected' : '';
            return `<option value="${i.id}"${disabled && !sel ? ' disabled' : ''}${sel}>${esc(h.insLabel(i))} — ${util.money0(i.precio)} / ${esc(i.unidad)}${esc(nota)}</option>`;
          });
        return items.length ? `<optgroup label="${esc(c.nombre)}">${items.join('')}</optgroup>` : '';
      })
      .join('');
    return grupos;
  }

  function espacioContrato(locId) {
    const c = h.contratoActivo(locId);
    if (!c) return '';
    const r = (c.recursos || []).map((x) => store.get('insumos', x.insumoId)).find((i) => i && i.categoria === 'espacios' && i.tipo === 'unidad');
    return r ? r.id : '';
  }

  const itemRow = (locId, sel = '', cant = 1) => `
    <div class="item-row">
      <select class="select" aria-label="Recurso solicitado"><option value="">Elegí un recurso…</option>${opcionesRecursos(locId, { seleccion: sel })}</select>
      <input class="input num" type="number" min="1" step="1" value="${cant}" aria-label="Cantidad">
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-maction="rm-item" aria-label="Quitar">${icon('x', 'i-sm')}</button>
    </div>`;

  /* ---------- Check-in ---------- */
  PLX.forms.checkin = (preset = {}) => {
    const locOpts = h.locOptions();
    if (!locOpts.length) return ui.toast('Primero creá un legajo.', 'warn');
    let locId = preset.locatarioId || locOpts[0].value;
    const personaOpts = (id) => h.personaOptions(id).map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('') + '<option value="__otra">Visita u otra persona…</option>';

    ui.modal({
      title: 'Check-in',
      sub: 'Ingreso de una persona, espacio asignado y recursos que solicita.',
      size: 'wide',
      submitLabel: 'Registrar check-in',
      body: `
        ${ui.form([
          { name: 'locatarioId', label: 'Cliente (N° de cliente)', type: 'select', required: true, options: locOpts, value: locId },
          { type: 'html', html: `<div class="field"><label for="ci-persona">Persona que ingresa<span class="req">*</span></label><select class="select" id="ci-persona" name="personaId">${personaOpts(locId)}</select></div>` },
          { name: 'nombreOtra', label: 'Nombre de la visita', maxlength: 120, hint: 'Solo si no figura entre las personas autorizadas.' },
          { name: 'ingreso', label: 'Fecha y hora de ingreso', type: 'datetime-local', required: true, value: util.toLocalInput(new Date()) },
          { type: 'html', html: `<div class="field"><label for="ci-espacio">Espacio asignado</label><select class="select" id="ci-espacio" name="espacioId"><option value="">Sin espacio asignado</option>${opcionesRecursos(locId, { soloEspacios: true, seleccion: espacioContrato(locId) })}</select><span class="hint">Escritorio, oficina o suite donde va a trabajar.</span></div>` },
          { name: 'punto', label: 'Punto de acceso', type: 'select', options: PUNTOS, value: 'Recepción' },
          { type: 'section', label: 'Recursos solicitados' },
          { type: 'html', span: 2, html: `
            <div id="ci-items" class="items">${preset.items ? preset.items.map((x) => itemRow(locId, x.insumoId, x.cantidad)).join('') : ''}</div>
            <button type="button" class="btn btn-sm" data-maction="add-item">${icon('plus', 'i-sm')} Agregar recurso</button>
            <p class="small muted" style="margin-top:10px">Las unidades numeradas (computadora, monitor, adaptador) quedan a cargo de la persona y se verifican al salir. Consumibles y horas se cargan como consumos; lo incluido en el abono se descuenta a fin de mes.</p>` },
          { name: 'nota', label: 'Observaciones', span: 2, maxlength: 200 }
        ], {})}`,
      onMount(d, form) {
        const selLoc = form.elements.locatarioId;
        const selPer = d.querySelector('#ci-persona');
        const otra = form.elements.nombreOtra;
        const syncOtra = () => {
          const es = selPer.value === '__otra';
          otra.closest('.field').style.display = es ? '' : 'none';
          otra.required = es;
        };
        if (preset.personaId) selPer.value = preset.personaId;
        selLoc.addEventListener('change', () => {
          locId = selLoc.value;
          selPer.innerHTML = personaOpts(locId);
          d.querySelector('#ci-espacio').innerHTML = `<option value="">Sin espacio asignado</option>${opcionesRecursos(locId, { soloEspacios: true, seleccion: espacioContrato(locId) })}`;
          d.querySelectorAll('#ci-items .item-row select').forEach((s) => { const v = s.value; s.innerHTML = `<option value="">Elegí un recurso…</option>${opcionesRecursos(locId, { seleccion: v })}`; });
          syncOtra();
        });
        selPer.addEventListener('change', syncOtra);
        syncOtra();
      },
      onAction: {
        'add-item': () => {
          const cont = document.getElementById('ci-items');
          cont.insertAdjacentHTML('beforeend', itemRow(locId));
          cont.lastElementChild.querySelector('select').focus();
        },
        'rm-item': (el) => el.closest('.item-row').remove()
      },
      onSubmit(data, form) {
        const items = Array.from(form.querySelectorAll('#ci-items .item-row'))
          .map((r) => ({ insumoId: r.querySelector('select').value, cantidad: Number(r.querySelector('input').value) || 0 }))
          .filter((x) => x.insumoId && x.cantidad > 0);
        const ids = items.map((x) => x.insumoId);
        if (new Set(ids).size !== ids.length) { ui.toast('Hay un recurso repetido: sumá la cantidad en una sola fila.', 'warn'); return false; }
        if (data.espacioId && ids.includes(data.espacioId)) { ui.toast('El espacio asignado ya figura como recurso solicitado.', 'warn'); return false; }
        items.forEach((x) => { const i = store.get('insumos', x.insumoId); if (i.tipo === 'unidad') x.cantidad = 1; });
        const cuando = new Date(data.ingreso);
        if (cuando > new Date(Date.now() + 5 * 60000)) { ui.toast('El ingreso no puede registrarse en el futuro.', 'warn'); return false; }
        const r = h.checkin({
          locatarioId: data.locatarioId,
          personaId: data.personaId === '__otra' ? null : data.personaId,
          nombre: data.personaId === '__otra' ? `${data.nombreOtra} (visita)` : '',
          cuando, espacioId: data.espacioId || null, items, punto: data.punto, nota: data.nota
        });
        if (!r.ok) { ui.toast(r.motivo, 'warn'); return false; }
        const prest = r.acceso.items.filter((x) => x.devolver).length;
        ui.toast(`Check-in registrado: ${r.acceso.nombre} (${r.acceso.numeroCliente}) a las ${util.fmtTime(r.acceso.ingreso)}${prest ? ` · ${prest} ${prest === 1 ? 'recurso a devolver' : 'recursos a devolver'}` : ''}.`);
      }
    });
  };

  /* ---------- Check-out con verificación ---------- */
  PLX.forms.checkout = (accesoId) => {
    const a = store.get('accesos', accesoId);
    if (!a || a.egreso) return ui.toast('Ese check-in ya está cerrado.', 'warn');
    const aDevolver = (a.items || []).filter((x) => x.devolver);
    const entregados = (a.items || []).filter((x) => !x.devolver);
    const espacio = a.espacioId ? store.get('insumos', a.espacioId) : null;
    const filas = [...(espacio ? [{ insumoId: espacio.id, esEspacio: true }] : []), ...aDevolver];
    const radios = (id, esEspacio) => domain.ESTADOS_DEVOLUCION.map((e, k) => `
      <label class="seg"><input type="radio" name="dev-${id}" value="${e.id}"${k === 0 ? ' checked' : ''}><span>${esEspacio && e.id === 'ok' ? 'En orden' : esEspacio && e.id === 'faltante' ? 'Faltan elementos' : e.nombre}</span></label>`).join('');

    ui.modal({
      title: 'Check-out',
      sub: `${esc(a.nombre)} · ${esc(a.numeroCliente || '')} ${esc(h.locName(a.locatarioId))} · ingresó a las ${util.fmtTime(a.ingreso)} (${util.fmtDuration(Date.now() - new Date(a.ingreso))})`,
      size: 'wide',
      submitLabel: 'Registrar check-out',
      body: `
        <div class="checklist">
          <h3 class="ficha-title">${icon('check', 'i-sm')} Verificación de devolución</h3>
          ${filas.length ? filas.map((x) => {
            const i = store.get('insumos', x.insumoId);
            return `<div class="check-row" data-id="${x.insumoId}">
              <div class="check-what"><strong>${esc(h.insLabel(i))}</strong><span class="sub">${x.esEspacio ? 'Espacio asignado' : 'Recurso prestado'}</span></div>
              <div class="segs" role="radiogroup" aria-label="Estado de ${esc(h.insLabel(i))}">${radios(x.insumoId, x.esEspacio)}</div>
              <input class="input" placeholder="Detalle (opcional)" aria-label="Detalle de ${esc(h.insLabel(i))}" data-nota="${x.insumoId}">
            </div>`;
          }).join('') : '<p class="small muted">No tiene recursos prestados ni espacio asignado para verificar.</p>'}
          ${entregados.length ? `<p class="small muted" style="margin-top:12px">Entregado en el ingreso (no se devuelve): ${entregados.map((x) => `${util.num(x.cantidad)} × ${esc(h.insLabel(store.get('insumos', x.insumoId)))}`).join(', ')}.</p>` : ''}
        </div>
        ${ui.form([
          { name: 'egreso', label: 'Hora de salida', type: 'datetime-local', required: true, value: util.toLocalInput(new Date()) },
          { name: 'cargoMonto', label: 'Cargo por reposición o daño (ARS)', type: 'number', min: 0, step: 0.01, hint: 'Opcional. Se suma a los consumos del cliente.' },
          { name: 'cargoDetalle', label: 'Detalle del cargo', span: 2, maxlength: 160 },
          { name: 'observaciones', label: 'Observaciones generales', type: 'textarea', span: 2 }
        ], {})}`,
      onSubmit(data, form) {
        const devoluciones = {};
        let espacioNota = '';
        filas.forEach((x) => {
          const estado = (form.querySelector(`input[name="dev-${x.insumoId}"]:checked`) || {}).value || 'ok';
          const nota = (form.querySelector(`[data-nota="${x.insumoId}"]`) || {}).value || '';
          if (x.esEspacio) { if (estado !== 'ok') espacioNota = `Espacio ${h.insLabel(store.get('insumos', x.insumoId))}: ${estado === 'faltante' ? 'faltan elementos' : 'con daños'}${nota ? ` (${nota})` : ''}.`; }
          else devoluciones[x.insumoId] = { estado, nota };
        });
        const obs = [espacioNota, data.observaciones].filter(Boolean).join(' ');
        const r = h.checkout(a.id, {
          cuando: new Date(data.egreso),
          devoluciones,
          observaciones: obs,
          cargo: data.cargoMonto ? { monto: data.cargoMonto, detalle: data.cargoDetalle } : null
        });
        if (!r.ok) { ui.toast(r.motivo, 'warn'); return false; }
        if (espacioNota && !r.observado) store.update('accesos', a.id, { estado: 'observado' });
        const obsFinal = r.observado || !!espacioNota;
        ui.toast(obsFinal ? `Check-out con observaciones: ${a.nombre}. Quedó marcado para seguimiento.` : `Check-out completo: ${a.nombre} devolvió todo.`, obsFinal ? 'warn' : 'ok');
      }
    });
  };

  /* ---------- Detalle de un registro ---------- */
  function detalle(id) {
    const a = store.get('accesos', id);
    const est = h.estadoAcceso(a);
    const espacio = a.espacioId ? store.get('insumos', a.espacioId) : null;
    const devNombre = (d) => (d ? (domain.ESTADOS_DEVOLUCION.find((e) => e.id === d.estado) || {}).nombre : 'Pendiente');
    ui.modal({
      title: `Registro · ${a.nombre}`,
      sub: `${esc(a.numeroCliente || '')} ${esc(h.locName(a.locatarioId))} · ${util.fmtDateTime(a.ingreso)}${a.egreso ? ` → ${util.fmtTime(a.egreso)}` : ''}`,
      cancelLabel: 'Cerrar',
      footLeft: a.estado === 'observado' ? `<button type="button" class="btn btn-sm btn-outline-cyan" data-maction="resolver">${icon('check', 'i-sm')} Marcar como resuelto</button>` : (!a.egreso ? `<button type="button" class="btn btn-sm btn-outline-cyan" data-maction="checkout">${icon('logout', 'i-sm')} Hacer check-out</button>` : ''),
      body: `
        <dl class="loc-meta ficha-grid">
          <div><dt>Estado</dt><dd>${ui.badge(est.nombre, est.tone, true)}</dd></div>
          <div><dt>Credencial</dt><dd class="mono">${esc(a.credencial || '—')}</dd></div>
          <div><dt>Espacio</dt><dd>${espacio ? esc(h.insLabel(espacio)) : '—'}</dd></div>
          <div><dt>Permanencia</dt><dd>${util.fmtDuration((a.egreso ? new Date(a.egreso) : Date.now()) - new Date(a.ingreso))}</dd></div>
        </dl>
        <h3 class="ficha-title" style="margin-top:18px">${icon('package', 'i-sm')} Recursos solicitados</h3>
        ${(a.items || []).length ? `<ul class="doc-list">${a.items.map((x) => `<li><div class="grow"><strong>${util.num(x.cantidad)} × ${esc(h.insLabel(store.get('insumos', x.insumoId)))}</strong><span class="sub">${x.devolver ? `A devolver · ${devNombre(x.devolucion)}${x.devolucion && x.devolucion.nota ? ` · ${esc(x.devolucion.nota)}` : ''}` : 'Entregado (no se devuelve)'}</span></div>${x.devolver ? ui.badge(devNombre(x.devolucion), !x.devolucion ? 'outline' : x.devolucion.estado === 'ok' ? 'cyan' : 'magenta', true) : ''}</li>`).join('')}</ul>` : '<p class="small muted">No solicitó recursos.</p>'}
        ${a.observaciones ? `<div class="note is-magenta" style="margin-top:14px">${icon('alert', 'i-sm')}<div>${esc(a.observaciones)}</div></div>` : ''}
        ${a.nota ? `<p class="small muted" style="margin-top:10px">Nota del ingreso: ${esc(a.nota)}</p>` : ''}`,
      onAction: {
        checkout: () => PLX.forms.checkout(a.id),
        resolver: () => ui.modal({
          title: 'Resolver observación',
          size: 'narrow',
          submitLabel: 'Marcar como resuelto',
          body: ui.form([{ name: 'nota', label: '¿Cómo se resolvió?', type: 'textarea', span: 2, required: true, placeholder: 'Ej.: devolvió el adaptador el día siguiente.' }]),
          onSubmit(d) {
            const items = (a.items || []).map((x) => (x.devolver && x.devolucion && x.devolucion.estado !== 'ok' ? Object.assign({}, x, { devolucion: Object.assign({}, x.devolucion, { resuelto: true }) }) : x));
            store.update('accesos', a.id, { estado: 'completo', items, observaciones: `${a.observaciones ? `${a.observaciones} · ` : ''}Resuelto el ${util.fmtDate(util.todayStr())}: ${d.nota}` });
            ui.toast('Observación resuelta.');
          }
        })
      }
    });
  }

  PLX.forms.acceso = (id) => {
    const a = store.get('accesos', id);
    ui.modal({
      title: 'Corregir horarios',
      sub: `${esc(a.nombre)} · ${esc(h.locName(a.locatarioId))}`,
      body: ui.form([
        { name: 'ingreso', label: 'Ingreso', type: 'datetime-local', required: true },
        { name: 'egreso', label: 'Egreso', type: 'datetime-local', hint: 'Para registrar la salida con verificación usá «Check-out».' },
        { name: 'punto', label: 'Punto de acceso', type: 'select', options: PUNTOS },
        { name: 'nota', label: 'Observaciones del ingreso', maxlength: 200 }
      ], { ingreso: util.toLocalInput(a.ingreso), egreso: a.egreso ? util.toLocalInput(a.egreso) : '', punto: a.punto, nota: a.nota }),
      onSubmit(data) {
        const ing = new Date(data.ingreso);
        const egr = data.egreso ? new Date(data.egreso) : null;
        if (egr && egr < ing) { ui.toast('El egreso no puede ser anterior al ingreso.', 'warn'); return false; }
        if (!a.egreso && egr && (a.items || []).some((x) => x.devolver)) { ui.toast('Tiene recursos prestados: registrá la salida con «Check-out» para verificar la devolución.', 'warn'); return false; }
        store.update('accesos', a.id, { ingreso: ing.toISOString(), egreso: egr ? egr.toISOString() : null, punto: data.punto, nota: data.nota, estado: egr ? (a.estado === 'abierto' ? 'completo' : a.estado) : 'abierto' });
        ui.toast('Registro actualizado.');
      }
    });
  };

  /* ---------- Tabla de la planilla ---------- */
  function tabla(rows, vacio) {
    return ui.table({
      rows,
      empty: vacio,
      emptyIcon: 'badge',
      cols: [
        { label: 'N° cliente', cell: (a) => `<span class="strong mono">${esc(a.numeroCliente || '—')}</span><span class="sub">${esc(h.locName(a.locatarioId))}</span>` },
        { label: 'Persona', primary: true, cell: (a) => `<button type="button" class="link-btn" data-action="detalle" data-id="${a.id}"><span class="strong">${esc(a.nombre)}</span></button><span class="sub mono">${esc(a.credencial || 'Visita')}</span>` },
        { label: 'Ingreso', cls: 'num', cell: (a) => `${util.fmtTime(a.ingreso)}<span class="sub">${util.fmtDate(util.localDateOfIso(a.ingreso))}</span>` },
        { label: 'Espacio', cell: (a) => { const e = a.espacioId ? store.get('insumos', a.espacioId) : null; return e ? `<span class="mono small nowrap">${esc(e.codigo || e.nombre)}</span>` : '<span class="muted">—</span>'; } },
        {
          label: 'Solicitó', cell: (a) => (a.items || []).length
            ? `<div class="tags">${a.items.map((x) => { const i = store.get('insumos', x.insumoId) || {}; const t = i.codigo && i.tipo === 'unidad' ? i.codigo : `${util.num(x.cantidad)} × ${i.nombre || ''}`; const mal = x.devolucion && x.devolucion.estado !== 'ok' && !x.devolucion.resuelto; return `<span class="tag${x.devolver ? ' is-loan' : ''}${mal ? ' is-bad' : ''}" title="${esc(h.insLabel(i))}">${esc(t.trim())}</span>`; }).join('')}</div>`
            : '<span class="muted">—</span>'
        },
        { label: 'Salida', cls: 'num', cell: (a) => (a.egreso ? `${util.fmtTime(a.egreso)}<span class="sub">${util.fmtDuration(new Date(a.egreso) - new Date(a.ingreso))}</span>` : `<span class="sub">${util.fmtDuration(Date.now() - new Date(a.ingreso))}</span>`) },
        { label: 'Devolución', cell: (a) => { const e = h.estadoAcceso(a); const pend = !a.egreso && (a.items || []).some((x) => x.devolver); return ui.badge(pend ? 'A devolver' : e.nombre, e.tone, true); } },
        {
          label: '', cls: 'actions', cell: (a) =>
            (a.egreso ? '' : `<button type="button" class="btn btn-xs btn-outline-cyan" data-action="checkout" data-id="${a.id}">${icon('logout', 'i-sm')} Check-out</button>`) +
            ui.iconBtn('detalle', 'eye', 'Ver detalle', `data-id="${a.id}"`) +
            ui.iconBtn('editar', 'edit', 'Corregir horarios', `data-id="${a.id}"`) +
            ui.iconBtn('eliminar', 'trash', 'Eliminar registro', `data-id="${a.id}"`)
        }
      ]
    });
  }

  function tabDia(st) {
    st.dia = st.dia || util.todayStr();
    const esHoy = st.dia === util.todayStr();
    const delDia = store.all('accesos').filter((a) => util.localDateOfIso(a.ingreso) === st.dia);
    const abiertosOtros = esHoy ? store.all('accesos').filter((a) => !a.egreso && util.localDateOfIso(a.ingreso) !== st.dia) : [];
    const rows = delDia.concat(abiertosOtros).sort((a, b) => (a.egreso ? 1 : 0) - (b.egreso ? 1 : 0) || b.ingreso.localeCompare(a.ingreso));
    const adentro = rows.filter((a) => !a.egreso).length;
    const prestados = rows.filter((a) => !a.egreso).reduce((n, a) => n + (a.items || []).filter((x) => x.devolver).length, 0);
    const obs = store.all('accesos').filter((a) => a.estado === 'observado');

    return `
      <div class="scanner">
        <span class="scan-icon">${icon('scan', 'i-lg')}</span>
        <div>
          <div class="lbl">N° de cliente o credencial · abre el check-in o, si la persona ya está adentro, el check-out</div>
          <input class="input" id="scan-cred" placeholder="Ej.: CL-0005 o CR-1001" autocomplete="off" data-enter="scan" aria-label="Número de cliente o credencial">
        </div>
        <button class="btn btn-outline-cyan" data-action="scan">${icon('check', 'i-sm')} Continuar</button>
      </div>

      ${obs.length ? `<div class="note is-magenta" style="margin-bottom:16px">${icon('alert', 'i-sm')}<div><strong>${obs.length} ${obs.length === 1 ? 'registro con observaciones' : 'registros con observaciones'}</strong> (faltantes o daños sin resolver): ${obs.slice(0, 4).map((a) => `<button type="button" class="link-btn" data-action="detalle" data-id="${a.id}">${esc(a.nombre)} · ${util.fmtDate(util.localDateOfIso(a.ingreso))}</button>`).join(', ')}${obs.length > 4 ? '…' : ''}</div></div>` : ''}

      <div class="toolbar">
        <div class="period-nav" role="group" aria-label="Día de la planilla">
          ${ui.iconBtn('dia-prev', 'chevron-left', 'Día anterior')}
          <strong>${esc(util.fmtDateLong(st.dia))}</strong>
          ${ui.iconBtn('dia-next', 'chevron-right', 'Día siguiente', esHoy ? 'disabled' : '')}
        </div>
        ${esHoy ? '' : `<button class="btn btn-xs btn-ghost" data-action="dia-hoy">Volver a hoy</button>`}
        <span class="grow"></span>
        <span class="chip">Check-ins <strong>${delDia.length}</strong></span>
        <span class="chip">En el espacio <strong>${adentro}</strong></span>
        <span class="chip">Recursos prestados <strong>${prestados}</strong></span>
        <button class="btn btn-sm" data-action="export-dia">${icon('download', 'i-sm')} CSV</button>
      </div>

      <section class="pcard">
        <header class="pcard-head">
          <div>
            <h2 class="pcard-title">${icon('clock', 'i-sm')} Planilla ${esHoy ? 'de hoy' : 'del día'}</h2>
            <p class="pcard-sub">Primero quienes están en el espacio; luego los check-outs.${abiertosOtros.length ? ` Incluye ${abiertosOtros.length} ingresos abiertos de días anteriores.` : ''}</p>
          </div>
        </header>
        <div class="pcard-body flush">${tabla(rows, esHoy ? 'Todavía no hay check-ins hoy.' : 'Sin registros ese día.')}</div>
      </section>`;
  }

  function filtrarHist(st) {
    const q = util.normalize(st.q);
    return store.all('accesos').filter((a) => {
      const d = util.localDateOfIso(a.ingreso);
      if (st.desde && d < st.desde) return false;
      if (st.hasta && d > st.hasta) return false;
      if (st.loc && a.locatarioId !== st.loc) return false;
      if (st.estado === 'observado' && a.estado !== 'observado') return false;
      if (st.estado === 'prestamo' && !(a.items || []).some((x) => x.devolver)) return false;
      if (q && !util.normalize(`${a.nombre} ${a.credencial} ${a.numeroCliente}`).includes(q)) return false;
      return true;
    }).sort((a, b) => b.ingreso.localeCompare(a.ingreso));
  }

  function tabHistorial(st) {
    const hoy = util.todayStr();
    st.desde = st.desde == null ? util.addDays(hoy, -13) : st.desde;
    st.hasta = st.hasta == null ? hoy : st.hasta;
    st.limit = st.limit || PAGE;
    const rows = filtrarHist(st);
    const ms = util.sum(rows, (a) => (a.egreso ? new Date(a.egreso) : Date.now()) - new Date(a.ingreso));
    return `
      <div class="toolbar">
        <label class="small muted" for="h-desde">Desde</label>
        <input class="input" id="h-desde" type="date" value="${esc(st.desde)}" data-change="desde">
        <label class="small muted" for="h-hasta">Hasta</label>
        <input class="input" id="h-hasta" type="date" value="${esc(st.hasta)}" data-change="hasta">
        <select class="select" data-change="loc" aria-label="Filtrar por cliente">
          <option value="">Todos los clientes</option>
          ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.loc ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="select" data-change="estado" aria-label="Filtrar por estado">
          <option value="">Todos los registros</option>
          <option value="prestamo"${st.estado === 'prestamo' ? ' selected' : ''}>Con recursos prestados</option>
          <option value="observado"${st.estado === 'observado' ? ' selected' : ''}>Con observaciones</option>
        </select>
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-hist" type="search" placeholder="Persona, credencial o N° de cliente" value="${esc(st.q || '')}" data-input="q"></div>
        <button class="btn btn-sm" data-action="export-hist">${icon('download', 'i-sm')} CSV</button>
      </div>
      <section class="pcard">
        <header class="pcard-head"><div><h2 class="pcard-title">${icon('archive', 'i-sm')} Historial</h2><p class="pcard-sub">${rows.length} registros · ${util.num(util.round2(ms / 3600000))} h de permanencia</p></div></header>
        <div class="pcard-body flush">${tabla(rows.slice(0, st.limit), 'Sin registros en el rango seleccionado.')}</div>
        ${rows.length > st.limit ? `<div class="more-row"><button class="btn btn-sm" data-action="mas">Mostrar más (${rows.length - st.limit} restantes)</button></div>` : ''}
      </section>`;
  }

  function csv(rows, nombre) {
    const out = [['Fecha', 'N° cliente', 'Cliente', 'Persona', 'Credencial', 'Ingreso', 'Salida', 'Permanencia (h)', 'Espacio', 'Solicitó', 'Devolución', 'Observaciones']];
    rows.forEach((a) => {
      const ms = (a.egreso ? new Date(a.egreso) : Date.now()) - new Date(a.ingreso);
      const e = a.espacioId ? store.get('insumos', a.espacioId) : null;
      out.push([
        util.fmtDate(util.localDateOfIso(a.ingreso)), a.numeroCliente, h.locName(a.locatarioId), a.nombre, a.credencial,
        util.fmtTime(a.ingreso), a.egreso ? util.fmtTime(a.egreso) : '', util.csvNum(ms / 3600000), e ? h.insLabel(e) : '',
        (a.items || []).map((x) => `${x.cantidad} × ${h.insLabel(store.get('insumos', x.insumoId))}`).join(' | '),
        h.estadoAcceso(a).nombre, a.observaciones
      ]);
    });
    util.download(nombre, util.toCsv(out), 'text/csv;charset=utf-8');
    ui.toast('Planilla exportada.');
  }

  PLX.views.checkin = {
    title: 'Check-in / Check-out',

    render(ctx) {
      const tab = ctx.sub === 'historial' ? 'historial' : 'dia';
      const st = (ctx.state[tab] = ctx.state[tab] || {});
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Check-in / Check-out</h1>
            <p class="page-sub">Control de Accesos: quién ingresó, a qué hora, qué espacio y recursos se le asignaron, y si devolvió todo al salir.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary btn-sm" data-action="nuevo">${icon('login', 'i-sm')} Nuevo check-in</button>
          </div>
        </div>
        ${ui.tabs([
          { id: 'dia', label: 'Planilla del día', href: '#checkin' },
          { id: 'historial', label: 'Historial', href: '#checkin-historial' }
        ], tab)}
        ${tab === 'dia' ? tabDia(st) : tabHistorial(st)}
        <div style="margin-top:16px">${NOTA}</div>`;
    },

    inputs: { q(el, e, ctx) { ctx.state.historial.q = el.value; ctx.state.historial.limit = PAGE; ctx.render(); } },
    changes: {
      desde(el, e, ctx) { ctx.state.historial.desde = el.value; ctx.render(); },
      hasta(el, e, ctx) { ctx.state.historial.hasta = el.value; ctx.render(); },
      loc(el, e, ctx) { ctx.state.historial.loc = el.value; ctx.render(); },
      estado(el, e, ctx) { ctx.state.historial.estado = el.value; ctx.render(); }
    },
    actions: {
      nuevo: () => PLX.forms.checkin(),
      checkout: (el) => PLX.forms.checkout(el.dataset.id),
      detalle: (el) => detalle(el.dataset.id),
      editar: (el) => PLX.forms.acceso(el.dataset.id),
      scan() {
        const input = document.getElementById('scan-cred');
        const r = h.buscarCredencial(input.value);
        if (!r) { ui.toast(`No se encontró «${input.value.trim()}». Probá con el N° de cliente (CL-0001) o la credencial (CR-1001).`, 'warn'); input.select(); return; }
        input.value = '';
        const abierto = r.persona && store.all('accesos').find((a) => a.personaId === r.persona.id && !a.egreso);
        if (abierto) return PLX.forms.checkout(abierto.id);
        if (r.persona && !r.persona.habilitada) return ui.toast(`La credencial ${r.persona.credencial} está inhabilitada.`, 'warn');
        PLX.forms.checkin({ locatarioId: r.loc.id, personaId: r.persona ? r.persona.id : '' });
      },
      'dia-prev'(el, e, ctx) { ctx.state.dia.dia = util.addDays(ctx.state.dia.dia, -1); ctx.render(); },
      'dia-next'(el, e, ctx) { if (ctx.state.dia.dia < util.todayStr()) { ctx.state.dia.dia = util.addDays(ctx.state.dia.dia, 1); ctx.render(); } },
      'dia-hoy'(el, e, ctx) { ctx.state.dia.dia = util.todayStr(); ctx.render(); },
      mas(el, e, ctx) { ctx.state.historial.limit += PAGE; ctx.render(); },
      async eliminar(el) {
        const a = store.get('accesos', el.dataset.id);
        const vinc = store.where('consumos', (c) => c.accesoId === a.id);
        const ok = await ui.confirm({ title: 'Eliminar registro', message: `Se eliminará el check-in de <strong>${esc(a.nombre)}</strong> del ${util.fmtDateTime(a.ingreso)}.${vinc.length ? ` También se eliminarán ${vinc.length} consumos generados por ese check-in.` : ''}`, confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        vinc.forEach((c) => store.remove('consumos', c.id));
        store.remove('accesos', a.id);
        ui.toast('Registro eliminado.');
      },
      'export-dia'(el, e, ctx) {
        const d = ctx.state.dia.dia;
        csv(store.all('accesos').filter((a) => util.localDateOfIso(a.ingreso) === d).sort((a, b) => a.ingreso.localeCompare(b.ingreso)), `parallax-planilla-${d}.csv`);
      },
      'export-hist'(el, e, ctx) { csv(filtrarHist(ctx.state.historial), `parallax-checkin-${util.todayStr()}.csv`); }
    }
  };

  PLX.checkin = { detalle };
})(window);
