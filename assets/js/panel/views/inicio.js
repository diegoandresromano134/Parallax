/* ==========================================================================
   PARALLAX · Vista: Inicio (tablero general de Gestoría)
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, billing, icon } = PLX;
  const esc = util.esc;

  function chartPeriodo(resumenes) {
    const rows = resumenes
      .map((r) => ({ nombre: r.locatario.nombreComercial, abono: r.totales.abonos, consumos: r.totales.consumos, total: r.totales.subtotal }))
      .sort((a, b) => b.total - a.total);
    if (!rows.length) return ui.empty('Sin movimientos en el período.', 'chart');
    const max = Math.max(...rows.map((r) => r.total)) || 1;
    return `<div class="hbars" role="img" aria-label="Abono y consumos del período por locatario">
      ${rows.map((r) => {
        const tip = (lbl, v) => esc(`<strong>${esc(r.nombre)}</strong><span class="tv">${lbl}: ${util.money(v)}</span>`);
        const segs = [
          r.abono > 0 ? `<div class="hbar-seg c1" style="flex:${r.abono} 1 0" data-tip="${tip('Abono', r.abono)}"></div>` : '',
          r.consumos > 0 ? `<div class="hbar-seg c2" style="flex:${r.consumos} 1 0" data-tip="${tip('Consumos', r.consumos)}"></div>` : ''
        ].join('');
        return `<div class="hbar">
          <span class="hbar-label" title="${esc(r.nombre)}">${esc(r.nombre)}</span>
          <div class="hbar-track">
            <div class="hbar-bars" style="width:${Math.max(2, (r.total / max) * 78).toFixed(2)}%">${segs}</div>
            <span class="hbar-value">${util.money0(r.total)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function chartIngresos(db) {
    const hoy = util.todayStr();
    const dias = [];
    for (let i = 13; i >= 0; i--) dias.push(util.addDays(hoy, -i));
    const counts = dias.map((d) => db.accesos.filter((a) => util.localDateOfIso(a.ingreso) === d).length);
    const max = Math.max(...counts, 1);
    const iMax = counts.indexOf(Math.max(...counts));
    const nice = Math.ceil(max / 4) * 4 || 4;
    const cols = dias.map((d, i) => {
      const dow = util.parseDate(d).getDay();
      const pct = (counts[i] / nice) * 100;
      const cap = i === iMax || i === dias.length - 1 ? `<span class="col-cap">${counts[i]}</span>` : '';
      const tip = esc(`<strong>${util.fmtDayShort(d)}</strong><span class="tv">${counts[i]} ${counts[i] === 1 ? 'ingreso' : 'ingresos'}</span>`);
      return `<div class="col${dow === 0 || dow === 6 ? ' is-weekend' : ''}" data-tip="${tip}">
        <div class="col-bar" style="height:${pct.toFixed(1)}%">${''}</div>${cap}
      </div>`;
    }).join('');
    const xs = dias.map((d, i) => `<span>${i % 2 === 1 || i === dias.length - 1 ? util.parseDate(d).getDate() : ''}</span>`).join('');
    return `<div class="cols" role="img" aria-label="Ingresos por día, últimos 14 días">${cols}</div><div class="cols-x" aria-hidden="true">${xs}</div>
      <p class="tiny muted" style="margin-top:10px">Escala 0 – ${nice} · sábados y domingos atenuados</p>`;
  }

  PLX.views.inicio = {
    title: 'Inicio',

    render() {
      const db = store.db;
      const hoy = util.todayStr();
      const p = util.periodOf();
      const estados = db.contratos.map((c) => ({ c, e: billing.estadoContrato(c) }));
      const vigentes = estados.filter((x) => x.e.id === 'vigente' || x.e.id === 'por-vencer');
      const porVencer = estados.filter((x) => x.e.id === 'por-vencer' || x.e.id === 'vencido');
      const abonosMes = util.sum(vigentes, (x) => x.c.montoMensual);
      const presentes = h.presentes();
      const ingresosHoy = db.accesos.filter((a) => util.localDateOfIso(a.ingreso) === hoy).length;
      const resumenes = billing.computeAll(db, p);
      const consumosMes = util.sum(resumenes, (r) => r.totales.consumos);
      const regConsumo = billing.consumosDelPeriodo(db, null, p).length;
      const nuevas = db.consultas.filter((c) => c.estado === 'nueva').length;

      const pPrev = util.shiftPeriod(p, -1);
      const sinEmitir = billing.locatariosDelPeriodo(db, pPrev).filter((l) => !billing.emitido(db, l.id, pPrev));
      const datosPend = db.locatarios.filter((l) => !l.cuit || !l.razonSocial);

      const pendientes = [
        ...porVencer.map(({ c, e }) => `
          <a class="list-item" href="#/contratos">
            <span class="avatar">${icon('contract', 'i-sm')}</span>
            <div class="grow"><div class="title">${esc(h.locName(c.locatarioId))} · ${esc(c.numero)}</div>
            <div class="meta">${e.id === 'vencido' ? 'Venció' : 'Vence'} el ${util.fmtDate(c.fechaFin)} · ${esc(h.planName(c.planId))}</div></div>
            ${ui.badge(e.nombre, 'magenta', true)}
          </a>`),
        ...(sinEmitir.length ? [`
          <a class="list-item" href="#/facturacion">
            <span class="avatar">${icon('receipt', 'i-sm')}</span>
            <div class="grow"><div class="title">Resúmenes de ${util.periodLabel(pPrev)} sin emitir</div>
            <div class="meta">${sinEmitir.map((l) => esc(l.nombreComercial)).join(', ')}</div></div>
            ${ui.badge(String(sinEmitir.length), 'magenta')}
          </a>`] : []),
        ...(datosPend.length ? [`
          <a class="list-item" href="#/contratos/locatarios">
            <span class="avatar">${icon('office', 'i-sm')}</span>
            <div class="grow"><div class="title">Datos de locatarios por completar</div>
            <div class="meta" title="${esc(datosPend.map((l) => l.nombreComercial).join(', '))}">Razón social o CUIT: ${datosPend.map((l) => esc(l.nombreComercial)).join(', ')}</div></div>
            ${ui.badge(String(datosPend.length), 'outline')}
          </a>`] : [])
      ];

      const demo = db.meta && db.meta.demo
        ? `<div class="note" style="margin-bottom:16px">${icon('info', 'i-sm')}<div>Estás viendo <strong>datos de demostración</strong> (montos, personas y consumos ilustrativos). Podés editarlos, restablecerlos o comenzar con una base vacía desde <a href="#/configuracion" style="color:var(--cyan)">Configuración</a>.</div></div>`
        : '';

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Panel de Gestoría</h1>
            <p class="page-sub">${esc(util.fmtDateLong(hoy))} · Período en curso: <strong>${util.periodLabel(p)}</strong></p>
          </div>
          <div class="page-actions">
            <button class="btn btn-sm" data-action="nuevo-ingreso">${icon('login', 'i-sm')} Registrar ingreso</button>
            <button class="btn btn-sm" data-action="nuevo-consumo">${icon('package', 'i-sm')} Registrar consumo</button>
            <button class="btn btn-primary btn-sm" data-action="nuevo-contrato">${icon('plus', 'i-sm')} Nuevo contrato</button>
          </div>
        </div>
        ${demo}
        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Contratos vigentes', value: vigentes.length, hint: `${porVencer.length} por vencer o vencidos`, ic: 'contract' })}
          ${ui.kpi({ label: 'Abonos mensuales', value: util.money0(abonosMes), hint: 'Suma de abonos de membresía vigentes', ic: 'receipt' })}
          ${ui.kpi({ label: 'En el espacio', value: presentes.length, hint: `${ingresosHoy} ingresos registrados hoy`, ic: 'badge' })}
          ${ui.kpi({ label: 'Consumos del mes', value: util.money0(consumosMes), hint: `${regConsumo} registros en ${util.periodLabel(p)}`, ic: 'package', tone: 'magenta' })}
          ${ui.kpi({ label: 'Consultas nuevas', value: nuevas, hint: 'Recibidas desde el sitio público', ic: 'inbox', tone: 'magenta' })}
        </div>

        <div class="grid grid-3-2">
          <section class="pcard">
            <header class="pcard-head">
              <div>
                <h2 class="pcard-title">${icon('chart', 'i-sm')} Gastos del período por locatario</h2>
                <p class="pcard-sub">${util.periodLabel(p)} · importes netos, sin IVA</p>
              </div>
              <div class="legend"><span><i style="background:var(--chart-1)"></i>Abono</span><span><i style="background:var(--chart-2)"></i>Consumos</span></div>
            </header>
            <div class="pcard-body">${chartPeriodo(resumenes)}</div>
          </section>
          <section class="pcard">
            <header class="pcard-head">
              <div>
                <h2 class="pcard-title">${icon('pulse', 'i-sm')} Ingresos al espacio</h2>
                <p class="pcard-sub">Últimos 14 días · registros del Control de Accesos</p>
              </div>
            </header>
            <div class="pcard-body">${chartIngresos(db)}</div>
          </section>
        </div>

        <div class="grid grid-3-2" style="margin-top:16px">
          <section class="pcard">
            <header class="pcard-head">
              <div>
                <h2 class="pcard-title">${icon('users', 'i-sm')} En el espacio ahora</h2>
                <p class="pcard-sub">${presentes.length} ${presentes.length === 1 ? 'persona autorizada' : 'personas autorizadas'} con ingreso abierto</p>
              </div>
              <a class="btn btn-xs" href="#/accesos">Ver Control de Accesos</a>
            </header>
            <div class="pcard-body flush">
              ${presentes.length ? `<div class="list">${presentes.slice(0, 7).map((a) => `
                <div class="list-item">
                  <span class="avatar">${esc(util.initials(a.nombre))}</span>
                  <div class="grow"><div class="title">${esc(a.nombre)}</div><div class="meta">${esc(h.locName(a.locatarioId))} · desde ${util.fmtTime(a.ingreso)} (${util.fmtDuration(Date.now() - new Date(a.ingreso))})</div></div>
                  <button class="btn btn-xs" data-action="egreso" data-id="${a.id}">${icon('logout', 'i-sm')} Egreso</button>
                </div>`).join('')}
                ${presentes.length > 7 ? `<a class="list-item muted small" href="#/accesos">y ${presentes.length - 7} más…</a>` : ''}
              </div>` : ui.empty('No hay personas con ingreso abierto.', 'users')}
            </div>
          </section>
          <section class="pcard">
            <header class="pcard-head">
              <div>
                <h2 class="pcard-title">${icon('alert', 'i-sm')} Vencimientos y pendientes</h2>
                <p class="pcard-sub">Contratos, resúmenes y datos por completar</p>
              </div>
            </header>
            <div class="pcard-body flush">
              ${pendientes.length ? `<div class="list">${pendientes.join('')}</div>` : ui.empty('Todo al día.', 'check')}
            </div>
          </section>
        </div>`;
    },

    actions: {
      'nuevo-ingreso': () => PLX.forms.ingreso(),
      'nuevo-consumo': () => PLX.forms.consumo(),
      'nuevo-contrato': () => PLX.forms.contrato(),
      egreso: (el) => {
        const r = h.registrarEgreso(el.dataset.id);
        ui.toast(r.ok ? `Egreso registrado: ${r.acceso.nombre}` : r.motivo, r.ok ? 'ok' : 'warn');
      }
    }
  };
})(window);
