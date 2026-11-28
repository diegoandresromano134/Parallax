/* ==========================================================================
   PARALLAX · Vista: Cobros
   Cuenta corriente de cada cliente: resúmenes emitidos, vencimientos, pagos,
   intereses por mora (los pagos se imputan primero a intereses), pagos
   informados por los miembros y avisos de vencimiento.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, domain, icon, backend } = PLX;
  const esc = util.esc;
  const C = () => PLX.reglas.cuenta;
  const ESTADO = {
    pagado: ['Pagado', 'outline'],
    pendiente: ['Por vencer', 'cyan'],
    parcial: ['Pago parcial', 'cyan'],
    vencido: ['Vencido', 'magenta']
  };
  const medios = () => (store.config().cobros.mediosPago || []).filter((m) => m.activo !== false);

  function mensajeAviso(l, est) {
    const cfg = store.config().cobros;
    const venc = est.cargos.filter((x) => x.saldo > 0.5);
    const lineas = venc.map((x) => `• ${util.periodLabel(x.periodo)} (${x.numero}): ${util.money(x.saldo)}${x.estado === 'vencido' ? ` · vencido el ${util.fmtDate(x.vencimiento)}` : ` · vence el ${util.fmtDate(x.vencimiento)}`}`).join('\n');
    const datos = [cfg.banco && `Banco: ${cfg.banco}`, cfg.titular && `Titular: ${cfg.titular}`, cfg.cbu && `CBU: ${cfg.cbu}`, cfg.alias && `Alias: ${cfg.alias}`].filter(Boolean).join('\n');
    return `Hola ${l.nombre || l.nombreComercial}, te escribimos de ${PLX.marca()} por el estado de tu cuenta (${l.numeroCliente}):\n${lineas}\nTotal: ${util.money(est.deuda)}\n${datos ? `\nDatos para transferir:\n${datos}\n` : ''}\nPodés informar tu pago desde el Área de Miembros. ¡Gracias!`;
  }

  /* ---------- Registrar pago ---------- */
  PLX.forms.pago = (preset = {}) => {
    const locOpts = h.locOptions((l) => store.all('resumenes').some((r) => r.locatarioId === l.id));
    if (!locOpts.length) return ui.toast('Todavía no hay resúmenes emitidos para cobrar.', 'warn');
    const locId = preset.locatarioId || locOpts[0].value;
    const opcionesCargo = (lid) => C().estado(store.db, lid).cargos.map((x) => `<option value="${x.resumenId}" data-saldo="${x.saldo}"${x.resumenId === preset.resumenId ? ' selected' : ''}>${esc(x.numero)} · ${util.periodLabel(x.periodo)} · saldo ${util.money(x.saldo)}</option>`).join('');
    ui.modal({
      title: 'Registrar pago',
      sub: 'El pago se imputa primero a los intereses por mora y luego al capital.',
      submitLabel: 'Registrar pago',
      body: ui.form([
        { name: 'locatarioId', label: 'Cliente', type: 'select', required: true, options: locOpts, value: locId },
        { type: 'html', html: `<div class="field"><label for="pg-res">Resumen que paga</label><select class="select" id="pg-res" name="resumenId">${opcionesCargo(locId)}</select></div>` },
        { name: 'fecha', label: 'Fecha de acreditación', type: 'date', required: true, value: util.todayStr() },
        { name: 'importe', label: 'Importe (ARS)', type: 'number', min: 0.01, step: 0.01, required: true },
        { name: 'medio', label: 'Medio de pago', type: 'select', options: medios().map((m) => m.nombre) },
        { name: 'referencia', label: 'Referencia', placeholder: 'N° de operación, echeq, recibo', maxlength: 120 }
      ]),
      onMount(d, form) {
        const sync = () => { const o = form.querySelector('#pg-res').selectedOptions[0]; if (o && !form.elements.importe.dataset.tocado) form.elements.importe.value = Number(o.dataset.saldo).toFixed(2); };
        form.elements.importe.addEventListener('input', () => { form.elements.importe.dataset.tocado = '1'; });
        form.elements.locatarioId.addEventListener('change', () => { form.querySelector('#pg-res').innerHTML = opcionesCargo(form.elements.locatarioId.value); delete form.elements.importe.dataset.tocado; sync(); });
        form.querySelector('#pg-res').addEventListener('change', () => { delete form.elements.importe.dataset.tocado; sync(); });
        sync();
      },
      onSubmit(d) {
        if (!d.resumenId) { ui.toast('Elegí el resumen que se paga.', 'warn'); return false; }
        store.insert('pagos', { locatarioId: d.locatarioId, resumenId: d.resumenId, fecha: d.fecha, importe: util.round2(d.importe), medio: d.medio, referencia: d.referencia, estado: 'confirmado', origen: 'administracion', registradoPor: backend.user.usuario }, 'pag');
        ui.toast(`Pago de ${util.money(d.importe)} registrado para ${h.locName(d.locatarioId)}.`);
      }
    });
  };

  /* ---------- Cuenta corriente de un cliente ---------- */
  function cuenta(locId) {
    const l = h.loc(locId);
    const est = C().estado(store.db, locId);
    const pagos = store.where('pagos', (p) => p.locatarioId === locId).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const msg = mensajeAviso(l, est);
    const tel = String(l.telefono || '').replace(/\D/g, '');
    ui.modal({
      title: `Cuenta corriente · ${l.nombreComercial}`,
      sub: `${esc(l.numeroCliente)} · saldo ${util.money(est.deuda)}${est.vencido ? ` · vencido ${util.money(est.vencido)}` : ''}`,
      size: 'wide',
      cancelLabel: 'Cerrar',
      noAutofocus: true,
      footLeft: `<button type="button" class="btn btn-sm btn-primary" data-maction="pagar">${icon('plus', 'i-sm')} Registrar pago</button>
        ${est.deuda > 0.5 ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${tel ? `549${tel.replace(/^0|^549?/, '')}` : ''}?text=${encodeURIComponent(msg)}">${icon('phone', 'i-sm')} Aviso por WhatsApp</a>
        <a class="btn btn-sm" href="mailto:${esc(l.email || '')}?subject=${encodeURIComponent(`${PLX.marca()} · Estado de cuenta`)}&body=${encodeURIComponent(msg)}">${icon('mail', 'i-sm')} Aviso por email</a>` : ''}`,
      body: `
        ${ui.table({
          rows: est.cargos.slice().reverse(),
          empty: 'Sin resúmenes emitidos.',
          stack: true,
          cols: [
            { label: 'Resumen', primary: true, cell: (x) => `<span class="strong mono">${esc(x.numero)}</span><span class="sub">${util.periodLabel(x.periodo)}</span>` },
            { label: 'Vence', cell: (x) => `<span class="mono small">${util.fmtDate(x.vencimiento)}</span>` },
            { label: 'Total', cls: 'num', cell: (x) => util.money(x.total) },
            { label: 'Pagado', cls: 'num', cell: (x) => util.money(x.pagado) },
            { label: 'Intereses', cls: 'num', cell: (x) => (x.intereses ? util.money(x.intereses) : '—') },
            { label: 'Saldo', cls: 'num', cell: (x) => `<strong>${util.money(x.saldo)}</strong>${x.diasMora ? `<span class="sub">${x.diasMora} días de mora</span>` : ''}` },
            { label: 'Estado', cell: (x) => ui.badge(ESTADO[x.estado][0], ESTADO[x.estado][1], true) }
          ]
        })}
        <h3 class="ficha-title" style="margin-top:18px">${icon('receipt', 'i-sm')} Pagos</h3>
        ${ui.table({
          rows: pagos,
          empty: 'Sin pagos registrados.',
          cols: [
            { label: 'Fecha', cell: (p) => `<span class="mono small">${util.fmtDate(p.fecha)}</span>` },
            { label: 'Resumen', cell: (p) => { const r = store.get('resumenes', p.resumenId); return r ? `<span class="mono small">${esc(r.numero)}</span>` : '—'; } },
            { label: 'Medio', primary: true, cell: (p) => `${esc(p.medio || '—')}<span class="sub">${esc(p.referencia || '')}</span>` },
            { label: 'Importe', cls: 'num', cell: (p) => util.money(p.importe) },
            { label: 'Estado', cell: (p) => { const e = domain.ESTADOS_PAGO[p.estado]; return ui.badge(e.nombre, e.tono, true); } },
            { label: '', cls: 'actions', cell: (p) => (p.estado === 'confirmado' ? `<button type="button" class="btn btn-icon btn-sm btn-ghost" data-maction="borrar-pago" data-id="${p.id}" aria-label="Eliminar pago">${icon('trash', 'i-sm')}</button>` : '') }
          ]
        })}`,
      onAction: {
        pagar: () => PLX.forms.pago({ locatarioId: locId }),
        'borrar-pago': async (el) => {
          const ok = await ui.confirm({ title: 'Eliminar pago', message: 'El saldo y los intereses se recalculan sin este pago.', confirmLabel: 'Eliminar', danger: true });
          if (ok) { store.remove('pagos', el.dataset.id); ui.toast('Pago eliminado.'); }
          cuenta(locId);
        }
      }
    });
  }

  async function verComprobante(docId) {
    const d = store.get('documentos', docId);
    if (!d) return ui.toast('El comprobante no está disponible.', 'warn');
    try {
      const url = await backend.files.url(d);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { ui.toast(e.message, 'warn'); }
  }

  PLX.views.cobros = {
    title: 'Cobros',

    render(ctx) {
      const st = ctx.state;
      const db = store.db;
      const filas = db.locatarios.map((l) => ({ l, est: C().estado(db, l.id) })).filter((x) => x.est.cargos.length);
      const deuda = util.sum(filas, (x) => x.est.deuda);
      const vencido = util.sum(filas, (x) => x.est.vencido);
      const intereses = util.sum(filas, (x) => x.est.intereses);
      const informados = db.pagos.filter((p) => p.estado === 'informado');
      const cfg = db.config.cobros;
      const q = util.normalize(st.q);
      const rows = filas
        .filter((x) => !st.soloDeuda || x.est.deuda > 0.5)
        .filter((x) => !q || util.normalize(`${x.l.numeroCliente} ${x.l.nombreComercial}`).includes(q))
        .sort((a, b) => b.est.vencido - a.est.vencido || b.est.deuda - a.est.deuda);
      const ultimos = db.pagos.filter((p) => p.estado === 'confirmado').sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
      const faltanDatos = !cfg.cbu && !cfg.alias;

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Cobros</h1>
            <p class="page-sub">Cuenta corriente de cada cliente: vencimientos, pagos e intereses por mora (${util.num(cfg.tasaMensual)}% mensual${cfg.diasGracia ? `, ${cfg.diasGracia} días de gracia` : ''}).</p>
          </div>
          <div class="page-actions">
            <a class="btn btn-sm" href="#configuracion">${icon('sliders', 'i-sm')} Medios de pago y mora</a>
            <button class="btn btn-primary btn-sm" data-action="pagar">${icon('plus', 'i-sm')} Registrar pago</button>
          </div>
        </div>
        ${faltanDatos ? `<div class="note is-magenta" style="margin-bottom:16px">${icon('alert', 'i-sm')}<div>Cargá el CBU o el alias de ${PLX.marca()} en <a href="#configuracion" style="color:var(--cyan)">Configuración</a> para que aparezcan en los avisos y en el Área de Miembros.</div></div>` : ''}
        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Saldo a cobrar', value: util.money0(deuda), hint: `${filas.filter((x) => x.est.deuda > 0.5).length} clientes con saldo`, ic: 'receipt' })}
          ${ui.kpi({ label: 'Vencido', value: util.money0(vencido), hint: `${filas.filter((x) => x.est.vencido > 0.5).length} clientes en mora`, ic: 'alert', tone: 'magenta' })}
          ${ui.kpi({ label: 'Intereses por mora', value: util.money0(intereses), hint: 'Devengados y sin cobrar', ic: 'pulse', tone: 'magenta' })}
          ${ui.kpi({ label: 'Pagos informados', value: informados.length, hint: 'Enviados por miembros, a confirmar', ic: 'inbox' })}
        </div>

        ${informados.length ? `<section class="pcard" style="margin-bottom:16px">
          <header class="pcard-head"><div><h2 class="pcard-title">${icon('inbox', 'i-sm')} Pagos informados por miembros</h2><p class="pcard-sub">Verificá la acreditación y confirmá o rechazá cada uno.</p></div></header>
          <div class="pcard-body flush">${ui.table({
            rows: informados,
            cols: [
              { label: 'Cliente', primary: true, cell: (p) => `<span class="strong">${esc(h.locName(p.locatarioId))}</span><span class="sub mono">${esc((h.loc(p.locatarioId) || {}).numeroCliente || '')}</span>` },
              { label: 'Fecha', cell: (p) => `<span class="mono small">${util.fmtDate(p.fecha)}</span>` },
              { label: 'Medio', cell: (p) => `${esc(p.medio || '—')}<span class="sub">${esc(p.referencia || '')}</span>` },
              { label: 'Resumen', cell: (p) => { const r = store.get('resumenes', p.resumenId); return r ? `<span class="mono small">${esc(r.numero)}</span>` : '—'; } },
              { label: 'Importe', cls: 'num', cell: (p) => util.money(p.importe) },
              { label: '', cls: 'actions', cell: (p) => `${p.comprobanteId ? `<button type="button" class="btn btn-xs" data-action="comprobante" data-id="${p.comprobanteId}">${icon('eye', 'i-sm')} Comprobante</button>` : ''}<button type="button" class="btn btn-xs btn-outline-cyan" data-action="confirmar" data-id="${p.id}">${icon('check', 'i-sm')} Confirmar</button><button type="button" class="btn btn-xs btn-ghost" data-action="rechazar" data-id="${p.id}">Rechazar</button>` }
            ]
          })}</div>
        </section>` : ''}

        <div class="toolbar">
          <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-cobros" type="search" placeholder="Buscar cliente" value="${esc(st.q || '')}" data-input="q"></div>
          <label class="switch"><input type="checkbox" data-change="solo-deuda"${st.soloDeuda ? ' checked' : ''}><span class="track"></span><span>Solo con saldo</span></label>
        </div>
        <section class="pcard">
          ${ui.table({
            rows,
            empty: 'Sin resúmenes emitidos todavía. Emitilos desde Gastos y Facturación.',
            emptyIcon: 'receipt',
            cols: [
              { label: 'N° cliente', cell: (x) => `<span class="strong mono">${esc(x.l.numeroCliente || '')}</span>` },
              { label: 'Cliente', primary: true, cell: (x) => `<button type="button" class="link-btn" data-action="cuenta" data-id="${x.l.id}"><span class="strong">${esc(x.l.nombreComercial)}</span></button><span class="sub">${x.est.cargos.length} resúmenes</span>` },
              { label: 'Saldo', cls: 'num', cell: (x) => `<strong>${util.money(x.est.deuda)}</strong>` },
              { label: 'Vencido', cls: 'num', cell: (x) => (x.est.vencido ? `<span class="is-low">${util.money(x.est.vencido)}</span>` : '—') },
              { label: 'Intereses', cls: 'num', cell: (x) => (x.est.intereses ? util.money(x.est.intereses) : '—') },
              { label: 'Mora', cls: 'num', cell: (x) => (x.est.diasMoraMax ? `${x.est.diasMoraMax} días` : '—') },
              { label: 'Estado', cell: (x) => { const e = x.est.deuda <= 0.5 ? ESTADO.pagado : x.est.vencido > 0.5 ? ESTADO.vencido : ESTADO.pendiente; return ui.badge(e[0], e[1], true); } },
              { label: '', cls: 'actions', cell: (x) => ui.iconBtn('cuenta', 'eye', 'Ver cuenta corriente', `data-id="${x.l.id}"`) + (x.est.deuda > 0.5 ? ui.iconBtn('pagar', 'plus', 'Registrar pago', `data-loc="${x.l.id}"`) : '') }
            ]
          })}
        </section>

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head"><h2 class="pcard-title">${icon('archive', 'i-sm')} Últimos pagos acreditados</h2></header>
          <div class="pcard-body flush">${ultimos.length ? `<div class="list">${ultimos.map((p) => `<div class="list-item"><span class="avatar">${icon('check', 'i-sm')}</span><div class="grow"><div class="title">${esc(h.locName(p.locatarioId))} · ${util.money(p.importe)}</div><div class="meta">${util.fmtDate(p.fecha)} · ${esc(p.medio || '')} ${esc(p.referencia || '')}</div></div></div>`).join('')}</div>` : ui.empty('Sin pagos todavía.', 'receipt')}</div>
        </section>
        <div class="note" style="margin-top:16px">${icon('info', 'i-sm')}<div>La mora es automática al vencer el plazo (art. 886 del Código Civil y Comercial). Los intereses se calculan por día sobre el capital impago y cada pago se imputa primero a intereses y después a capital (art. 903). Definí la tasa con tu contador: los jueces pueden reducir intereses que consideren excesivos (art. 771).</div></div>`;
    },

    inputs: { q(el, e, ctx) { ctx.state.q = el.value; ctx.render(); } },
    changes: { 'solo-deuda'(el, e, ctx) { ctx.state.soloDeuda = el.checked; ctx.render(); } },
    actions: {
      pagar: (el) => PLX.forms.pago(el.dataset.loc ? { locatarioId: el.dataset.loc } : {}),
      cuenta: (el) => cuenta(el.dataset.id),
      comprobante: (el) => verComprobante(el.dataset.id),
      confirmar(el) {
        const p = store.get('pagos', el.dataset.id);
        store.update('pagos', p.id, { estado: 'confirmado', confirmadoPor: backend.user.usuario, confirmadoEn: new Date().toISOString() });
        ui.toast(`Pago de ${util.money(p.importe)} confirmado.`);
      },
      async rechazar(el) {
        const ok = await ui.confirm({ title: 'Rechazar pago informado', message: 'El pago no se acreditará en la cuenta del cliente. Avisale el motivo.', confirmLabel: 'Rechazar', danger: true });
        if (ok) { store.update('pagos', el.dataset.id, { estado: 'rechazado' }); ui.toast('Pago rechazado.'); }
      }
    }
  };

  PLX.cobros = { cuenta, mensajeAviso };
})(window);
