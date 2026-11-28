/* ==========================================================================
   PARALLAX · Ayudantes de dominio para las vistas del panel
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, domain } = PLX;

  PLX.views = PLX.views || {};
  PLX.forms = PLX.forms || {};

  /** Nombre comercial del prestador (marca blanca en el modo SaaS). */
  PLX.marca = () => ((store.config().prestador || {}).nombre || 'PARALLAX');
  /** Logo propio del prestador (Plan Ejecutivo) o el emblema por defecto. */
  PLX.logo = () => ((store.config().prestador || {}).logo || 'assets/img/favicon.svg');

  const h = {
    /* ---------- Legajos ---------- */
    loc(id) { return store.get('locatarios', id); },
    locName(id) {
      const l = store.get('locatarios', id);
      return l ? l.nombreComercial : '(legajo eliminado)';
    },
    titular(l) { return l ? [l.nombre, l.apellido].filter(Boolean).join(' ') : ''; },
    locOptions(pred = () => true) {
      return store.all('locatarios')
        .filter(pred)
        .slice()
        .sort((a, b) => String(a.numeroCliente || '').localeCompare(String(b.numeroCliente || '')))
        .map((l) => ({ value: l.id, label: `${l.numeroCliente ? `${l.numeroCliente} · ` : ''}${l.nombreComercial}` }));
    },
    datosPendientes(l) {
      const falta = [];
      if (!l.razonSocial) falta.push('razón social');
      if (!l.cuit) falta.push('CUIT');
      if (!l.nombre || !l.apellido) falta.push('titular');
      if (!l.documento && l.tipo === 'profesional') falta.push('documento');
      return falta;
    },
    planName(id) {
      const p = store.get('planes', id);
      return p ? p.nombre : '—';
    },
    contratoActivo(locId) {
      const hoy = util.todayStr();
      return store.where('contratos', (c) => c.locatarioId === locId && c.estado === 'vigente' && c.fechaInicio <= hoy && (!c.fechaFin || c.fechaFin >= hoy))
        .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio))[0] || null;
    },
    personaOptions(locId) {
      return store.where('personas', (p) => p.locatarioId === locId && p.habilitada)
        .sort((a, b) => (b.titular ? 1 : 0) - (a.titular ? 1 : 0) || a.nombre.localeCompare(b.nombre))
        .map((p) => ({ value: p.id, label: `${p.nombre} · ${p.credencial}${p.titular ? ' · titular' : ''}` }));
    },

    /* ---------- Inventario ---------- */
    insLabel(i) {
      if (!i) return 'Recurso eliminado';
      return i.codigo ? `${i.codigo} · ${i.nombre}` : i.nombre;
    },
    insumoGroups({ incluirInactivos = false, tipos = null, excluir = new Set() } = {}) {
      return domain.CATEGORIAS.map((c) => ({
        label: c.nombre,
        options: store.where('insumos', (i) => i.categoria === c.id && (incluirInactivos || i.activo) && (!tipos || tipos.includes(i.tipo)) && !excluir.has(i.id))
          .sort((a, b) => (a.codigo || a.nombre).localeCompare(b.codigo || b.nombre, 'es', { numeric: true }))
          .map((i) => ({ value: i.id, label: `${h.insLabel(i)} — ${util.money0(i.precio)} / ${i.unidad}` }))
      })).filter((g) => g.options.length);
    },
    /** Unidades asignadas por contratos vigentes: insumoId → contrato. */
    asignaciones() {
      const hoy = util.todayStr();
      const map = {};
      store.all('contratos').forEach((c) => {
        if (c.estado === 'finalizado' || (c.fechaFin && c.fechaFin < hoy)) return;
        (c.recursos || []).forEach((r) => {
          const i = store.get('insumos', r.insumoId);
          if (i && i.tipo === 'unidad') map[i.id] = c;
        });
      });
      return map;
    },
    /** Unidades en uso por un check-in abierto: insumoId → acceso. */
    enUso() {
      const map = {};
      store.all('accesos').forEach((a) => {
        if (a.egreso) return;
        if (a.espacioId) map[a.espacioId] = a;
        (a.items || []).forEach((it) => { if (it.devolver) map[it.insumoId] = a; });
      });
      return map;
    },
    /** Estado visible de una unidad del inventario. */
    estadoUnidad(i, asig = h.asignaciones(), uso = h.enUso()) {
      if (i.tipo !== 'unidad') return null;
      if (i.estado === 'mantenimiento') return { id: 'mantenimiento', nombre: 'En mantenimiento', tone: 'magenta' };
      if (uso[i.id]) return { id: 'en-uso', nombre: `En uso · ${uso[i.id].numeroCliente || ''}`.trim(), tone: 'cyan', acceso: uso[i.id] };
      if (asig[i.id]) {
        const l = store.get('locatarios', asig[i.id].locatarioId);
        return { id: 'asignada', nombre: `Asignada · ${l ? l.numeroCliente : ''}`, tone: 'grad', contrato: asig[i.id] };
      }
      return { id: 'disponible', nombre: 'Disponible', tone: 'outline' };
    },

    /* ---------- Check-in / check-out ---------- */
    presentes() {
      return store.where('accesos', (a) => !a.egreso).sort((a, b) => a.ingreso.localeCompare(b.ingreso));
    },
    /**
     * Registra un check-in.
     * datos: { locatarioId, personaId | null, nombre?, cuando, espacioId?, items: [{ insumoId, cantidad }], punto, nota }
     * Crea consumos por lo solicitado (los incluidos en el abono se descuentan al facturar).
     */
    checkin(datos) {
      const loc = store.get('locatarios', datos.locatarioId);
      if (!loc) return { ok: false, motivo: 'Seleccioná un cliente.' };
      const persona = datos.personaId ? store.get('personas', datos.personaId) : null;
      if (persona) {
        const abierto = store.all('accesos').find((a) => a.personaId === persona.id && !a.egreso);
        if (abierto) return { ok: false, motivo: `${persona.nombre} ya tiene un check-in abierto desde las ${util.fmtTime(abierto.ingreso)}.` };
      }
      const uso = h.enUso();
      const ocupado = [datos.espacioId, ...(datos.items || []).map((i) => i.insumoId)]
        .filter(Boolean)
        .map((id) => store.get('insumos', id))
        .find((i) => i && i.tipo === 'unidad' && uso[i.id]);
      if (ocupado) return { ok: false, motivo: `${h.insLabel(ocupado)} está en uso por ${uso[ocupado.id].nombre}.` };

      const cuando = new Date(datos.cuando || Date.now());
      const contrato = h.contratoActivo(loc.id);
      // Solo las unidades asignadas por contrato no generan consumo; los consumibles y horas
      // incluidos sí se registran y la facturación descuenta lo incluido (excedentes).
      const asignadas = new Set((contrato && contrato.recursos || [])
        .filter((r) => (store.get('insumos', r.insumoId) || {}).tipo === 'unidad')
        .map((r) => r.insumoId));
      const items = (datos.items || []).filter((x) => x.insumoId && Number(x.cantidad) > 0).map((x) => {
        const i = store.get('insumos', x.insumoId);
        return { insumoId: i.id, cantidad: Number(x.cantidad), devolver: i.tipo === 'unidad', devolucion: null };
      });
      const acc = store.insert('accesos', {
        locatarioId: loc.id,
        numeroCliente: loc.numeroCliente || '',
        personaId: persona ? persona.id : null,
        nombre: persona ? persona.nombre : (datos.nombre || h.titular(loc) || loc.nombreComercial),
        credencial: persona ? persona.credencial : '',
        ingreso: cuando.toISOString(),
        egreso: null,
        espacioId: datos.espacioId || null,
        items,
        estado: 'abierto',
        observaciones: '',
        punto: datos.punto || 'Recepción',
        nota: datos.nota || ''
      }, 'acc');

      const fecha = util.todayStr(cuando);
      const nota = `Check-in ${util.fmtTime(acc.ingreso)} · ${acc.nombre}`;
      // Lo solicitado genera consumos (salvo unidades asignadas por contrato)
      items.forEach((it) => {
        if (asignadas.has(it.insumoId)) return;
        const i = store.get('insumos', it.insumoId);
        store.insert('consumos', { locatarioId: loc.id, insumoId: i.id, cantidad: it.cantidad, precioUnitario: i.precio, fecha, nota, accesoId: acc.id }, 'cns');
        if (i.tipo === 'consumible' && typeof i.stock === 'number') store.update('insumos', i.id, { stock: Math.max(0, i.stock - it.cantidad) });
      });
      // Clientes sin contrato vigente: el espacio se cobra según el inventario (pase diario)
      if (datos.espacioId && !contrato) {
        const e = store.get('insumos', datos.espacioId);
        if (e) store.insert('consumos', { locatarioId: loc.id, insumoId: e.id, cantidad: 1, precioUnitario: e.precio, fecha, nota: `${nota} · sin contrato vigente`, accesoId: acc.id }, 'cns');
      }
      return { ok: true, acceso: acc };
    },
    /**
     * Registra el check-out con la verificación de devolución.
     * devoluciones: { [insumoId]: { estado: 'ok'|'faltante'|'danado', nota } }
     * cargo: { monto, detalle } opcional → consumo por reposición.
     */
    checkout(accesoId, { cuando = new Date(), devoluciones = {}, observaciones = '', cargo = null } = {}) {
      const a = store.get('accesos', accesoId);
      if (!a || a.egreso) return { ok: false, motivo: 'El check-in ya está cerrado.' };
      const t = new Date(cuando);
      if (t < new Date(a.ingreso)) return { ok: false, motivo: 'La salida no puede ser anterior al ingreso.' };
      const items = (a.items || []).map((it) => (it.devolver ? Object.assign({}, it, { devolucion: devoluciones[it.insumoId] || { estado: 'ok', nota: '' } }) : it));
      const observado = items.some((it) => it.devolver && it.devolucion.estado !== 'ok');
      store.update('accesos', a.id, { egreso: t.toISOString(), items, estado: observado ? 'observado' : 'completo', observaciones });
      if (cargo && Number(cargo.monto) > 0) {
        let cargoIns = store.all('insumos').find((i) => i.id === 'ins_reposicion');
        if (!cargoIns) cargoIns = store.insert('insumos', { id: 'ins_reposicion', categoria: 'servicios', tipo: 'consumible', nombre: 'Cargo por reposición o daño', unidad: 'cargo', precio: 0, codigo: '', ubicacion: '', estado: 'disponible', activo: true, descripcion: 'Generado desde el check-out.' });
        store.insert('consumos', { locatarioId: a.locatarioId, insumoId: cargoIns.id, cantidad: 1, precioUnitario: util.round2(Number(cargo.monto)), fecha: util.todayStr(t), nota: cargo.detalle || 'Reposición registrada en el check-out', accesoId: a.id }, 'cns');
      }
      return { ok: true, acceso: store.get('accesos', a.id), observado };
    },
    estadoAcceso(a) {
      if (!a.egreso) return { nombre: 'En el espacio', tone: 'cyan' };
      if (a.estado === 'observado') return { nombre: 'Con observaciones', tone: 'magenta' };
      return { nombre: 'Completo', tone: 'outline' };
    },
    buscarCredencial(codigo) {
      const c = String(codigo || '').trim().toUpperCase();
      if (!c) return null;
      const cand = c.startsWith('CR-') || c.startsWith('CL-') ? c : `CR-${c.replace(/^CR/i, '')}`;
      const persona = store.all('personas').find((p) => p.credencial.toUpperCase() === cand);
      if (persona) return { persona, loc: store.get('locatarios', persona.locatarioId) };
      const loc = store.all('locatarios').find((l) => String(l.numeroCliente || '').toUpperCase() === c);
      if (loc) return { persona: store.all('personas').find((p) => p.locatarioId === loc.id && p.titular) || null, loc };
      return null;
    },

    contratoBadge(c) {
      const e = PLX.billing.estadoContrato(c);
      return PLX.ui.badge(e.nombre, e.tone, true);
    }
  };

  PLX.h = h;
})(window);
