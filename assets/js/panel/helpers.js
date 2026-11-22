/* ==========================================================================
   PARALLAX · Ayudantes de dominio para las vistas del panel
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, domain } = PLX;

  PLX.views = PLX.views || {};
  PLX.forms = PLX.forms || {};

  const h = {
    loc(id) {
      return store.get('locatarios', id);
    },
    locName(id) {
      const l = store.get('locatarios', id);
      return l ? l.nombreComercial : '(sin locatario)';
    },
    locLegal(l) {
      return (l && (l.razonSocial || l.nombreComercial)) || '';
    },
    locOptions(pred = () => true) {
      return store
        .all('locatarios')
        .filter(pred)
        .slice()
        .sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || a.nombreComercial.localeCompare(b.nombreComercial))
        .map((l) => ({ value: l.id, label: l.nombreComercial + (l.razonSocial && l.razonSocial !== l.nombreComercial ? ` — ${l.razonSocial}` : '') }));
    },
    planName(id) {
      const p = store.get('planes', id);
      return p ? p.nombre : '—';
    },
    personaOptions(locId) {
      return store
        .where('personas', (p) => p.locatarioId === locId && p.habilitada)
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .map((p) => ({ value: p.id, label: `${p.nombre} · ${p.credencial}` }));
    },
    insumoGroups(includeInactive = false) {
      return domain.CATEGORIAS.map((c) => ({
        label: c.nombre,
        options: store
          .where('insumos', (i) => i.categoria === c.id && (includeInactive || i.activo))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
          .map((i) => ({ value: i.id, label: `${i.nombre} — ${util.money(i.precio)} / ${i.unidad}` }))
      })).filter((g) => g.options.length);
    },
    presentes() {
      return store.where('accesos', (a) => !a.egreso).sort((a, b) => a.ingreso.localeCompare(b.ingreso));
    },
    contratoActivo(locId) {
      const hoy = util.todayStr();
      return store
        .where('contratos', (c) => c.locatarioId === locId && c.estado === 'vigente' && c.fechaInicio <= hoy && (!c.fechaFin || c.fechaFin >= hoy))
        .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio))[0] || null;
    },

    /* ---------- Accesos ---------- */
    registrarIngreso(persona, cuando = new Date(), extra = {}) {
      const abierto = store.all('accesos').find((a) => a.personaId === persona.id && !a.egreso);
      if (abierto) return { ok: false, motivo: `${persona.nombre} ya tiene un ingreso abierto desde las ${util.fmtTime(abierto.ingreso)}.` };
      const rec = store.insert('accesos', Object.assign({
        personaId: persona.id,
        locatarioId: persona.locatarioId,
        nombre: persona.nombre,
        credencial: persona.credencial,
        ingreso: new Date(cuando).toISOString(),
        egreso: null,
        punto: 'Recepción',
        nota: ''
      }, extra), 'acc');
      return { ok: true, acceso: rec };
    },
    registrarEgreso(accesoId, cuando = new Date()) {
      const a = store.get('accesos', accesoId);
      if (!a || a.egreso) return { ok: false, motivo: 'El registro ya tiene egreso.' };
      const t = new Date(cuando);
      if (t < new Date(a.ingreso)) return { ok: false, motivo: 'El egreso no puede ser anterior al ingreso.' };
      store.update('accesos', accesoId, { egreso: t.toISOString() });
      return { ok: true, acceso: a };
    },
    /** Lector de credenciales: alterna ingreso / egreso según el estado actual. */
    alternarCredencial(codigo) {
      const c = String(codigo || '').trim().toUpperCase();
      if (!c) return { ok: false, motivo: 'Ingresá un número de credencial.' };
      const norm = c.startsWith('CR-') ? c : `CR-${c.replace(/^CR/i, '')}`;
      const persona = store.all('personas').find((p) => p.credencial.toUpperCase() === norm);
      if (!persona) return { ok: false, motivo: `No existe una persona autorizada con la credencial ${norm}.` };
      if (!persona.habilitada) return { ok: false, motivo: `La credencial ${norm} está inhabilitada.` };
      const abierto = store.all('accesos').find((a) => a.personaId === persona.id && !a.egreso);
      if (abierto) {
        h.registrarEgreso(abierto.id);
        return { ok: true, tipo: 'egreso', persona, acceso: abierto };
      }
      const r = h.registrarIngreso(persona);
      return Object.assign(r, { tipo: 'ingreso', persona });
    },

    contratoBadge(c) {
      const e = PLX.billing.estadoContrato(c);
      return PLX.ui.badge(e.nombre, e.tone, true);
    }
  };

  PLX.h = h;
})(window);
