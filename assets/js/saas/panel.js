/* ==========================================================================
   PARALLAX Suite · Capa SaaS del Panel de Gestoría
   ---------------------------------------------------------------------------
   Se carga después de las vistas y antes de panel/app.js. Sobre el panel
   completo de PARALLAX agrega lo propio de una suscripción:

   · Datos iniciales por tenant (el coworking de PARALLAX, un coworking
     chico, o una base vacía con inventario de ejemplo).
   · Estado de la suscripción (Activa / Trial / Impaga), avisos y bloqueo.
   · Límites del Plan Base y funciones del Plan Ejecutivo.
   · Marca blanca (logo y nombre propios) y Asesoría técnica.
   · Vistas nuevas: «Cierre Mensual» y «Suscripción».
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const S = root.PLX_SAAS;
  const doc = document;
  const $ = (s) => doc.querySelector(s);

  PLX.saas = true;
  if (!S || !S.tenant()) {
    root.location.replace('suite.html#acceso');
    return;
  }

  const { util, store, ui, backend, h, billing, icon } = PLX;
  const esc = util.esc;
  const tid = () => S.tenant().id;
  const E = () => S.efectivo(S.tenant());
  const esBase = () => E().plan === 'base';
  const MAX_BASE = S.PLANES.base.maxAbonos;
  PLX.slug = () => S.slug(PLX.marca());

  /* ======================================================================
     1 · Datos iniciales por tenant
     ====================================================================== */
  const TABLAS_LOC = ['contratos', 'personas', 'accesos', 'consumos', 'resumenes', 'documentos', 'reservas', 'pagos', 'facturas'];

  function renombrar(db, nombre) {
    // Los textos de ejemplo mencionan a PARALLAX: se reemplazan por el nombre del tenant
    return JSON.parse(JSON.stringify(db).replace(/PARALLAX/g, nombre.replace(/["\\]/g, '')));
  }

  function seedTenant() {
    const t = S.tenant();
    const original = PLX.seedOriginal;
    if (t.id === 't_parallax') {
      const db = original();
      return db;
    }
    if (t.lite) {
      // Coworking chico: solo dos clientes de ejemplo (sin las tres unidades corporativas de PARALLAX)
      const db = original();
      const keep = new Set(['loc_kora', 'loc_leiva']);
      db.locatarios = db.locatarios.filter((l) => keep.has(l.id)).map((l) => Object.assign(l, { principal: false }));
      TABLAS_LOC.forEach((c) => { db[c] = (db[c] || []).filter((x) => keep.has(x.locatarioId)); });
      db.consultas = [];
      db.contratos.forEach((c) => { delete c.firma; });
      db.config.secuenciaCliente = 5;
      db.config.prestador = Object.assign({}, db.config.prestador, { nombre: t.nombre, razonSocial: '', email: t.email });
      return renombrar(db, t.nombre);
    }
    // Cuenta nueva: base vacía con las modalidades y un inventario de ejemplo para empezar
    const base = PLX.seedBase();
    base.insumos = PLX.seedInventario();
    base.config = { prestador: { nombre: t.nombre, razonSocial: '', cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '', email: t.email } };
    base.meta = { seeded: true, demo: false };
    return base;
  }
  PLX.seedOriginal = PLX.seed;
  PLX.seed = seedTenant;

  /* ======================================================================
     2 · Funciones según plan
     ====================================================================== */
  function upsell(titulo, texto) {
    ui.modal({
      title: titulo,
      size: 'narrow',
      body: `<div class="saas-upsell">
        <div class="saas-upsell-ic">${icon('spark')}</div>
        <p class="text-2">${texto}</p>
        <ul class="saas-mini-list">
          <li>${icon('check', 'i-sm')} Locatarios ilimitados e historial completo</li>
          <li>${icon('check', 'i-sm')} Facturación AFIP y exportación a Excel/CSV</li>
          <li>${icon('check', 'i-sm')} Panel «White Label» con tu propio logo</li>
        </ul>
        <p class="tiny muted">Plan Ejecutivo: USD 15 / ARS 20.000 por mes.</p>
      </div>`,
      cancelLabel: 'Ahora no',
      submitLabel: 'Ver Plan Ejecutivo',
      onSubmit: () => { root.location.hash = '#suscripcion'; }
    });
  }
  PLX.saasUpsell = upsell;

  // Exportación contable: solo Plan Ejecutivo (el respaldo completo de datos siempre está disponible)
  const downloadOrig = util.download;
  util.download = function (nombre, contenido, mime) {
    const contable = /\.csv$/i.test(nombre) || /^resumen.*\.json$/i.test(nombre);
    if (contable && esBase()) {
      upsell('Exportación contable', 'La exportación a Excel/CSV y el archivo de resumen contable forman parte del <strong>Plan Ejecutivo</strong>. En el Plan Base los resúmenes se ven en pantalla y se imprimen con marca de agua.');
      return;
    }
    return downloadOrig.call(util, nombre, contenido, mime);
  };

  // Facturación AFIP / ARCA: solo Plan Ejecutivo
  const facturarOrig = backend.arca.facturar;
  backend.arca.facturar = function (resumenId) {
    if (esBase()) return Promise.reject(new Error('La facturación AFIP está disponible en el Plan Ejecutivo.'));
    return facturarOrig.call(backend.arca, resumenId);
  };
  const vf = PLX.views.facturacion;
  if (vf && vf.actions && vf.actions.facturar) {
    const f0 = vf.actions.facturar;
    vf.actions.facturar = function (el, e, ctx) {
      if (esBase()) return upsell('Facturación AFIP integrada', 'Emitir facturas electrónicas desde el panel está incluido en el <strong>Plan Ejecutivo</strong>.');
      return f0.call(this, el, e, ctx);
    };
  }

  // Abonos de membresía: el Plan Base admite hasta 5 vigentes
  function abonosVigentes() {
    return store.all('contratos').filter((c) => { const e = billing.estadoContrato(c).id; return e === 'vigente' || e === 'por-vencer'; }).length;
  }
  const contratoOrig = PLX.forms.contrato;
  PLX.forms.contrato = function (id, preset) {
    if (!id && esBase() && abonosVigentes() >= MAX_BASE) {
      return upsell('Llegaste al límite del Plan Base', `El Plan Base admite hasta <strong>${MAX_BASE} abonos de membresía</strong> vigentes y ya tenés ${abonosVigentes()}. Pasá al Plan Ejecutivo para cargar locatarios ilimitados.`);
    }
    return contratoOrig.call(this, id, preset);
  };

  // Historial: el Plan Base muestra el mes en curso y los dos anteriores
  const navOrig = ui.periodNav;
  ui.periodNav = function (periodo, action = 'period') {
    if (!esBase()) return navOrig.call(ui, periodo, action);
    const min = util.shiftPeriod(util.periodOf(), -2);
    let html = navOrig.call(ui, periodo, action);
    html = html.replace(/<option value="(\d{4}-\d{2})"[^>]*>[^<]*<\/option>/g, (m, v) => (v < min ? '' : m));
    if (periodo <= min) html = html.replace(`data-action="${action}-prev"`, `data-action="${action}-prev" disabled`);
    return html;
  };

  // Marca blanca: el logo propio solo se usa en el Plan Ejecutivo
  PLX.logo = () => {
    const p = store.config().prestador || {};
    return E().plan === 'ejecutivo' && p.logo ? p.logo : 'assets/img/favicon.svg';
  };

  /* ======================================================================
     3 · Banner de suscripción, bloqueo y marca
     ====================================================================== */
  function fechaCorta(iso) { return util.fmtDate(util.localDateOfIso(iso)); }

  function tonoEstado(est) {
    return est === 'activa' ? 'cyan' : est === 'trial' ? 'grad' : 'magenta';
  }
  const NOMBRE_ESTADO = { activa: 'Activa', trial: 'Trial', impaga: 'Impaga' };

  function selectorDemo(t, ef) {
    if (!t.demo) return '';
    const b = (id, label) => `<button type="button" class="seg-btn${ef.estado === id ? ' is-on' : ''}" data-saas="simular" data-estado="${id}">${label}</button>`;
    return `<span class="sub-sim" title="Solo en la demostración: cambia el estado de esta cuenta para ver cada caso"><span class="sub-sim-l">Simular</span>${b('activa', 'Activa')}${b('trial', 'Trial')}${b('impaga', 'Impaga')}</span>`;
  }

  function renderBanner() {
    const t = S.tenant();
    const ef = E();
    const box = $('#sub-banner');
    let tono = 'is-ok', ic = 'shield', msg = '', cta = '';
    if (ef.estado === 'trial') {
      tono = 'is-trial'; ic = 'clock';
      msg = `<strong>Prueba gratuita · Plan Ejecutivo.</strong> Te ${ef.diasTrial === 1 ? 'queda 1 día' : `quedan ${ef.diasTrial} días`}. Si no abonás los USD 15 al terminar la prueba, se suspenderá la Gestoría del panel.`;
      cta = `<button type="button" class="btn btn-xs btn-primary" data-saas="pagar">Activar por USD 15/mes</button>`;
    } else if (ef.estado === 'impaga') {
      tono = 'is-bad'; ic = 'alert';
      msg = `<strong>Suscripción impaga.</strong> ${esc(ef.motivo)} La Gestoría del panel está suspendida hasta regularizar los USD 15.`;
      cta = `<button type="button" class="btn btn-xs btn-primary" data-saas="pagar">Regularizar ahora</button>`;
    } else if (ef.avisoCobro) {
      tono = 'is-warn'; ic = 'clock';
      msg = `<strong>Suscripción activa.</strong> ${ef.diasCobro < 0 ? 'Tu cobro está vencido' : ef.diasCobro === 0 ? 'Hoy vence tu cobro' : `Tu próximo cobro vence en ${ef.diasCobro} ${ef.diasCobro === 1 ? 'día' : 'días'}`} (${fechaCorta(t.proximoCobro)}). Si no abonás los USD 15, se suspenderá la Gestoría del panel.`;
      cta = `<button type="button" class="btn btn-xs btn-primary" data-saas="pagar">Pagar ahora</button>`;
    } else if (ef.plan === 'base') {
      ic = 'layers';
      const n = abonosVigentes();
      msg = `<strong>Plan Base · sin costo.</strong> Abonos de membresía: ${n} de ${MAX_BASE}. Facturación AFIP y exportación contable se activan con el Plan Ejecutivo.`;
      cta = `<a class="btn btn-xs btn-outline-cyan" href="#suscripcion">Ver Plan Ejecutivo</a>`;
    } else {
      msg = `<strong>Suscripción activa · Plan Ejecutivo.</strong> Próximo cobro el ${fechaCorta(t.proximoCobro)} (USD 15 / ARS 20.000).`;
      cta = `<a class="btn btn-xs btn-ghost" href="#suscripcion">Ver suscripción</a>`;
    }
    box.className = `sub-banner ${tono}`;
    box.innerHTML = `<span class="sub-ic">${icon(ic, 'i-sm')}</span><div class="sub-msg">${msg}</div><div class="sub-act">${selectorDemo(t, ef)}${cta}</div>`;
  }

  function renderLock() {
    const ef = E();
    const app = $('.app');
    let lock = $('#sub-lock');
    if (!ef.bloqueada) {
      if (lock) lock.remove();
      if (app) app.inert = false;
      doc.body.classList.remove('is-locked');
      return;
    }
    doc.body.classList.add('is-locked');
    if (app) app.inert = true;
    if (!lock) {
      lock = doc.createElement('div');
      lock.id = 'sub-lock';
      lock.className = 'sub-lock';
      lock.setAttribute('role', 'alertdialog');
      lock.setAttribute('aria-modal', 'true');
      lock.setAttribute('aria-labelledby', 'lock-title');
      doc.body.appendChild(lock);
    }
    const t = S.tenant();
    lock.innerHTML = `
      <div class="sub-lock-card">
        <div class="sub-lock-ic">${icon('shield')}</div>
        <p class="eyebrow">Suscripción ${esc(NOMBRE_ESTADO[ef.estado])}</p>
        <h2 id="lock-title" class="display">Gestoría suspendida</h2>
        <p class="text-2">${esc(ef.motivo || 'No se registró el pago de tu suscripción.')} Mientras tanto, el panel de <strong>${esc(t.nombre)}</strong> permanece bloqueado: tus datos están a salvo y vuelven a estar disponibles apenas se regularicen los <strong>USD 15</strong> del Plan Ejecutivo.</p>
        <div class="sub-lock-actions">
          <button type="button" class="btn btn-primary btn-lg" data-saas="pagar">${icon('receipt')} Regularizar suscripción · USD 15</button>
          <button type="button" class="btn" data-saas="base">Continuar con el Plan Base · $0</button>
          <button type="button" class="btn btn-ghost" data-saas="salir">${icon('logout', 'i-sm')} Cerrar sesión</button>
        </div>
        <p class="tiny muted">Con el Plan Base conservás hasta 5 abonos de membresía y la Gestoría básica en pantalla.</p>
      </div>`;
    const first = lock.querySelector('button');
    if (first && !doc.querySelector('dialog[open]')) first.focus();
  }

  function renderMarca() {
    const t = S.tenant();
    const ef = E();
    const nombre = PLX.marca();
    $('#brand-name').textContent = nombre;
    const logo = $('#brand-logo');
    logo.src = PLX.logo();
    logo.style.objectFit = 'contain';
    $('#tenant-name').textContent = t.nombre;
    const pl = $('#tenant-plan');
    pl.textContent = ef.estado === 'trial' ? 'Trial' : ef.plan === 'base' ? 'Base' : 'Ejecutivo';
    pl.className = `badge ${ef.plan === 'base' ? 'badge-outline' : 'badge-cyan'}`;
    const st = $('#tenant-state');
    st.title = `Suscripción ${NOMBRE_ESTADO[ef.estado].toLowerCase()}`;
    st.className = `state-dot is-${tonoEstado(ef.estado)}`;
    $('#side-powered').hidden = ef.plan === 'ejecutivo';
    doc.body.classList.toggle('plan-base', ef.plan === 'base');
    doc.body.classList.toggle('is-whitelabel', ef.plan === 'ejecutivo' && !!(store.config().prestador || {}).logo);
    doc.title = `${PLX.marca()} · Gestoría`;
  }

  function refrescar() {
    renderMarca();
    renderBanner();
    renderLock();
    if (PLX.app) PLX.app.render();
  }

  /* Acciones del banner, del bloqueo y de la vista de suscripción */
  function modalPago() {
    const t = S.tenant();
    ui.modal({
      title: 'Suscripción al Plan Ejecutivo',
      sub: 'USD 15 / ARS 20.000 por mes',
      size: 'narrow',
      body: `
        <div class="note is-magenta" style="margin-bottom:14px">${icon('info', 'i-sm')}<div><strong>Simulación.</strong> En esta demostración no se realiza ningún cobro ni se piden datos de tarjeta. En producción el pago lo procesa una pasarela (Mercado Pago o tarjeta).</div></div>
        ${ui.form([
          { name: 'medio', label: 'Medio de pago', type: 'select', options: ['Tarjeta (simulado)', 'Mercado Pago (simulado)', 'Transferencia bancaria (simulado)'] },
          { type: 'html', span: 2, html: `<p class="small text-2">Se activará el Plan Ejecutivo para <strong>${esc(t.nombre)}</strong> y el próximo cobro quedará a 30 días.</p>` }
        ])}`,
      submitLabel: 'Confirmar pago simulado',
      onSubmit: (v) => {
        S.pagar(t.id, v.medio);
        refrescar();
        ui.toast('Suscripción activa. ¡Gracias! Gestoría habilitada.');
      }
    });
  }

  async function pasarBase() {
    const n = abonosVigentes();
    const ok = await ui.confirm({
      title: 'Continuar con el Plan Base',
      message: `Pasás al Plan Base (sin costo). Se pierden la facturación AFIP, la exportación contable, el historial completo y la marca propia.${n > MAX_BASE ? `<br><br>Tenés ${n} abonos vigentes: se conservan, pero no podrás cargar nuevos hasta quedar por debajo de ${MAX_BASE}.` : ''}`,
      confirmLabel: 'Pasar al Plan Base'
    });
    if (!ok) return;
    S.pasarABase(tid());
    refrescar();
    ui.toast('Ahora estás en el Plan Base.');
  }

  function simular(estado) {
    const t = S.tenant();
    const DAY = 86400000;
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const en = (n) => new Date(d0.getTime() + n * DAY).toISOString();
    if (estado === 'activa') S.actualizar(t.id, { plan: t.plan === 'base' ? 'base' : 'ejecutivo', estado: 'activa', trialHasta: null, proximoCobro: t.plan === 'base' ? null : en(5) });
    if (estado === 'trial') S.actualizar(t.id, { plan: 'ejecutivo', estado: 'trial', trialHasta: en(3), proximoCobro: null });
    if (estado === 'impaga') S.actualizar(t.id, { plan: 'ejecutivo', estado: 'impaga', trialHasta: null, proximoCobro: en(-9) });
    refrescar();
  }

  doc.addEventListener('click', (e) => {
    const a = e.target.closest('[data-saas]');
    if (!a) return;
    const act = a.dataset.saas;
    if (act === 'pagar') modalPago();
    else if (act === 'base') pasarBase();
    else if (act === 'salir') S.salir();
    else if (act === 'simular') simular(a.dataset.estado);
  });

  /* ======================================================================
     4 · Vista: Cierre Mensual
     ====================================================================== */
  const PV = (n) => String(n || 1).padStart(4, '0');
  const NRO = (n) => String(n || 0).padStart(8, '0');

  function facturaDe(resumenId) {
    return store.all('facturas').filter((f) => f.resumenId === resumenId).sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn))).pop() || null;
  }

  function filasCierre(p) {
    return billing.computeAll(store.db, p).map((res) => {
      const em = billing.emitido(store.db, res.locatario.id, p);
      return { res, em, f: em ? facturaDe(em.id) : null, l: h.loc(res.locatario.id) };
    }).sort((a, b) => b.res.totales.total - a.res.totales.total);
  }

  const paso = (hecho, titulo, detalle, bloqueado) =>
    `<span class="step ${hecho ? 'is-done' : bloqueado ? 'is-locked' : ''}"><i>${hecho ? icon('check', 'i-sm') : bloqueado ? icon('shield', 'i-sm') : ''}</i><span><strong>${esc(titulo)}</strong>${detalle ? `<small>${detalle}</small>` : ''}</span></span>`;

  async function cerrarUno(locId, p) {
    const base = esBase();
    let em = billing.emitido(store.db, locId, p);
    if (!em) em = await PLX.facturacion.emitir(locId, p, { silent: true });
    if (!em) return { emitido: false };
    let f = facturaDe(em.id);
    if (!base && !f) {
      try { f = await backend.arca.facturar(em.id); } catch (err) { return { emitido: true, error: err.message }; }
    }
    return { emitido: true, facturado: !!f };
  }

  function csvDe(row) {
    const { res, em } = row;
    return billing.toCsv([em ? { res: em.snapshot, numero: em.numero, fecha: em.emitidoEn } : { res, numero: '', fecha: '' }]);
  }

  PLX.views.cierre = {
    title: 'Cierre Mensual',

    render(ctx) {
      const st = ctx.state;
      st.periodo = st.periodo || util.periodOf();
      const p = st.periodo;
      const base = esBase();
      const rows = filasCierre(p);
      const emitidos = rows.filter((r) => r.em).length;
      const facturados = rows.filter((r) => r.f).length;
      const total = util.sum(rows, (r) => r.res.totales.total);
      const hecho = rows.length ? Math.round(((emitidos + (base ? emitidos : facturados)) / (rows.length * 2)) * 100) : 0;
      const cur = util.periodOf();
      const pend = rows.filter((r) => !r.em || (!base && !r.f)).length;

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Cierre Mensual</h1>
            <p class="page-sub">Tres pasos por locatario: emitir el resumen de gastos, facturar en ARCA/AFIP y descargar el archivo contable.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-sm" data-action="descargar-todo" ${rows.length ? '' : 'disabled'}>${icon('download', 'i-sm')} CSV de todos${base ? ' · Ejecutivo' : ''}</button>
            <button class="btn btn-primary btn-sm" data-action="cerrar-mes" ${pend ? '' : 'disabled'}>${icon('file-check', 'i-sm')} Cerrar el mes (${pend})</button>
          </div>
        </div>

        <div class="toolbar">${ui.periodNav(p)}</div>

        ${p >= cur ? `<div class="note is-magenta" style="margin-bottom:16px">${icon('clock', 'i-sm')}<div><strong>${util.periodLabel(p)} está en curso.</strong> Podés cerrar ahora y volver a emitir al terminar el mes: el número del resumen se conserva y la versión se actualiza.</div></div>` : ''}

        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Locatarios del período', value: rows.length, hint: `Total con IVA ${util.money0(total)}`, ic: 'users' })}
          ${ui.kpi({ label: 'Resúmenes emitidos', value: `${emitidos} / ${rows.length}`, hint: emitidos === rows.length && rows.length ? 'Todos emitidos' : `${rows.length - emitidos} por emitir`, ic: 'file-check' })}
          ${ui.kpi({ label: 'Facturas ARCA', value: base ? '—' : `${facturados} / ${rows.length}`, hint: base ? 'Disponible en el Plan Ejecutivo' : `${rows.length - facturados} por facturar`, ic: 'receipt', tone: 'magenta' })}
          ${ui.kpi({ label: 'Avance del cierre', value: `${hecho}%`, hint: pend ? `${pend} locatarios con pasos pendientes` : 'Cierre completo', ic: 'chart', tone: pend ? '' : 'magenta' })}
        </div>

        <section class="pcard">
          <header class="pcard-head">
            <div>
              <h2 class="pcard-title">${icon('receipt', 'i-sm')} Cierre por locatario · ${util.periodLabel(p)}</h2>
              <p class="pcard-sub">Cada fila muestra en qué paso está el locatario. «Cerrar» hace los pasos que falten.</p>
            </div>
          </header>
          <div class="pcard-body flush">
            ${ui.table({
              rows,
              empty: `Sin abonos ni consumos en ${util.periodLabel(p)}.`,
              emptyIcon: 'receipt',
              cols: [
                { label: 'Locatario', primary: true, cell: ({ res, l }) => `<span class="strong">${esc(res.locatario.nombreComercial)}</span><span class="sub mono">${esc(res.locatario.numeroCliente || '')}</span>${l && (!l.cuit || !l.razonSocial) ? '<span class="sub" style="color:#f0a0fa">Faltan CUIT o razón social</span>' : ''}` },
                { label: 'Total con IVA', cls: 'num', cell: ({ res }) => `<span class="strong">${util.money(res.totales.total)}</span>` },
                { label: '1 · Resumen', cell: ({ em }) => paso(!!em, em ? 'Emitido' : 'Pendiente', em ? `<span class="mono">${esc(em.numero)}</span>` : '') },
                {
                  label: '2 · Factura ARCA', cell: ({ em, f }) => base
                    ? paso(false, 'Plan Ejecutivo', '', true)
                    : f ? paso(true, f.estado === 'autorizada' ? `Factura ${f.letra}` : `Simulada · ${f.letra}`, f.estado === 'autorizada' ? `CAE ${esc(f.cae)}` : 'Sin CAE · demostración')
                      : paso(false, em ? 'Por facturar' : 'Requiere resumen', '')
                },
                { label: '3 · Archivo contable', cell: ({ em }) => paso(!!em, base ? 'Plan Ejecutivo' : 'CSV listo', em && !base ? 'Un archivo por locatario' : '', base) },
                {
                  label: '', cls: 'actions', cell: ({ res, em, f }) =>
                    ui.iconBtn('ver', 'eye', 'Ver resumen', `data-loc="${res.locatario.id}"`) +
                    ui.iconBtn('csv', 'download', 'Descargar resumen contable (CSV)', `data-loc="${res.locatario.id}"`) +
                    (f ? ui.iconBtn('ver-factura', 'receipt', 'Ver factura', `data-id="${f.id}"`) : '') +
                    `<button type="button" class="btn btn-xs ${em && (f || base) ? '' : 'btn-outline-cyan'}" data-action="cerrar" data-loc="${res.locatario.id}">${em && (f || base) ? 'Re-cerrar' : 'Cerrar'}</button>`
                }
              ]
            })}
          </div>
        </section>

        <div class="note" style="margin-top:16px">${icon('receipt', 'i-sm')}<div><strong>Facturación electrónica.</strong> Con el servidor conectado y el certificado de ARCA/AFIP de tu cuenta, «Cerrar» solicita el CAE de cada factura. En esta demostración el comprobante se arma y queda marcado como <em>Simulación</em>, sin validez fiscal. El archivo contable usa separador «;» y coma decimal, con una línea por concepto y su cuenta.</div></div>`;
    },

    changes: {
      'period-set'(el, e, ctx) { if (el.value) { ctx.state.periodo = el.value; ctx.render(); } }
    },

    actions: {
      'period-prev'(el, e, ctx) { ctx.state.periodo = util.shiftPeriod(ctx.state.periodo, -1); ctx.render(); },
      'period-next'(el, e, ctx) { ctx.state.periodo = util.shiftPeriod(ctx.state.periodo, 1); ctx.render(); },
      ver(el, e, ctx) { PLX.facturacion.verResumen({ locId: el.dataset.loc, periodo: ctx.state.periodo }); },
      'ver-factura'(el) { PLX.facturacion.verFactura(el.dataset.id); },
      csv(el, e, ctx) {
        const p = ctx.state.periodo;
        const row = filasCierre(p).find((r) => r.res.locatario.id === el.dataset.loc);
        if (!row) return;
        util.download(`${PLX.slug()}-resumen-${util.slug(row.res.locatario.nombreComercial)}-${p}.csv`, csvDe(row), 'text/csv;charset=utf-8');
        ui.toast(`Archivo de ${row.res.locatario.nombreComercial} descargado.`);
      },
      async cerrar(el, e, ctx) {
        el.disabled = true;
        const r = await cerrarUno(el.dataset.loc, ctx.state.periodo);
        if (r.error) ui.toast(r.error, 'warn');
        else if (r.emitido) ui.toast(esBase() ? 'Resumen emitido.' : 'Resumen emitido y factura generada.');
        ctx.render();
      },
      async 'cerrar-mes'(el, e, ctx) {
        const p = ctx.state.periodo;
        const rows = filasCierre(p);
        const base = esBase();
        const sinResumen = rows.filter((r) => !r.em).length;
        const sinFactura = base ? 0 : rows.filter((r) => !r.f).length;
        const ok = await ui.confirm({
          title: `Cerrar ${util.periodLabel(p)}`,
          message: `Se van a ${base ? 'emitir' : 'emitir y facturar'} los pasos pendientes de <strong>${rows.length}</strong> locatarios:<br>• ${sinResumen} resúmenes por emitir${base ? '' : `<br>• ${sinFactura} facturas ARCA por generar`}${base ? '<br><br>La facturación AFIP y los archivos contables requieren el Plan Ejecutivo.' : ''}${p >= util.periodOf() ? '<br><br>El período todavía está en curso.' : ''}`,
          confirmLabel: 'Cerrar el mes'
        });
        if (!ok) return;
        let n = 0, fa = 0, err = '';
        for (const r of rows) {
          const x = await cerrarUno(r.res.locatario.id, p);
          if (x.emitido) n++;
          if (x.facturado) fa++;
          if (x.error) err = x.error;
        }
        ui.toast(`Cierre de ${util.periodLabel(p)}: ${n} resúmenes${base ? '' : ` y ${fa} facturas`}.`, err ? 'warn' : 'ok');
        ctx.render();
      },
      'descargar-todo'(el, e, ctx) {
        const p = ctx.state.periodo;
        const list = filasCierre(p).map(({ res, em }) => (em ? { res: em.snapshot, numero: em.numero, fecha: em.emitidoEn } : { res, numero: '', fecha: '' }));
        util.download(`${PLX.slug()}-cierre-${p}.csv`, billing.toCsv(list), 'text/csv;charset=utf-8');
        if (!esBase()) ui.toast('Archivo contable del cierre descargado.');
      }
    }
  };

  /* ======================================================================
     5 · Vista: Suscripción y marca
     ====================================================================== */
  const TK = () => `${root.PLX_NS}.asesoria.v1`;
  const tickets = () => { try { return JSON.parse(root.localStorage.getItem(TK())) || []; } catch (e) { return []; } };
  const guardarTickets = (l) => { try { root.localStorage.setItem(TK(), JSON.stringify(l)); } catch (e) { /* nada */ } };

  const CMP = [
    ['Abonos de membresía', 'Hasta 5', 'Ilimitados'],
    ['Gestoría en pantalla (contratos, consumos, accesos)', true, true],
    ['Resumen de gastos', 'Con marca de agua', 'Sin marca de agua'],
    ['Historial', '3 meses', 'Completo'],
    ['Facturación AFIP / ARCA', false, true],
    ['Exportación a Excel / CSV', false, true],
    ['Panel «White Label» (tu logo)', false, true],
    ['Soporte y Asesoría técnica', false, true]
  ];
  const celda = (v) => (v === true ? `<span class="yes">${icon('check', 'i-sm')}</span>` : v === false ? '<span class="no">—</span>' : esc(v));

  function redimensionar(file, max = 256) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Elegí una imagen (PNG, JPG, SVG o WebP).'));
      if (file.size > 3 * 1024 * 1024) return reject(new Error('La imagen supera los 3 MB.'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('La imagen no es válida.'));
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = doc.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/png'));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  PLX.views.suscripcion = {
    title: 'Suscripción y marca',

    render() {
      const t = S.tenant();
      const ef = E();
      const p = store.config().prestador || {};
      const n = abonosVigentes();
      const base = ef.plan === 'base';
      const pct = base ? Math.min(100, Math.round((n / MAX_BASE) * 100)) : 0;
      const pagos = (t.pagos || []).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
      const tks = tickets().slice().reverse();

      const estadoTexto = ef.estado === 'trial'
        ? `Prueba gratuita · ${ef.diasTrial} ${ef.diasTrial === 1 ? 'día restante' : 'días restantes'}`
        : ef.estado === 'impaga' ? 'Suspendida por falta de pago'
          : ef.plan === 'base' ? 'Sin costo' : `Próximo cobro el ${fechaCorta(t.proximoCobro)}`;

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Suscripción y marca</h1>
            <p class="page-sub">Tu plan, el estado de la cuenta, la marca de tu coworking y el soporte técnico.</p>
          </div>
          <div class="page-actions">
            ${ef.plan === 'ejecutivo' && ef.estado === 'activa' ? '' : `<button class="btn btn-primary btn-sm" data-saas="pagar">${icon('receipt', 'i-sm')} ${ef.plan === 'base' ? 'Pasar al Plan Ejecutivo' : 'Activar Plan Ejecutivo'}</button>`}
            ${ef.plan === 'ejecutivo' ? `<button class="btn btn-sm" data-saas="base">Pasar al Plan Base</button>` : ''}
          </div>
        </div>

        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Estado', value: NOMBRE_ESTADO[ef.estado], hint: estadoTexto, ic: 'shield', tone: ef.estado === 'impaga' ? 'magenta' : '' })}
          ${ui.kpi({ label: 'Plan', value: ef.plan === 'base' ? 'Base' : 'Ejecutivo', hint: ef.estado === 'trial' ? 'Prueba con todas las funciones' : ef.plan === 'base' ? '$0 por mes' : 'USD 15 · ARS 20.000 por mes', ic: 'layers' })}
          ${ui.kpi({ label: 'Abonos vigentes', value: base ? `${n} / ${MAX_BASE}` : n, hint: base ? 'Límite del Plan Base' : 'Sin límite en el Plan Ejecutivo', ic: 'contract', tone: base && n >= MAX_BASE ? 'magenta' : '' })}
          ${ui.kpi({ label: 'Cuenta', value: `<span class="kpi-small">${esc(t.nombre)}</span>`, hint: esc(t.email), ic: 'office' })}
        </div>
        ${base ? `<div class="meter" role="img" aria-label="${n} de ${MAX_BASE} abonos usados"><i style="width:${pct}%"></i></div>` : ''}

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head"><div><h2 class="pcard-title">${icon('layers', 'i-sm')} Comparativa de planes</h2><p class="pcard-sub">Tu plan actual está resaltado.</p></div></header>
          <div class="pcard-body flush">
            <div class="table-wrap"><table class="tbl cmp">
              <thead><tr><th>Función</th><th class="${base ? 'is-cur' : ''}">Plan Base · $0</th><th class="${!base ? 'is-cur' : ''}">Plan Ejecutivo · USD 15 / ARS 20.000</th></tr></thead>
              <tbody>${CMP.map((r) => `<tr><td class="primary">${esc(r[0])}</td><td class="${base ? 'is-cur' : ''}">${celda(r[1])}</td><td class="${!base ? 'is-cur' : ''}">${celda(r[2])}</td></tr>`).join('')}</tbody>
            </table></div>
          </div>
        </section>

        <div class="grid grid-3-2" style="margin-top:16px">
          <section class="pcard">
            <header class="pcard-head"><div><h2 class="pcard-title">${icon('badge', 'i-sm')} Marca de tu coworking · White Label</h2><p class="pcard-sub">Tu nombre y tu logo en el panel, en los resúmenes y en los contratos.</p></div></header>
            <div class="pcard-body">
              ${ef.plan === 'ejecutivo' ? `
                <div class="brand-edit">
                  <div class="brand-prev"><img src="${esc(PLX.logo())}" alt="Logo actual" width="64" height="64"></div>
                  <div class="brand-form">
                    <label class="small text-2" for="mk-nombre">Nombre comercial</label>
                    <div class="inline-form">
                      <input class="input" id="mk-nombre" value="${esc(p.nombre || t.nombre)}" maxlength="60" data-enter="guardar-nombre">
                      <button type="button" class="btn btn-sm btn-primary" data-action="guardar-nombre">Guardar</button>
                    </div>
                    <div class="inline-form" style="margin-top:12px">
                      <label class="btn btn-sm" style="cursor:pointer">${icon('upload', 'i-sm')} Subir logo<input type="file" accept="image/*" hidden data-change="logo"></label>
                      ${p.logo ? `<button type="button" class="btn btn-sm btn-ghost" data-action="quitar-logo">Quitar logo</button>` : ''}
                    </div>
                    <p class="tiny muted" style="margin-top:8px">PNG, JPG, SVG o WebP de hasta 3 MB. Se ajusta a 256 px.</p>
                  </div>
                </div>` : `
                <div class="locked-box">${icon('shield')}<div><strong>Marca propia · Plan Ejecutivo</strong><p class="small text-2">En el Plan Base el panel muestra la marca PARALLAX Suite. Pasá al Plan Ejecutivo para subir tu logo.</p><button type="button" class="btn btn-sm btn-outline-cyan" data-saas="pagar">Activar Plan Ejecutivo</button></div></div>`}
            </div>
          </section>

          <section class="pcard">
            <header class="pcard-head"><div><h2 class="pcard-title">${icon('inbox', 'i-sm')} Soporte y Asesoría técnica</h2><p class="pcard-sub">Consultas sobre tu cuenta, carga de datos o facturación.</p></div>
              ${ef.plan === 'ejecutivo' ? `<button class="btn btn-xs btn-primary" data-action="nuevo-ticket">${icon('plus', 'i-sm')} Nueva consulta</button>` : ''}</header>
            <div class="pcard-body ${tks.length ? 'flush' : ''}">
              ${ef.plan !== 'ejecutivo'
                ? `<div class="locked-box">${icon('shield')}<div><strong>Incluido en el Plan Ejecutivo</strong><p class="small text-2">Asesoría técnica para implementar tu coworking, importar tus locatarios y configurar ARCA/AFIP.</p></div></div>`
                : tks.length ? `<div class="list">${tks.slice(0, 6).map((k) => `<div class="list-item"><span class="avatar">${icon('inbox', 'i-sm')}</span><div class="grow"><div class="title">${esc(k.asunto)}</div><div class="meta">${util.fmtDateTime(k.fecha)} · ${esc(k.id)}</div></div>${ui.badge('Recibida', 'cyan', true)}</div>`).join('')}</div>`
                  : ui.empty('Todavía no enviaste consultas.', 'inbox')}
            </div>
          </section>
        </div>

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head"><div><h2 class="pcard-title">${icon('receipt', 'i-sm')} Pagos de la suscripción</h2><p class="pcard-sub">Comprobantes de PARALLAX Suite a tu cuenta.</p></div></header>
          <div class="pcard-body flush">
            ${ui.table({
              rows: pagos,
              empty: ef.plan === 'base' ? 'El Plan Base no genera cobros.' : 'Todavía no hay pagos registrados.',
              emptyIcon: 'receipt',
              cols: [
                { label: 'Fecha', primary: true, cell: (x) => `<span class="strong">${fechaCorta(x.fecha)}</span>` },
                { label: 'Concepto', cell: (x) => esc(x.concepto) },
                { label: 'Medio', cell: (x) => esc(x.medio) },
                { label: 'Importe', cls: 'num', cell: (x) => `USD ${x.usd} · ${util.money0(x.ars)}` },
                { label: 'Estado', cell: () => ui.badge('Acreditado', 'cyan', true) }
              ]
            })}
          </div>
        </section>`;
    },

    changes: {
      async logo(el) {
        const f = el.files && el.files[0];
        if (!f) return;
        try {
          const url = await redimensionar(f);
          store.setConfig({ prestador: { logo: url } });
          refrescar();
          ui.toast('Logo actualizado. Ya se ve en el panel y en los resúmenes.');
        } catch (e) { ui.toast(e.message, 'warn'); }
        el.value = '';
      }
    },

    actions: {
      'guardar-nombre'() {
        const v = ($('#mk-nombre').value || '').trim();
        if (v.length < 2) return ui.toast('Ingresá un nombre de al menos 2 letras.', 'warn');
        store.setConfig({ prestador: { nombre: v } });
        S.actualizar(tid(), { nombre: v });
        refrescar();
        ui.toast('Nombre comercial actualizado.');
      },
      'quitar-logo'() {
        store.setConfig({ prestador: { logo: '' } });
        refrescar();
        ui.toast('Se volvió al emblema por defecto.');
      },
      'nuevo-ticket'() {
        ui.modal({
          title: 'Consulta a Asesoría técnica',
          sub: 'Te respondemos por email en el próximo día hábil.',
          size: 'narrow',
          body: ui.form([
            { name: 'asunto', label: 'Asunto', required: true, span: 2, placeholder: 'Ej.: Importar locatarios desde Excel' },
            { name: 'detalle', label: 'Detalle', type: 'textarea', required: true, span: 2 }
          ]),
          submitLabel: 'Enviar consulta',
          onSubmit: (v) => {
            const l = tickets();
            l.push({ id: `AT-${String(l.length + 1).padStart(4, '0')}`, fecha: new Date().toISOString(), asunto: v.asunto, detalle: v.detalle });
            guardarTickets(l);
            ui.toast('Consulta enviada a Asesoría técnica.');
            PLX.app.render();
          }
        });
      }
    }
  };

  /* ======================================================================
     6 · Arranque
     ====================================================================== */
  store.on(() => { renderMarca(); renderBanner(); });
  // Se espera a que el panel termine de cargar los datos
  const t0 = setInterval(() => {
    if (!doc.body.classList.contains('is-ready')) return;
    clearInterval(t0);
    refrescar();
  }, 60);
  // El estado puede cambiar por fecha: se revisa periódicamente
  setInterval(() => { if (doc.body.classList.contains('is-ready')) { renderBanner(); renderLock(); } }, 60000);
})(window);
