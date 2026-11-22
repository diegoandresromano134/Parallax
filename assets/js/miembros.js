/* ==========================================================================
   PARALLAX · Área de Miembros
   Credencial digital, contrato y lo que incluye, consumos del mes,
   resúmenes de gastos, documentos, solicitudes y datos personales.
   Cada miembro ve solo su propia información (ver core/scope.js).
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, billing, backend, ui, icon, domain } = PLX;
  const esc = util.esc;
  const $ = (s) => document.querySelector(s);
  const view = $('#pm-view');

  let D = null;
  const st = { periodo: util.periodOf(), tipoSolicitud: '' };

  /* ---------- Datos del miembro ---------- */
  const datos = () => (backend.mode === 'servidor' ? store.db : PLX.scope.miembro(store.db, backend.user.locatarioId));
  const loc = () => D.locatarios[0] || null;
  const ins = (id) => D.insumos.find((i) => i.id === id) || null;
  const insLabel = (i) => (i ? (i.codigo ? `${i.codigo} · ${i.nombre}` : i.nombre) : 'Recurso');
  const planName = (id) => (D.planes.find((p) => p.id === id) || {}).nombre || '—';
  function contratoVigente() {
    const hoy = util.todayStr();
    return D.contratos.filter((c) => c.estado === 'vigente' && c.fechaInicio <= hoy && (!c.fechaFin || c.fechaFin >= hoy))
      .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio))[0] || D.contratos[0] || null;
  }
  const abierto = () => D.accesos.find((a) => !a.egreso) || null;

  function meters(res) {
    if (!res.incluidos.length) return '<p class="small muted">Tu abono no incluye cantidades mensuales de insumos u horas.</p>';
    return `<div class="incl-grid">${res.incluidos.map((x) => {
      const pct = x.incluido ? Math.min(100, (x.usado / x.incluido) * 100) : 0;
      const lin = res.lineas.find((l) => l.tipo === 'consumo' && l.insumoId === x.insumoId);
      return `<div class="incl">
        <div class="incl-top"><span>${esc(x.concepto)}</span><span class="mono small">${util.num(x.usado)} / ${util.num(x.incluido)} ${esc(x.unidad)}</span></div>
        <div class="meter" role="img" aria-label="${util.num(x.usado)} de ${util.num(x.incluido)} ${esc(x.unidad)} usados"><i style="width:${pct.toFixed(1)}%"></i></div>
        <span class="small ${lin ? 'is-low' : 'muted'}">${lin ? `Excedente: ${util.num(lin.cantidad)} ${esc(x.unidad)} · ${util.money(lin.neto)}` : `Te quedan ${util.num(Math.max(0, x.incluido - x.usado))} ${esc(x.unidad)}`}</span>
      </div>`;
    }).join('')}</div>`;
  }

  /* ---------- Vistas ---------- */
  const views = {
    inicio() {
      const l = loc();
      const c = contratoVigente();
      const a = abierto();
      const p = util.periodOf();
      const res = billing.compute(D, l.id, p);
      const ultimos = D.accesos.slice().sort((x, y) => y.ingreso.localeCompare(x.ingreso)).slice(0, 6);
      const nombre = l.nombre || l.nombreComercial;
      const desde = l.fechaContrato || (c && c.fechaInicio);
      const devolver = a ? (a.items || []).filter((x) => x.devolver) : [];

      return `
        <section class="member-hero">
          <article class="mcard" aria-label="Credencial de miembro">
            <div class="mcard-top">
              <img src="assets/img/favicon.svg" alt="" width="36" height="36">
              <span class="mcard-kind">Miembro</span>
            </div>
            <div class="mcard-name">${esc(l.nombreComercial)}</div>
            <div class="mcard-num mono">${esc(l.numeroCliente || '')}</div>
            <div class="mcard-foot">
              <div><span>Membresía</span><strong>${c ? esc(planName(c.planId)) : 'Sin contrato vigente'}</strong></div>
              <div><span>Miembro desde</span><strong>${desde ? util.fmtDate(desde) : '—'}</strong></div>
            </div>
            <div class="mcard-holo" aria-hidden="true"></div>
          </article>
          <div class="member-status">
            <p class="eyebrow">Hola, ${esc(nombre)}</p>
            ${a
              ? `<h1 class="member-now">Estás en el espacio <span class="neon-text">desde las ${util.fmtTime(a.ingreso)}</span></h1>
                 <p class="text-2">${a.espacioId && ins(a.espacioId) ? `Puesto asignado: <strong>${esc(insLabel(ins(a.espacioId)))}</strong>. ` : ''}${devolver.length ? `Al salir, devolvé en recepción: <strong>${devolver.map((x) => esc(insLabel(ins(x.insumoId)))).join(', ')}</strong>.` : 'No tenés recursos prestados.'}</p>`
              : `<h1 class="member-now">Te esperamos <span class="neon-text">en PARALLAX</span></h1>
                 <p class="text-2">Para ingresar, mostrá tu número de cliente <strong class="mono">${esc(l.numeroCliente || '')}</strong> o tu credencial en recepción.${ultimos[0] ? ` Último ingreso: ${util.fmtDateTime(ultimos[0].ingreso)}.` : ''}</p>`}
            <div class="member-actions">
              <a class="btn btn-primary btn-sm" href="#solicitudes" data-tipo="Reserva de sala">${icon('calendar', 'i-sm')} Reservar sala</a>
              <a class="btn btn-sm" href="#solicitudes" data-tipo="Insumos">${icon('package', 'i-sm')} Pedir insumos</a>
              <a class="btn btn-sm" href="#consumos">${icon('receipt', 'i-sm')} Ver consumos</a>
            </div>
          </div>
        </section>

        <div class="grid grid-2">
          <section class="pcard">
            <header class="pcard-head"><div><h2 class="pcard-title">${icon('contract', 'i-sm')} Mi contrato</h2><p class="pcard-sub">Contrato de locación de servicios</p></div>${c ? PLX.ui.badge(billing.estadoContrato(c).nombre, billing.estadoContrato(c).tone, true) : ''}</header>
            <div class="pcard-body">
              ${c ? `
                <dl class="loc-meta">
                  <div><dt>Número</dt><dd class="mono">${esc(c.numero)}</dd></div>
                  <div><dt>Modalidad</dt><dd>${esc(planName(c.planId))} · ${c.puestos} ${c.puestos === 1 ? 'puesto' : 'puestos'}</dd></div>
                  <div><dt>Vigencia</dt><dd class="mono small">${util.fmtDate(c.fechaInicio)} → ${c.fechaFin ? util.fmtDate(c.fechaFin) : 'indeterminado'}</dd></div>
                  <div><dt>Abono mensual</dt><dd class="mono">${util.money(c.montoMensual)} <span class="muted small">+ IVA</span></dd></div>
                </dl>
                ${res.asignados.length ? `<p class="small muted" style="margin:14px 0 6px">Recursos asignados</p><div class="tags">${res.asignados.map((x) => `<span class="tag is-loan" title="${esc(x.nombre)}">${esc(x.codigo || x.nombre)}</span>`).join('')}</div>` : ''}
                ${(c.servicios || []).length ? `<p class="small muted" style="margin:14px 0 6px">Servicios incluidos</p><ul class="mini-checks">${c.servicios.map((s) => `<li>${icon('check', 'i-sm')} ${esc(s)}</li>`).join('')}</ul>` : ''}`
              : '<p class="small muted">No tenés un contrato vigente. Consultá a recepción.</p>'}
            </div>
          </section>
          <section class="pcard">
            <header class="pcard-head"><div><h2 class="pcard-title">${icon('pulse', 'i-sm')} Incluido en tu abono · ${util.periodLabel(p)}</h2><p class="pcard-sub">Lo que uses de más se suma como excedente en tu resumen</p></div></header>
            <div class="pcard-body">
              ${meters(res)}
              <div class="calc-line" style="margin-top:16px"><span>Estimado del mes (con IVA)</span><strong>${util.money(res.totales.total)}</strong></div>
              <p class="small muted" style="margin-top:8px">Puede variar hasta el cierre del período.</p>
            </div>
          </section>
        </div>

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head"><div><h2 class="pcard-title">${icon('clock', 'i-sm')} Mis últimos ingresos</h2></div></header>
          <div class="pcard-body flush">
            ${ultimos.length ? `<div class="list">${ultimos.map((x) => `
              <div class="list-item">
                <span class="avatar">${esc(util.initials(x.nombre))}</span>
                <div class="grow"><div class="title">${esc(util.fmtDateLong(util.localDateOfIso(x.ingreso)))}</div>
                <div class="meta">${util.fmtTime(x.ingreso)} → ${x.egreso ? util.fmtTime(x.egreso) : 'en el espacio'} · ${esc(x.nombre)}${x.espacioId && ins(x.espacioId) ? ` · ${esc(ins(x.espacioId).codigo || '')}` : ''}${(x.items || []).length ? ` · ${x.items.map((it) => esc(insLabel(ins(it.insumoId)))).join(', ')}` : ''}</div></div>
                ${!x.egreso ? PLX.ui.badge('En el espacio', 'cyan', true) : x.estado === 'observado' ? PLX.ui.badge('Con observaciones', 'magenta', true) : ''}
              </div>`).join('')}</div>` : ui.empty('Todavía no registrás ingresos.', 'badge')}
          </div>
        </section>`;
    },

    consumos() {
      const l = loc();
      const p = st.periodo;
      const res = billing.compute(D, l.id, p);
      const rows = billing.consumosDelPeriodo(D, l.id, p).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
      const emitido = D.resumenes.find((r) => r.periodo === p);
      return `
        <div class="page-head">
          <div><h1 class="page-title">Consumos</h1><p class="page-sub">Lo que usaste en el período y cuánto queda dentro de tu abono.</p></div>
        </div>
        <div class="toolbar">${ui.periodNav(p)}</div>
        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Abono', value: util.money0(res.totales.abonos), hint: 'Abono de Membresía del período', ic: 'contract' })}
          ${ui.kpi({ label: 'Excedentes y adicionales', value: util.money0(res.totales.consumos), hint: 'Lo que supera lo incluido', ic: 'package', tone: 'magenta' })}
          ${ui.kpi({ label: emitido ? 'Total del resumen' : 'Total estimado', value: util.money0(res.totales.total), hint: emitido ? `Resumen ${esc(emitido.numero)}` : p >= util.periodOf() ? 'Puede variar hasta el cierre' : 'Pendiente de emisión', ic: 'receipt' })}
        </div>
        <section class="pcard" style="margin-bottom:16px">
          <header class="pcard-head"><div><h2 class="pcard-title">${icon('pulse', 'i-sm')} Incluido en tu abono</h2></div></header>
          <div class="pcard-body">${meters(res)}</div>
        </section>
        <section class="pcard">
          ${ui.table({
            rows,
            empty: `Sin consumos en ${util.periodLabel(p)}.`,
            emptyIcon: 'package',
            cols: [
              { label: 'Fecha', cell: (c) => `<span class="mono small">${util.fmtDate(c.fecha)}</span>` },
              { label: 'Recurso', primary: true, cell: (c) => `<span class="strong">${esc(insLabel(ins(c.insumoId)))}</span><span class="sub">${esc(domain.catNombre((ins(c.insumoId) || {}).categoria))}${c.accesoId ? ' · pedido en recepción' : ''}</span>` },
              { label: 'Cantidad', cls: 'num', cell: (c) => `${util.num(c.cantidad)} <span class="muted">${esc((ins(c.insumoId) || {}).unidad || '')}</span>` },
              { label: 'Precio', cls: 'num', cell: (c) => util.money(c.precioUnitario) },
              { label: 'Importe', cls: 'num', cell: (c) => util.money(c.cantidad * c.precioUnitario) }
            ]
          })}
        </section>
        <p class="small muted" style="margin-top:12px">Los importes de la tabla son brutos: al facturar se descuenta primero lo incluido en tu abono.</p>`;
    },

    resumenes() {
      const rows = D.resumenes.slice().sort((a, b) => b.periodo.localeCompare(a.periodo));
      return `
        <div class="page-head"><div><h1 class="page-title">Resúmenes de gastos</h1><p class="page-sub">Resúmenes mensuales emitidos por PARALLAX: abono, consumos y excedentes.</p></div></div>
        <section class="pcard">
          ${ui.table({
            rows,
            empty: 'Todavía no hay resúmenes emitidos.',
            emptyIcon: 'receipt',
            cols: [
              { label: 'Número', primary: true, cell: (r) => `<span class="strong mono">${esc(r.numero)}</span>` },
              { label: 'Período', cell: (r) => util.periodLabel(r.periodo) },
              { label: 'Total', cls: 'num', cell: (r) => util.money(r.total) },
              { label: 'Emitido', cell: (r) => `<span class="small text-2">${util.fmtDate(util.localDateOfIso(r.emitidoEn))}</span>` },
              { label: '', cls: 'actions', cell: (r) => `<button type="button" class="btn btn-xs" data-action="ver-resumen" data-id="${r.id}">${icon('eye', 'i-sm')} Ver</button>` }
            ]
          })}
        </section>`;
    },

    documentos() {
      const docs = D.documentos.slice().sort((a, b) => b.subidoEn.localeCompare(a.subidoEn));
      return `
        <div class="page-head"><div><h1 class="page-title">Documentos</h1><p class="page-sub">Tu contrato firmado y la documentación que PARALLAX compartió con vos.</p></div></div>
        <section class="pcard"><div class="pcard-body">
          ${docs.length ? `<ul class="doc-list">${docs.map((d) => `
            <li>
              <span class="doc-ico">${icon('file-check', 'i-sm')}</span>
              <div class="grow"><strong>${esc(d.nombre)}</strong><span class="sub">${esc(d.categoria)} · ${util.fmtBytes(d.tamano)} · ${util.fmtDate(util.localDateOfIso(d.subidoEn))}</span></div>
              <button type="button" class="btn btn-xs" data-action="ver-doc" data-id="${d.id}">${icon('eye', 'i-sm')} Ver</button>
              <button type="button" class="btn btn-xs btn-ghost" data-action="bajar-doc" data-id="${d.id}" aria-label="Descargar">${icon('download', 'i-sm')}</button>
            </li>`).join('')}</ul>` : ui.empty('Todavía no hay documentos compartidos.', 'file-check')}
        </div></section>`;
    },

    solicitudes() {
      const prev = D.consultas.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
      const estado = { nueva: ['Enviada', 'outline'], respondida: ['Respondida', 'cyan'], archivada: ['Cerrada', 'outline'], convertida: ['Respondida', 'cyan'] };
      return `
        <div class="page-head"><div><h1 class="page-title">Solicitudes</h1><p class="page-sub">Reservas de sala, insumos, equipamiento, horas adicionales o consultas a Asesoría y Gestoría.</p></div></div>
        <div class="grid grid-3-2">
          <section class="pcard">
            <header class="pcard-head"><h2 class="pcard-title">${icon('inbox', 'i-sm')} Nueva solicitud</h2></header>
            <form class="pcard-body" id="form-solicitud" novalidate>
              ${ui.form([
                { name: 'tipo', label: 'Tipo', type: 'select', options: domain.TIPOS_SOLICITUD, value: st.tipoSolicitud || domain.TIPOS_SOLICITUD[0] },
                { name: 'fechaDeseada', label: 'Para el día (opcional)', type: 'date' },
                { name: 'mensaje', label: 'Detalle', type: 'textarea', span: 2, required: true, placeholder: 'Ej.: sala de reuniones de 15 a 17 h para 6 personas.' }
              ])}
              <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary btn-sm" data-action="enviar-solicitud">${icon('arrow-right', 'i-sm')} Enviar solicitud</button></div>
            </form>
          </section>
          <section class="pcard">
            <header class="pcard-head"><h2 class="pcard-title">${icon('archive', 'i-sm')} Mis solicitudes</h2></header>
            <div class="pcard-body flush">
              ${prev.length ? `<div class="list">${prev.map((c) => `
                <div class="list-item">
                  <div class="grow"><div class="title">${esc(c.tipo || c.interes || 'Solicitud')}${c.fechaDeseada ? ` · ${util.fmtDate(c.fechaDeseada)}` : ''}</div><div class="meta">${esc(c.mensaje)}</div></div>
                  ${PLX.ui.badge((estado[c.estado] || estado.nueva)[0], (estado[c.estado] || estado.nueva)[1], true)}
                </div>`).join('')}</div>` : ui.empty('Todavía no enviaste solicitudes.', 'inbox')}
            </div>
          </section>
        </div>`;
    },

    datos() {
      const l = loc();
      const edad = util.edad(l.nacimiento);
      const personas = D.personas;
      const dato = (k, v, mono) => `<div><dt>${k}</dt><dd class="${mono ? 'mono' : ''}">${v ? esc(v) : '<span class="muted">—</span>'}</dd></div>`;
      return `
        <div class="page-head"><div><h1 class="page-title">Mis datos</h1><p class="page-sub">Tu legajo en PARALLAX. Para corregir datos del legajo, envianos una solicitud.</p></div></div>
        <section class="pcard" style="margin-bottom:16px">
          <header class="pcard-head"><h2 class="pcard-title">${icon('user', 'i-sm')} Legajo ${esc(l.numeroCliente || '')}</h2></header>
          <div class="pcard-body"><dl class="loc-meta ficha-grid">
            ${dato('Nombre', l.nombre)}${dato('Apellido', l.apellido)}${dato('Documento', l.documento, true)}${dato('CUIT', l.cuit, true)}
            ${dato('Fecha de nacimiento', l.nacimiento ? util.fmtDate(l.nacimiento) : '', true)}${dato('Edad', edad == null ? '' : `${edad} años`)}
            ${dato('Razón social', l.razonSocial)}${dato('Condición IVA', l.condicionIva)}${dato('Fecha de contrato', l.fechaContrato ? util.fmtDate(l.fechaContrato) : '', true)}
          </dl></div>
        </section>
        <div class="grid grid-2">
          <section class="pcard">
            <header class="pcard-head"><h2 class="pcard-title">${icon('phone', 'i-sm')} Contacto</h2></header>
            <form class="pcard-body" id="form-contacto" novalidate>
              ${ui.form([
                { name: 'telefono', label: 'Teléfono', type: 'tel', value: l.telefono, maxlength: 40 },
                { name: 'email', label: 'Email', type: 'email', value: l.email, maxlength: 160 }
              ])}
              <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-sm btn-primary" data-action="guardar-contacto">${icon('check', 'i-sm')} Guardar</button></div>
            </form>
          </section>
          <section class="pcard">
            <header class="pcard-head"><h2 class="pcard-title">${icon('shield', 'i-sm')} Contraseña</h2></header>
            <form class="pcard-body" id="form-pass" novalidate>
              ${ui.form([
                { name: 'actual', label: 'Contraseña actual', type: 'password', required: true, attrs: 'autocomplete="current-password"' },
                { name: 'nueva', label: 'Nueva contraseña', type: 'password', required: true, attrs: 'autocomplete="new-password"', hint: 'Mínimo 8 caracteres.' },
                { name: 'repetir', label: 'Repetir nueva contraseña', type: 'password', required: true, span: 2, attrs: 'autocomplete="new-password"' }
              ])}
              <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-sm" data-action="cambiar-pass">${icon('check', 'i-sm')} Cambiar contraseña</button></div>
            </form>
          </section>
        </div>
        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head"><div><h2 class="pcard-title">${icon('badge', 'i-sm')} Personas autorizadas a ingresar</h2><p class="pcard-sub">Para sumar o quitar personas, envianos una solicitud.</p></div></header>
          <div class="pcard-body">${personas.length ? `<ul class="mini-list">${personas.map((p) => `<li><span>${esc(p.nombre)}${p.titular ? ' <span class="muted small">(titular)</span>' : ''}</span><span class="mono small">${esc(p.credencial)}${p.habilitada ? '' : ' · inhabilitada'}</span></li>`).join('')}</ul>` : '<p class="small muted">Sin personas autorizadas.</p>'}</div>
        </section>`;
    }
  };

  /* ---------- Documento de resumen (lectura) ---------- */
  function verResumen(id) {
    const r = D.resumenes.find((x) => x.id === id);
    const res = r.snapshot;
    const tabla = (lineas) => `<div class="table-wrap"><table class="tbl stack-sm"><thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Importe</th></tr></thead><tbody>${lineas.map((l) => `<tr><td class="primary"><span class="strong">${esc(l.concepto)}</span>${l.detalle ? `<span class="sub">${esc(l.detalle)}</span>` : ''}</td><td class="num" data-label="Cantidad">${util.num(l.cantidad)} ${esc(l.unidad)}</td><td class="num" data-label="Importe">${util.money(l.neto)}</td></tr>`).join('')}</tbody></table></div>`;
    ui.modal({
      title: `Resumen ${r.numero}`,
      sub: `${esc(res.periodoLabel)} · emitido el ${util.fmtDate(util.localDateOfIso(r.emitidoEn))}`,
      size: 'wide',
      cancelLabel: 'Cerrar',
      noAutofocus: true,
      body: `<article class="doc">
        ${res.lineas.filter((l) => l.tipo === 'abono').length ? `<section class="doc-section" style="margin-top:0"><h5>Abono de Membresía</h5>${tabla(res.lineas.filter((l) => l.tipo === 'abono'))}</section>` : ''}
        ${res.lineas.filter((l) => l.tipo === 'consumo').length ? `<section class="doc-section"><h5>Consumos y excedentes</h5>${tabla(res.lineas.filter((l) => l.tipo === 'consumo'))}</section>` : ''}
        <div class="doc-totals">
          <div><span>Subtotal neto</span><span>${util.money(res.totales.subtotal)}</span></div>
          <div><span>IVA ${util.num(res.totales.alicuota)}%</span><span>${util.money(res.totales.iva)}</span></div>
          <div class="grand"><span>Total</span><span>${util.money(res.totales.total)}</span></div>
        </div>
        <p class="doc-legal">Resumen de gastos del contrato de locación de servicios ${(res.contratos || []).map(esc).join(', ')}. No reemplaza la factura electrónica correspondiente.</p>
      </article>`
    });
  }

  async function abrirDoc(id, descargar) {
    const d = D.documentos.find((x) => x.id === id);
    try {
      const url = await backend.files.url(d);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      if (descargar) a.download = d.nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      ui.toast(e.message, 'warn');
    }
  }

  /* ---------- Router y eventos ---------- */
  let ruta = 'inicio';
  function render() {
    if (!D) return;
    const scroll = root.scrollY;
    view.innerHTML = views[ruta]();
    document.querySelectorAll('.portal-nav a').forEach((a) => {
      const on = a.dataset.route === ruta;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    root.scrollTo(0, scroll);
  }
  function navigate() {
    const r = (location.hash || '#inicio').replace(/^#\/?/, '');
    ruta = views[r] ? r : 'inicio';
    document.title = `PARALLAX · ${document.querySelector(`.portal-nav a[data-route="${ruta}"]`).textContent}`;
    render();
    root.scrollTo(0, 0);
  }
  function refresh() { D = datos(); render(); }

  const actions = {
    'period-prev': () => { st.periodo = util.shiftPeriod(st.periodo, -1); render(); },
    'period-next': () => { st.periodo = util.shiftPeriod(st.periodo, 1); render(); },
    'ver-resumen': (el) => verResumen(el.dataset.id),
    'ver-doc': (el) => abrirDoc(el.dataset.id, false),
    'bajar-doc': (el) => abrirDoc(el.dataset.id, true),
    async 'enviar-solicitud'() {
      const f = $('#form-solicitud');
      if (!ui.validate(f)) return;
      const d = ui.read(f);
      try {
        await backend.member.solicitud(d);
        st.tipoSolicitud = '';
        ui.toast('Solicitud enviada. Te vamos a responder a la brevedad.');
        refresh();
      } catch (e) { ui.toast(e.message, 'warn'); }
    },
    async 'guardar-contacto'() {
      const f = $('#form-contacto');
      if (!ui.validate(f)) return;
      try { await backend.member.perfil(ui.read(f)); ui.toast('Datos de contacto actualizados.'); refresh(); } catch (e) { ui.toast(e.message, 'warn'); }
    },
    async 'cambiar-pass'() {
      const f = $('#form-pass');
      if (!ui.validate(f)) return;
      const d = ui.read(f);
      if (d.nueva !== d.repetir) return ui.toast('Las contraseñas nuevas no coinciden.', 'warn');
      try { await backend.changePassword(d.actual, d.nueva); f.reset(); ui.toast('Contraseña actualizada.'); } catch (e) { ui.toast(e.message, 'warn'); }
    }
  };

  view.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tipo]');
    if (t) st.tipoSolicitud = t.dataset.tipo;
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) {
      e.preventDefault();
      actions[a.dataset.action](a, e);
    }
  });
  view.addEventListener('change', (e) => {
    if (e.target.matches('[data-change="period-set"]') && e.target.value) { st.periodo = e.target.value; render(); }
  });
  view.addEventListener('submit', (e) => e.preventDefault());
  $('#pm-logout').addEventListener('click', () => backend.logout());
  root.addEventListener('hashchange', navigate);
  store.on(() => { if (D && backend.mode === 'demo') refresh(); });

  /* ---------- Arranque ---------- */
  (async function boot() {
    await backend.detect();
    if (backend.user && backend.user.rol === 'admin') {
      view.innerHTML = `<div class="empty" style="padding:80px 20px">${icon('shield')}<span>Iniciaste sesión como administración. El Área de Miembros es para los clientes.</span><a class="btn btn-primary btn-sm" href="gestoria.html">Ir al Panel de Gestoría</a></div>`;
      $('#pm-user span').textContent = backend.user.nombre || backend.user.usuario;
      return;
    }
    try {
      const user = await backend.boot({ rol: 'miembro', seed: PLX.seed });
      if (!user) return;
      $('#pm-demo').hidden = backend.mode !== 'demo';
      $('#pm-user span').textContent = user.nombre || user.usuario;
      D = datos();
      if (!loc()) {
        view.innerHTML = `<div class="empty" style="padding:80px 20px">${icon('alert')}<span>Tu usuario no está vinculado a un legajo. Contactá a recepción.</span></div>`;
        return;
      }
      navigate();
      if (backend.mode === 'servidor') {
        setInterval(async () => {
          if (document.hidden || $('#modal').open) return;
          const cambio = await backend.poll();
          if (cambio) refresh();
        }, 30000);
      }
    } catch (e) {
      view.innerHTML = `<div class="empty" style="padding:80px 20px">No se pudo cargar tu información: ${esc(e.message)}</div>`;
    }
  })();
})(window);
