/* ==========================================================================
   PARALLAX · Vista: Resumen de Gastos y Facturación
   Consolida abonos y consumos del mes por locatario, emite el resumen final
   numerado y lo exporta (CSV / JSON) para integrarlo a un programa contable.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, billing, domain, icon } = PLX;
  const esc = util.esc;

  /* ---------- Documento ---------- */
  function lineasTabla(lineas) {
    return `<div class="table-wrap"><table class="tbl stack-sm">
      <thead><tr><th>Concepto</th><th class="num">Cantidad</th><th>Unidad</th><th class="num">P. unitario</th><th class="num">Importe</th></tr></thead>
      <tbody>${lineas.map((l) => `
        <tr>
          <td class="primary"><span class="strong">${esc(l.concepto)}</span>${l.detalle ? `<span class="sub">${esc(l.detalle)}</span>` : ''}</td>
          <td class="num" data-label="Cantidad">${util.num(l.cantidad)}</td>
          <td data-label="Unidad">${esc(l.unidad)}</td>
          <td class="num" data-label="P. unitario">${util.money(l.precioUnitario)}</td>
          <td class="num" data-label="Importe">${util.money(l.neto)}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  function renderDoc(res, meta = {}) {
    const p = res.prestador || {};
    const l = res.locatario || {};
    const abonos = res.lineas.filter((x) => x.tipo === 'abono');
    const consumos = res.lineas.filter((x) => x.tipo === 'consumo');
    const cats = domain.CATEGORIAS.filter((c) => consumos.some((x) => x.categoria === c.id));
    const cfg = store.config();
    const cuentasUsadas = [...new Set(res.lineas.map((x) => `${x.cuenta} ${x.categoriaNombre}`))];

    return `
      <article class="doc">
        <header class="doc-head">
          <div class="doc-brand">
            <img src="assets/img/favicon.svg" alt="" width="40" height="40">
            <div>
              <span class="brand-word">PARALLAX</span>
              <small>Infraestructura y servicios compartidos corporativos</small>
            </div>
          </div>
          <div class="doc-id">
            <div class="doc-kind">Resumen de gastos</div>
            <div class="doc-num">${meta.numero ? esc(meta.numero) : 'Borrador · sin emitir'}</div>
            <div class="doc-date">Período ${esc(res.periodoLabel)} (${util.fmtDate(res.desde)} al ${util.fmtDate(res.hasta)})</div>
            ${meta.fecha ? `<div class="doc-date">Emitido el ${util.fmtDateTime(meta.fecha)}${meta.version > 1 ? ` · versión ${meta.version}` : ''}</div>` : ''}
          </div>
        </header>

        <div class="doc-parties">
          <div>
            <h4>Prestador</h4>
            <p><strong>${esc(p.razonSocial || p.nombre || 'PARALLAX')}</strong><br>
            ${p.cuit ? `CUIT ${esc(p.cuit)}` : '<span class="pend">CUIT del prestador sin configurar</span>'}<br>
            ${esc(p.condicionIva || '')}${p.domicilio ? `<br>${esc(p.domicilio)}` : ''}</p>
          </div>
          <div>
            <h4>Locatario</h4>
            <p><strong>${esc(l.razonSocial || l.nombreComercial)}</strong>${l.razonSocial && l.razonSocial !== l.nombreComercial ? `<br>${esc(l.nombreComercial)}` : ''}<br>
            ${l.cuit ? `CUIT ${esc(l.cuit)}` : '<span class="pend">CUIT pendiente de carga</span>'}${!l.razonSocial ? '<br><span class="pend">Razón social pendiente de carga</span>' : ''}<br>
            ${esc(l.condicionIva || '')}${l.domicilio ? `<br>${esc(l.domicilio)}` : ''}</p>
          </div>
        </div>

        ${abonos.length ? `<section class="doc-section"><h5>Abonos de Membresía</h5>${lineasTabla(abonos)}</section>` : ''}
        ${cats.map((c) => `<section class="doc-section"><h5>Consumos · ${esc(c.nombre)}</h5>${lineasTabla(consumos.filter((x) => x.categoria === c.id))}</section>`).join('')}
        ${!res.lineas.length ? `<div class="doc-section">${ui.empty('Sin abonos ni consumos en el período.', 'receipt')}</div>` : ''}

        <div class="doc-totals">
          <div><span>Abonos de Membresía</span><span>${util.money(res.totales.abonos)}</span></div>
          <div><span>Consumos</span><span>${util.money(res.totales.consumos)}</span></div>
          <div><span>Subtotal neto</span><span>${util.money(res.totales.subtotal)}</span></div>
          <div><span>IVA ${util.num(res.totales.alicuota)}%</span><span>${util.money(res.totales.iva)}</span></div>
          <div class="grand"><span>Total del período</span><span>${util.money(res.totales.total)}</span></div>
        </div>

        <div class="doc-section">
          <h5>Uso de instalaciones · informativo</h5>
          <div class="doc-usage">
            <div><span>Ingresos registrados</span><strong>${util.num(res.uso.ingresos)}</strong></div>
            <div><span>Horas de permanencia</span><strong>${util.num(res.uso.horas)}</strong></div>
            <div><span>Personas autorizadas</span><strong>${util.num(res.uso.personas)}</strong></div>
          </div>
        </div>

        <p class="doc-legal">
          Resumen correspondiente ${res.contratos.length ? `al contrato de locación de servicios ${res.contratos.map(esc).join(', ')}` : 'a servicios prestados por PARALLAX'},
          celebrado entre partes independientes en el marco de una relación de naturaleza estrictamente comercial.
          Consolida los Abonos de Membresía y los consumos registrados en el período; no reemplaza la factura electrónica correspondiente.
          Importes en pesos argentinos. Cuentas contables: ${cuentasUsadas.map(esc).join(' · ') || '—'}.
          ${cfg.prorrateo ? 'Los abonos que inician o finalizan dentro del período se prorratean por días.' : ''}
        </p>
      </article>`;
  }

  /* ---------- Operaciones ---------- */
  function datosFaltantes(l) {
    return !l || !l.razonSocial || !l.cuit;
  }

  async function emitir(locId, periodo, { silent = false } = {}) {
    const db = store.db;
    const l = h.loc(locId);
    const res = billing.compute(db, locId, periodo);
    if (!res.lineas.length) {
      ui.toast(`${l.nombreComercial} no tiene abonos ni consumos en ${util.periodLabel(periodo)}.`, 'warn');
      return null;
    }
    const prev = billing.emitido(db, locId, periodo);
    if (!silent) {
      const avisos = [];
      if (datosFaltantes(l)) avisos.push(`Faltan datos de <strong>${esc(l.nombreComercial)}</strong> (${[!l.razonSocial && 'razón social', !l.cuit && 'CUIT'].filter(Boolean).join(' y ')}).`);
      if (periodo >= util.periodOf()) avisos.push('El período todavía está en curso: podrás re-emitirlo al cierre.');
      if (prev) avisos.push(`Reemplaza la versión ${prev.version} de ${esc(prev.numero)} (se conserva el número).`);
      const ok = await ui.confirm({
        title: prev ? 'Re-emitir resumen de gastos' : 'Emitir resumen de gastos',
        message: `${esc(l.nombreComercial)} · ${util.periodLabel(periodo)} · Total ${util.money(res.totales.total)}${avisos.length ? `<br><br>${avisos.join('<br>')}` : ''}`,
        confirmLabel: prev ? 'Re-emitir' : 'Emitir'
      });
      if (!ok) return null;
    }
    const now = new Date().toISOString();
    let rec;
    if (prev) {
      rec = store.update('resumenes', prev.id, { snapshot: res, total: res.totales.total, emitidoEn: now, version: (prev.version || 1) + 1 });
    } else {
      const numero = store.nextResumenNumero(periodo);
      rec = store.insert('resumenes', { numero, periodo, locatarioId: locId, estado: 'emitido', version: 1, emitidoEn: now, total: res.totales.total, snapshot: res }, 'rsm');
    }
    if (!silent) ui.toast(`Resumen ${rec.numero} emitido para ${l.nombreComercial}.`);
    return rec;
  }

  function filas(periodo, st) {
    const db = store.db;
    return billing.computeAll(db, periodo)
      .filter((r) => !st.locatarioId || r.locatario.id === st.locatarioId)
      .map((res) => {
        const em = billing.emitido(db, res.locatario.id, periodo);
        const desact = em && Math.abs(util.round2(em.total) - res.totales.total) >= 0.01;
        return { res, em, desact, l: h.loc(res.locatario.id) };
      })
      .sort((a, b) => b.res.totales.total - a.res.totales.total);
  }

  function exportList(periodo, st) {
    return filas(periodo, st).map(({ res, em }) => (em ? { res: em.snapshot, numero: em.numero, fecha: em.emitidoEn } : { res, numero: '', fecha: '' }));
  }

  function verResumen({ locId, periodo, rsmId }) {
    let res, meta = {}, live = false;
    if (rsmId) {
      const r = store.get('resumenes', rsmId);
      res = r.snapshot;
      meta = { numero: r.numero, fecha: r.emitidoEn, version: r.version };
    } else {
      res = billing.compute(store.db, locId, periodo);
      const em = billing.emitido(store.db, locId, periodo);
      live = true;
      if (em) meta = { numero: em.numero, fecha: null, version: em.version };
    }
    const nombre = `${util.slug(res.locatario.nombreComercial)}-${res.periodo}`;
    const html = renderDoc(res, meta);
    const em = billing.emitido(store.db, res.locatario.id, res.periodo);
    ui.modal({
      title: `Resumen · ${res.locatario.nombreComercial}`,
      sub: live ? `Cálculo actual de ${esc(res.periodoLabel)}${em ? ` · última emisión ${esc(em.numero)}` : ' · aún sin emitir'}` : `Documento emitido · ${esc(meta.numero)}`,
      size: 'wide',
      cancelLabel: 'Cerrar',
      body: html,
      footLeft: `
        <button type="button" class="btn btn-sm" data-maction="print">${icon('printer', 'i-sm')} Imprimir / PDF</button>
        <button type="button" class="btn btn-sm" data-maction="csv">${icon('download', 'i-sm')} CSV</button>
        <button type="button" class="btn btn-sm" data-maction="json">${icon('database', 'i-sm')} JSON</button>`,
      onSubmit: live ? () => { emitir(res.locatario.id, res.periodo); return false; } : null,
      submitLabel: em ? 'Re-emitir' : 'Emitir resumen',
      onAction: {
        print: () => imprimir(html),
        csv: () => {
          util.download(`resumen-${nombre}.csv`, billing.toCsv([{ res, numero: meta.numero || '', fecha: meta.fecha || '' }]), 'text/csv;charset=utf-8');
          ui.toast('Resumen exportado en CSV.');
        },
        json: () => {
          util.download(`resumen-${nombre}.json`, billing.toJson([{ res, numero: meta.numero || '', fecha: meta.fecha || '' }]), 'application/json');
          ui.toast('Resumen exportado en JSON.');
        }
      }
    });
  }

  function imprimir(html) {
    const pr = document.getElementById('print-root');
    pr.innerHTML = html;
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      pr.innerHTML = '';
      root.removeEventListener('afterprint', done);
    };
    root.addEventListener('afterprint', done);
    setTimeout(() => root.print(), 50);
  }

  /* ---------- Vista ---------- */
  PLX.views.facturacion = {
    title: 'Gastos y Facturación',

    render(ctx) {
      const st = ctx.state;
      st.periodo = st.periodo || util.periodOf();
      const p = st.periodo;
      const rows = filas(p, st);
      const tot = {
        abonos: util.sum(rows, (r) => r.res.totales.abonos),
        consumos: util.sum(rows, (r) => r.res.totales.consumos),
        subtotal: util.sum(rows, (r) => r.res.totales.subtotal),
        iva: util.sum(rows, (r) => r.res.totales.iva),
        total: util.sum(rows, (r) => r.res.totales.total)
      };
      const emitidos = rows.filter((r) => r.em).length;
      const pendientes = rows.length - emitidos;
      const cur = util.periodOf();
      const filtroLoc = st.locatarioId ? h.loc(st.locatarioId) : null;
      const historial = store.all('resumenes')
        .filter((r) => r.estado === 'emitido' && (!st.locatarioId || r.locatarioId === st.locatarioId))
        .sort((a, b) => b.periodo.localeCompare(a.periodo) || b.numero.localeCompare(a.numero))
        .slice(0, 60);

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Resumen de Gastos y Facturación</h1>
            <p class="page-sub">Consolidado mensual de abonos y consumos por locatario, listo para exportar o integrar a un programa contable.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-sm" data-action="export-csv" ${rows.length ? '' : 'disabled'}>${icon('download', 'i-sm')} CSV contable</button>
            <button class="btn btn-sm" data-action="export-json" ${rows.length ? '' : 'disabled'}>${icon('database', 'i-sm')} JSON</button>
            <button class="btn btn-primary btn-sm" data-action="emitir-todos" ${pendientes ? '' : 'disabled'}>${icon('file-check', 'i-sm')} Emitir pendientes (${pendientes})</button>
          </div>
        </div>

        <div class="toolbar">
          ${ui.periodNav(p)}
          <select class="select" data-change="loc" aria-label="Filtrar por locatario">
            <option value="">Todos los locatarios</option>
            ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.locatarioId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
          ${filtroLoc ? `<button class="btn btn-xs btn-ghost" data-action="limpiar-loc">${icon('x', 'i-sm')} Quitar filtro</button>` : ''}
        </div>

        ${p >= cur ? `<div class="note is-magenta" style="margin-bottom:16px">${icon('clock', 'i-sm')}<div>${p === cur ? `<strong>${util.periodLabel(p)} está en curso.</strong> Los importes se actualizan con cada consumo registrado; emití los resúmenes finales al cierre del mes.` : 'Período futuro: solo se muestran abonos proyectados.'}</div></div>` : ''}

        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Abonos', value: util.money0(tot.abonos), hint: 'Abonos de Membresía del período', ic: 'contract' })}
          ${ui.kpi({ label: 'Consumos', value: util.money0(tot.consumos), hint: 'Utilería, mobiliario, papelería y otros', ic: 'package', tone: 'magenta' })}
          ${ui.kpi({ label: 'Total con IVA', value: util.money0(tot.total), hint: `Neto ${util.money0(tot.subtotal)} + IVA ${util.money0(tot.iva)}`, ic: 'receipt' })}
          ${ui.kpi({ label: 'Resúmenes emitidos', value: `${emitidos} / ${rows.length}`, hint: pendientes ? `${pendientes} pendientes de emisión` : 'Período completo', ic: 'file-check', tone: pendientes ? 'magenta' : '' })}
        </div>

        <section class="pcard">
          <header class="pcard-head">
            <div>
              <h2 class="pcard-title">${icon('receipt', 'i-sm')} Consolidado por locatario · ${util.periodLabel(p)}</h2>
              <p class="pcard-sub">Importes en ARS · alícuota IVA ${util.num(store.config().ivaAlicuota)}%</p>
            </div>
          </header>
          <div class="pcard-body flush">
            ${ui.table({
              rows,
              empty: `Sin abonos ni consumos en ${util.periodLabel(p)}.`,
              emptyIcon: 'receipt',
              cols: [
                { label: 'Locatario', primary: true, cell: ({ res, l }) => `<span class="strong">${esc(res.locatario.nombreComercial)}</span><span class="sub">${res.locatario.razonSocial ? esc(res.locatario.razonSocial) : '<span style="color:#f0a0fa">Razón social pendiente</span>'}</span>${l && !l.cuit ? '<span class="sub" style="color:#f0a0fa">CUIT pendiente</span>' : ''}` },
                { label: 'Abonos', cls: 'num', cell: ({ res }) => util.money(res.totales.abonos) },
                { label: 'Consumos', cls: 'num', cell: ({ res }) => util.money(res.totales.consumos) },
                { label: 'Neto', cls: 'num', cell: ({ res }) => util.money(res.totales.subtotal) },
                { label: 'IVA', cls: 'num', cell: ({ res }) => util.money(res.totales.iva) },
                { label: 'Total', cls: 'num', cell: ({ res }) => `<span class="strong">${util.money(res.totales.total)}</span>` },
                {
                  label: 'Estado', cell: ({ em, desact }) => em
                    ? `${ui.badge(desact ? 'Desactualizado' : 'Emitido', desact ? 'magenta' : 'cyan', true)}<span class="sub mono">${esc(em.numero)}</span>`
                    : ui.badge('Pendiente', 'outline', true)
                },
                {
                  label: '', cls: 'actions', cell: ({ res, em }) =>
                    ui.iconBtn('ver', 'eye', 'Ver resumen', `data-loc="${res.locatario.id}"`) +
                    `<button type="button" class="btn btn-xs ${em ? '' : 'btn-outline-cyan'}" data-action="emitir" data-loc="${res.locatario.id}">${em ? 'Re-emitir' : 'Emitir'}</button>`
                }
              ],
              foot: rows.length ? `<tr>
                <td data-label="">Total del período</td>
                <td class="num" data-label="Abonos">${util.money(tot.abonos)}</td>
                <td class="num" data-label="Consumos">${util.money(tot.consumos)}</td>
                <td class="num" data-label="Neto">${util.money(tot.subtotal)}</td>
                <td class="num" data-label="IVA">${util.money(tot.iva)}</td>
                <td class="num" data-label="Total">${util.money(tot.total)}</td>
                <td colspan="2" data-label=""></td></tr>` : ''
            })}
          </div>
        </section>

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head">
            <div>
              <h2 class="pcard-title">${icon('archive', 'i-sm')} Resúmenes emitidos</h2>
              <p class="pcard-sub">Documentos numerados conservados tal como fueron emitidos${filtroLoc ? ` · ${esc(filtroLoc.nombreComercial)}` : ''}</p>
            </div>
          </header>
          <div class="pcard-body flush">
            ${ui.table({
              rows: historial,
              empty: 'Todavía no se emitieron resúmenes.',
              emptyIcon: 'archive',
              cols: [
                { label: 'Número', primary: true, cell: (r) => `<span class="strong mono">${esc(r.numero)}</span>${r.version > 1 ? `<span class="sub">versión ${r.version}</span>` : ''}` },
                { label: 'Período', cell: (r) => util.periodLabel(r.periodo) },
                { label: 'Locatario', cell: (r) => esc(r.snapshot.locatario.nombreComercial) },
                { label: 'Total', cls: 'num', cell: (r) => util.money(r.total) },
                { label: 'Emitido', cell: (r) => `<span class="small text-2">${util.fmtDateTime(r.emitidoEn)}</span>` },
                { label: '', cls: 'actions', cell: (r) => ui.iconBtn('ver-emitido', 'eye', 'Ver documento emitido', `data-id="${r.id}"`) + ui.iconBtn('csv-emitido', 'download', 'Exportar CSV', `data-id="${r.id}"`) }
              ]
            })}
          </div>
        </section>

        <div class="note" style="margin-top:16px">${icon('database', 'i-sm')}<div><strong>Integración contable.</strong> El CSV usa separador «;» y coma decimal, con una línea por concepto y su cuenta contable (configurable en <a href="#configuracion" style="color:var(--cyan)">Configuración</a>). El JSON incluye la estructura completa de cada resumen para importación automatizada. Para resúmenes emitidos se exporta la versión emitida; para los pendientes, el cálculo actual sin número.</div></div>`;
    },

    changes: {
      'period-set'(el, e, ctx) { if (el.value) { ctx.state.periodo = el.value; ctx.render(); } },
      loc(el, e, ctx) { ctx.state.locatarioId = el.value; ctx.render(); }
    },

    actions: {
      'period-prev'(el, e, ctx) { ctx.state.periodo = util.shiftPeriod(ctx.state.periodo, -1); ctx.render(); },
      'period-next'(el, e, ctx) { ctx.state.periodo = util.shiftPeriod(ctx.state.periodo, 1); ctx.render(); },
      'limpiar-loc'(el, e, ctx) { ctx.state.locatarioId = ''; ctx.render(); },
      ver(el, e, ctx) { verResumen({ locId: el.dataset.loc, periodo: ctx.state.periodo }); },
      'ver-emitido'(el) { verResumen({ rsmId: el.dataset.id }); },
      emitir(el, e, ctx) { emitir(el.dataset.loc, ctx.state.periodo); },
      async 'emitir-todos'(el, e, ctx) {
        const p = ctx.state.periodo;
        const pend = filas(p, ctx.state).filter((r) => !r.em);
        const faltan = pend.filter((r) => datosFaltantes(r.l)).length;
        const ok = await ui.confirm({
          title: 'Emitir resúmenes pendientes',
          message: `Se emitirán <strong>${pend.length}</strong> resúmenes de ${util.periodLabel(p)}.${faltan ? `<br><br>${faltan} locatarios tienen razón social o CUIT pendientes.` : ''}${p >= util.periodOf() ? '<br><br>El período todavía está en curso.' : ''}`,
          confirmLabel: `Emitir ${pend.length}`
        });
        if (!ok) return;
        let n = 0;
        for (const r of pend) { if (await emitir(r.res.locatario.id, p, { silent: true })) n++; }
        ui.toast(`${n} resúmenes emitidos para ${util.periodLabel(p)}.`);
      },
      'csv-emitido'(el) {
        const r = store.get('resumenes', el.dataset.id);
        util.download(`resumen-${r.numero}.csv`, billing.toCsv([{ res: r.snapshot, numero: r.numero, fecha: r.emitidoEn }]), 'text/csv;charset=utf-8');
        ui.toast(`${r.numero} exportado.`);
      },
      'export-csv'(el, e, ctx) {
        util.download(`parallax-resumen-gastos-${ctx.state.periodo}.csv`, billing.toCsv(exportList(ctx.state.periodo, ctx.state)), 'text/csv;charset=utf-8');
        ui.toast('Consolidado exportado en CSV.');
      },
      'export-json'(el, e, ctx) {
        util.download(`parallax-resumen-gastos-${ctx.state.periodo}.json`, billing.toJson(exportList(ctx.state.periodo, ctx.state)), 'application/json');
        ui.toast('Consolidado exportado en JSON.');
      }
    }
  };

  PLX.facturacion = { renderDoc, verResumen, emitir };
})(window);
