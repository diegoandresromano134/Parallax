/* ==========================================================================
   PARALLAX · Calendario semanal de salas
   Lo usan el Panel de Gestoría (todas las reservas, con nombre del cliente)
   y el Área de Miembros (las propias con detalle; las demás como «Ocupado»).
   Acciones que emite (data-action): ag-prev, ag-next, ag-hoy, ag-sala,
   slot (data-fecha, data-hora) y reserva (data-id).
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util, reglas } = PLX;
  const esc = (s) => util.esc(s);
  const SLOT = 24; // px por bloque
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  const agenda = {
    lunes(fecha = util.todayStr()) {
      const d = util.parseDate(fecha);
      return util.addDays(fecha, -((d.getDay() + 6) % 7));
    },

    /**
     * opts: { db, salaId, lunes, modo: 'admin'|'miembro', locId (miembro), nombreDe(locId) }
     */
    render(opts) {
      const { db, lunes, modo } = opts;
      const cfg = reglas.reservas.config(db);
      const salas = (db.salas || []).filter((s) => s.activa !== false);
      if (!salas.length) return `<div class="empty">${PLX.icon('calendar')}<span>No hay salas cargadas.</span></div>`;
      const sala = salas.find((s) => s.id === opts.salaId) || salas[0];
      const ap = reglas.util.minutos(cfg.apertura);
      const ci = reglas.util.minutos(cfg.cierre);
      const paso = cfg.paso;
      const n = Math.max(1, Math.round((ci - ap) / paso));
      const alto = n * SLOT;
      const ahora = new Date();
      const hoy = util.todayStr(ahora);
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const f = util.addDays(lunes, i);
        if (cfg.dias.includes(util.parseDate(f).getDay())) dias.push(f);
      }
      const reservas = (db.reservas || []).filter((r) => r.salaId === sala.id && r.estado !== 'cancelada' && r.fecha >= dias[0] && r.fecha <= dias[dias.length - 1]);
      const top = (hhmm) => ((reglas.util.minutos(hhmm) - ap) / paso) * SLOT;

      const horas = [];
      for (let m = ap; m < ci; m += 60) horas.push(`<span style="top:${((m - ap) / paso) * SLOT}px">${reglas.util.hhmm(m)}</span>`);

      const columnas = dias.map((f) => {
        const d = util.parseDate(f);
        const slots = [];
        for (let k = 0; k < n; k++) {
          const m = ap + k * paso;
          const hh = reglas.util.hhmm(m);
          const pasado = new Date(`${f}T${hh}:00`) < ahora;
          slots.push(pasado
            ? `<span class="ag-slot is-past" style="top:${k * SLOT}px;height:${SLOT}px"></span>`
            : `<button type="button" class="ag-slot" data-action="slot" data-fecha="${f}" data-hora="${hh}" style="top:${k * SLOT}px;height:${SLOT}px" aria-label="Reservar ${esc(sala.nombre)} el ${DIAS[d.getDay()]} ${d.getDate()} a las ${hh}"><span>${hh}</span></button>`);
        }
        const bloques = reservas.filter((r) => r.fecha === f).map((r) => {
          const propio = modo === 'admin' || (!r.ajena && r.locatarioId === opts.locId);
          const nombre = modo === 'admin' && opts.nombreDe ? opts.nombreDe(r.locatarioId) : '';
          const h = Math.max(SLOT, top(r.hasta) - top(r.desde));
          const cls = r.ajena ? 'is-ajena' : propio && modo === 'miembro' ? 'is-propia' : '';
          const etiqueta = r.ajena ? 'Ocupado' : `${nombre ? `${esc(nombre)} · ` : ''}${esc(r.titulo || 'Reserva')}`;
          const accion = r.ajena ? '' : `data-action="reserva" data-id="${r.id}"`;
          return `<${r.ajena ? 'div' : 'button type="button"'} class="ag-res ag-${esc(sala.color || 'cyan')} ${cls}" ${accion} style="top:${top(r.desde)}px;height:${h - 2}px" title="${esc(`${r.desde} a ${r.hasta}${r.ajena ? ' · ocupado' : ` · ${nombre} ${r.titulo || ''}`}`)}">
            <strong>${r.desde}–${r.hasta}</strong><span>${etiqueta}</span>
          </${r.ajena ? 'div' : 'button'}>`;
        }).join('');
        const ahoraLinea = f === hoy && ahora.getHours() * 60 + ahora.getMinutes() > ap && ahora.getHours() * 60 + ahora.getMinutes() < ci
          ? `<i class="ag-now" style="top:${((ahora.getHours() * 60 + ahora.getMinutes() - ap) / paso) * SLOT}px"></i>` : '';
        return `<div class="ag-day${f === hoy ? ' is-today' : ''}">
          <div class="ag-head"><span>${DIAS[d.getDay()]}</span><strong>${d.getDate()}/${d.getMonth() + 1}</strong></div>
          <div class="ag-col" style="height:${alto}px">${slots.join('')}${bloques}${ahoraLinea}</div>
        </div>`;
      }).join('');

      const fin = dias[dias.length - 1];
      return `
        <div class="ag-bar">
          <div class="ag-salas" role="tablist" aria-label="Salas">
            ${salas.map((s) => `<button type="button" class="chip${s.id === sala.id ? ' is-on' : ''}" data-action="ag-sala" data-sala="${s.id}" role="tab" aria-selected="${s.id === sala.id}"><i class="ag-dot ag-${esc(s.color || 'cyan')}"></i>${esc(s.nombre)} <span class="muted small">· ${s.capacidad || '—'} p.</span></button>`).join('')}
          </div>
          <div class="period-nav" role="group" aria-label="Semana">
            <button type="button" class="btn btn-icon btn-sm btn-ghost" data-action="ag-prev" aria-label="Semana anterior">${PLX.icon('chevron-left', 'i-sm')}</button>
            <strong>${util.parseDate(dias[0]).getDate()}/${util.parseDate(dias[0]).getMonth() + 1} al ${util.parseDate(fin).getDate()}/${util.parseDate(fin).getMonth() + 1}</strong>
            <button type="button" class="btn btn-icon btn-sm btn-ghost" data-action="ag-next" aria-label="Semana siguiente">${PLX.icon('chevron-right', 'i-sm')}</button>
          </div>
          <button type="button" class="btn btn-xs btn-ghost" data-action="ag-hoy">Hoy</button>
        </div>
        <p class="small muted ag-info">${esc(sala.nombre)} · ${esc(sala.equipamiento || '')} · Horario ${cfg.apertura} a ${cfg.cierre} h · Tocá un horario libre para reservar.</p>
        <div class="ag-wrap">
          <div class="ag-grid" style="--n:${dias.length}">
            <div class="ag-hours"><div class="ag-head"></div><div class="ag-col" style="height:${alto}px">${horas.join('')}</div></div>
            ${columnas}
          </div>
        </div>`;
    },

    /** Opciones de hora de inicio y duración para el formulario de reserva. */
    opcionesHorario(db) {
      const cfg = reglas.reservas.config(db);
      const out = [];
      for (let m = reglas.util.minutos(cfg.apertura); m < reglas.util.minutos(cfg.cierre); m += cfg.paso) out.push(reglas.util.hhmm(m));
      const dur = [];
      for (let m = cfg.paso; m <= cfg.maxHoras * 60; m += cfg.paso) dur.push({ value: m, label: m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` });
      return { horas: out, duraciones: dur };
    },
    sumar(hhmm, minutos) {
      return reglas.util.hhmm(reglas.util.minutos(hhmm) + Number(minutos));
    }
  };

  PLX.agenda = agenda;
})(window);
