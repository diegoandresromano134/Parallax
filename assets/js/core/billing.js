/* ==========================================================================
   PARALLAX · Motor de Resumen de Gastos y Facturación
   ---------------------------------------------------------------------------
   Consolida, por locatario y período (AAAA-MM):
     · Abonos de Membresía de los contratos de locación de servicios
       (con prorrateo por días cuando el contrato inicia o finaliza en el mes)
     · Consumos registrados (utilería, mobiliario, papelería, otros insumos
       y servicios adicionales)
     · Uso de instalaciones (ingresos registrados, permanencia) — informativo
   y genera las líneas listas para exportar a un programa contable.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util, domain } = PLX;

  const ORDEN_CAT = domain.CATEGORIAS.map((c) => c.id);

  /** Estado visible de un contrato (derivado de fechas). */
  function estadoContrato(c, hoy = util.todayStr()) {
    if (c.estado === 'suspendido') return { id: 'suspendido', nombre: 'Suspendido', tone: 'magenta' };
    if (c.estado === 'finalizado') return { id: 'finalizado', nombre: 'Finalizado', tone: 'neutral' };
    if (c.fechaInicio > hoy) return { id: 'proximo', nombre: 'Inicia ' + util.fmtDate(c.fechaInicio), tone: 'outline' };
    if (c.fechaFin && c.fechaFin < hoy) return { id: 'vencido', nombre: 'Vencido', tone: 'magenta' };
    if (c.fechaFin && util.diffDays(hoy, c.fechaFin) <= 45) return { id: 'por-vencer', nombre: 'Por vencer', tone: 'magenta' };
    return { id: 'vigente', nombre: 'Vigente', tone: 'cyan' };
  }

  /** Contratos que generan abono en el período. */
  function contratosDelPeriodo(db, locId, periodo) {
    const { start, end } = util.periodRange(periodo);
    return db.contratos.filter(
      (c) =>
        c.locatarioId === locId &&
        c.estado !== 'suspendido' &&
        c.fechaInicio <= end &&
        (!c.fechaFin || c.fechaFin >= start)
    );
  }

  function accesosDelPeriodo(db, locId, periodo) {
    const { start, end } = util.periodRange(periodo);
    return db.accesos.filter((a) => {
      if (locId && a.locatarioId !== locId) return false;
      const d = util.localDateOfIso(a.ingreso);
      return d >= start && d <= end;
    });
  }

  function consumosDelPeriodo(db, locId, periodo) {
    const { start, end } = util.periodRange(periodo);
    return db.consumos.filter((c) => (!locId || c.locatarioId === locId) && c.fecha >= start && c.fecha <= end);
  }

  /**
   * Calcula el resumen de gastos de un locatario para un período.
   * Devuelve un objeto serializable (se usa como «snapshot» al emitir).
   */
  function compute(db, locId, periodo) {
    const loc = db.locatarios.find((l) => l.id === locId);
    const cfg = db.config;
    const { start, end, days } = util.periodRange(periodo);
    const lineas = [];

    // 1) Abonos de membresía
    contratosDelPeriodo(db, locId, periodo).forEach((c) => {
      const plan = db.planes.find((p) => p.id === c.planId);
      const desde = c.fechaInicio > start ? c.fechaInicio : start;
      const hasta = c.fechaFin && c.fechaFin < end ? c.fechaFin : end;
      const dias = util.diffDays(desde, hasta) + 1;
      const completo = !cfg.prorrateo || dias >= days;
      const base = `Abono de Membresía · ${plan ? plan.nombre : 'Modalidad'}${c.puestos ? ` · ${c.puestos} ${c.puestos === 1 ? 'puesto' : 'puestos'}` : ''}`;
      if (completo) {
        lineas.push({
          tipo: 'abono',
          categoria: 'abono',
          categoriaNombre: 'Abono de Membresía',
          cuenta: cfg.cuentas.abonos,
          concepto: base,
          referencia: c.numero,
          detalle: `Contrato ${c.numero} · ${util.periodLabel(periodo)}`,
          cantidad: 1,
          unidad: 'mes',
          precioUnitario: util.round2(c.montoMensual),
          neto: util.round2(c.montoMensual)
        });
      } else {
        // Importe exacto prorrateado; se expresa como 1 período para que cantidad × precio = importe
        const neto = util.round2((c.montoMensual * dias) / days);
        lineas.push({
          tipo: 'abono',
          categoria: 'abono',
          categoriaNombre: 'Abono de Membresía',
          cuenta: cfg.cuentas.abonos,
          concepto: base,
          referencia: c.numero,
          detalle: `Contrato ${c.numero} · prorrateo ${dias}/${days} días (${util.fmtDate(desde)} al ${util.fmtDate(hasta)})`,
          cantidad: 1,
          unidad: 'mes prorrateado',
          precioUnitario: neto,
          neto
        });
      }
    });

    // 2) Consumos agrupados por insumo y precio unitario
    const consumos = consumosDelPeriodo(db, locId, periodo);
    const grupos = {};
    consumos.forEach((c) => {
      const ins = db.insumos.find((i) => i.id === c.insumoId) || {};
      const cat = ins.categoria || c.categoria || 'otros';
      const k = `${c.insumoId}|${c.precioUnitario}`;
      if (!grupos[k]) {
        grupos[k] = {
          tipo: 'consumo',
          categoria: cat,
          categoriaNombre: domain.catNombre(cat),
          cuenta: cfg.cuentas[cat] || '',
          concepto: ins.nombre || c.insumoNombre || 'Insumo',
          referencia: '',
          detalle: '',
          cantidad: 0,
          unidad: ins.unidad || c.unidad || 'unidad',
          precioUnitario: util.round2(c.precioUnitario),
          neto: 0,
          registros: 0
        };
      }
      grupos[k].cantidad += Number(c.cantidad) || 0;
      grupos[k].registros += 1;
    });
    Object.values(grupos)
      .map((g) => Object.assign(g, {
        cantidad: util.round2(g.cantidad),
        neto: util.round2(g.cantidad * g.precioUnitario),
        detalle: `${g.registros} ${g.registros === 1 ? 'registro' : 'registros'} en el período`
      }))
      .sort((a, b) => ORDEN_CAT.indexOf(a.categoria) - ORDEN_CAT.indexOf(b.categoria) || a.concepto.localeCompare(b.concepto))
      .forEach((g) => lineas.push(g));

    // 3) Uso de instalaciones (informativo)
    const accesos = accesosDelPeriodo(db, locId, periodo);
    const now = Date.now();
    const ms = util.sum(accesos, (a) => (a.egreso ? new Date(a.egreso) : now) - new Date(a.ingreso));
    const personas = new Set(accesos.map((a) => a.personaId || a.nombre)).size;

    // Totales
    const abonos = util.round2(util.sum(lineas.filter((l) => l.tipo === 'abono'), (l) => l.neto));
    const consumosTotal = util.round2(util.sum(lineas.filter((l) => l.tipo === 'consumo'), (l) => l.neto));
    const porCategoria = {};
    lineas.filter((l) => l.tipo === 'consumo').forEach((l) => {
      porCategoria[l.categoria] = util.round2((porCategoria[l.categoria] || 0) + l.neto);
    });
    const subtotal = util.round2(abonos + consumosTotal);
    const alicuota = Number(cfg.ivaAlicuota) || 0;
    const iva = util.round2((subtotal * alicuota) / 100);

    return {
      periodo,
      periodoLabel: util.periodLabel(periodo),
      desde: start,
      hasta: end,
      locatario: loc
        ? {
            id: loc.id,
            nombreComercial: loc.nombreComercial,
            razonSocial: loc.razonSocial,
            cuit: loc.cuit,
            condicionIva: loc.condicionIva,
            domicilio: loc.domicilio,
            email: loc.contacto && loc.contacto.email
          }
        : { id: locId, nombreComercial: '(locatario eliminado)', razonSocial: '' },
      prestador: Object.assign({}, cfg.prestador),
      contratos: contratosDelPeriodo(db, locId, periodo).map((c) => c.numero),
      lineas,
      uso: {
        ingresos: accesos.length,
        horas: util.round2(ms / 3600000),
        personas
      },
      totales: { abonos, consumos: consumosTotal, porCategoria, subtotal, alicuota, iva, total: util.round2(subtotal + iva) },
      calculadoEn: new Date().toISOString()
    };
  }

  /** Locatarios con movimiento (abono, consumos o accesos) en el período. */
  function locatariosDelPeriodo(db, periodo) {
    return db.locatarios.filter(
      (l) =>
        contratosDelPeriodo(db, l.id, periodo).length ||
        consumosDelPeriodo(db, l.id, periodo).length
    );
  }

  function computeAll(db, periodo) {
    return locatariosDelPeriodo(db, periodo).map((l) => compute(db, l.id, periodo));
  }

  function emitido(db, locId, periodo) {
    return db.resumenes.find((r) => r.locatarioId === locId && r.periodo === periodo && r.estado === 'emitido') || null;
  }

  /* ---------- Exportación contable ---------- */
  const CSV_HEADER = [
    'Período', 'Nº resumen', 'Fecha emisión', 'CUIT', 'Razón social', 'Nombre comercial', 'Condición IVA',
    'Cuenta contable', 'Tipo', 'Categoría', 'Concepto', 'Detalle', 'Cantidad', 'Unidad',
    'Precio unitario', 'Importe neto', 'Alícuota IVA %', 'IVA', 'Importe total'
  ];

  function csvRows(res, numero = '', fecha = '') {
    const ali = res.totales.alicuota;
    return res.lineas.map((l) => {
      const iva = util.round2((l.neto * ali) / 100);
      return [
        res.periodo, numero, fecha ? util.fmtDate(fecha) : '', util.fmtCuit(res.locatario.cuit) || '',
        res.locatario.razonSocial, res.locatario.nombreComercial, res.locatario.condicionIva || '',
        l.cuenta, l.tipo === 'abono' ? 'Abono' : 'Consumo', l.categoriaNombre, l.concepto, l.detalle,
        util.csvNum(l.cantidad), l.unidad, util.csvNum(l.precioUnitario), util.csvNum(l.neto),
        util.csvNum(ali), util.csvNum(iva), util.csvNum(l.neto + iva)
      ];
    });
  }

  function toCsv(list) {
    // list: [{ res, numero, fecha }]
    const rows = [CSV_HEADER];
    list.forEach(({ res, numero, fecha }) => rows.push(...csvRows(res, numero, fecha)));
    return util.toCsv(rows);
  }

  /** Estructura JSON orientada a integración con software contable. */
  function toJson(list) {
    return JSON.stringify(
      {
        formato: 'parallax.resumen-gastos.v1',
        generado: new Date().toISOString(),
        moneda: 'ARS',
        resumenes: list.map(({ res, numero, fecha }) => ({
          numero: numero || null,
          fechaEmision: fecha || null,
          periodo: res.periodo,
          prestador: res.prestador,
          locatario: res.locatario,
          contratos: res.contratos,
          lineas: res.lineas.map((l) => ({
            cuenta: l.cuenta,
            tipo: l.tipo,
            categoria: l.categoriaNombre,
            concepto: l.concepto,
            detalle: l.detalle,
            cantidad: l.cantidad,
            unidad: l.unidad,
            precioUnitario: l.precioUnitario,
            neto: l.neto
          })),
          usoInstalaciones: res.uso,
          totales: res.totales
        }))
      },
      null,
      2
    );
  }

  PLX.billing = {
    estadoContrato,
    contratosDelPeriodo,
    accesosDelPeriodo,
    consumosDelPeriodo,
    compute,
    computeAll,
    locatariosDelPeriodo,
    emitido,
    toCsv,
    toJson
  };
})(window);
