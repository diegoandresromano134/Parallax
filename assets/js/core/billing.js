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

    // 2) Recursos del contrato: unidades asignadas y cantidades incluidas en el abono
    const contratosP = contratosDelPeriodo(db, locId, periodo);
    const incluido = {};
    const asignadas = new Set();
    const asignados = [];
    contratosP.forEach((c) => (c.recursos || []).forEach((r) => {
      const ins = db.insumos.find((i) => i.id === r.insumoId);
      if (!ins) return;
      if (ins.tipo === 'unidad') {
        asignadas.add(ins.id);
        asignados.push({ codigo: ins.codigo || '', nombre: ins.nombre, categoria: domain.catNombre(ins.categoria), contrato: c.numero });
      } else {
        incluido[ins.id] = (incluido[ins.id] || 0) + (Number(r.cantidad) || 0);
      }
    }));

    // 3) Consumos: primero se descuenta lo incluido en el abono; se factura el excedente
    const restante = Object.assign({}, incluido);
    const cubiertoPor = {};
    const grupos = {};
    consumosDelPeriodo(db, locId, periodo)
      .slice()
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.creadoEn || '').localeCompare(String(b.creadoEn || '')))
      .forEach((c) => {
        const ins = db.insumos.find((i) => i.id === c.insumoId) || {};
        const q = Number(c.cantidad) || 0;
        let cubierto = 0;
        if (asignadas.has(c.insumoId)) cubierto = q;
        else if (restante[c.insumoId] > 0) {
          cubierto = Math.min(q, restante[c.insumoId]);
          restante[c.insumoId] = util.round2(restante[c.insumoId] - cubierto);
        }
        if (cubierto) cubiertoPor[c.insumoId] = util.round2((cubiertoPor[c.insumoId] || 0) + cubierto);
        const cat = ins.categoria || c.categoria || 'otros';
        const k = `${c.insumoId}|${c.precioUnitario}`;
        if (!grupos[k]) {
          grupos[k] = {
            tipo: 'consumo',
            insumoId: c.insumoId,
            categoria: cat,
            categoriaNombre: domain.catNombre(cat),
            cuenta: cfg.cuentas[cat] || '',
            concepto: (ins.nombre || c.insumoNombre || 'Recurso') + (ins.codigo ? ` · ${ins.codigo}` : ''),
            referencia: ins.codigo || '',
            detalle: '',
            consumido: 0,
            cubierto: 0,
            cantidad: 0,
            unidad: ins.unidad || c.unidad || 'unidad',
            precioUnitario: util.round2(c.precioUnitario),
            neto: 0,
            registros: 0
          };
        }
        const g = grupos[k];
        g.consumido += q;
        g.cubierto += cubierto;
        g.cantidad += q - cubierto;
        g.registros += 1;
      });
    Object.values(grupos)
      .filter((g) => g.cantidad > 0)
      .map((g) => Object.assign(g, {
        consumido: util.round2(g.consumido),
        cubierto: util.round2(g.cubierto),
        cantidad: util.round2(g.cantidad),
        neto: util.round2(g.cantidad * g.precioUnitario),
        detalle: g.cubierto > 0
          ? `Excedente: consumido ${util.num(g.consumido)} · incluido en el abono ${util.num(g.cubierto)}`
          : `${g.registros} ${g.registros === 1 ? 'registro' : 'registros'} en el período`
      }))
      .sort((a, b) => ORDEN_CAT.indexOf(a.categoria) - ORDEN_CAT.indexOf(b.categoria) || a.concepto.localeCompare(b.concepto))
      .forEach((g) => lineas.push(g));

    // Uso de lo incluido en el abono (informativo, sin cargo)
    const incluidos = Object.keys(incluido).map((id) => {
      const ins = db.insumos.find((i) => i.id === id) || {};
      return { insumoId: id, concepto: ins.nombre || 'Recurso', unidad: ins.unidad || '', incluido: incluido[id], usado: cubiertoPor[id] || 0 };
    });

    // 4) Uso de instalaciones (informativo)
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
            numeroCliente: loc.numeroCliente || '',
            nombreComercial: loc.nombreComercial,
            razonSocial: loc.razonSocial,
            cuit: loc.cuit,
            condicionIva: loc.condicionIva,
            domicilio: loc.domicilio,
            email: loc.email || (loc.contacto && loc.contacto.email) || ''
          }
        : { id: locId, nombreComercial: '(locatario eliminado)', razonSocial: '' },
      prestador: Object.assign({}, cfg.prestador),
      contratos: contratosP.map((c) => c.numero),
      lineas,
      asignados,
      incluidos,
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
    'Período', 'Nº resumen', 'Fecha emisión', 'N° cliente', 'CUIT', 'Razón social', 'Nombre comercial', 'Condición IVA',
    'Cuenta contable', 'Tipo', 'Categoría', 'Concepto', 'Detalle', 'Cantidad', 'Unidad',
    'Precio unitario', 'Importe neto', 'Alícuota IVA %', 'IVA', 'Importe total'
  ];

  function csvRows(res, numero = '', fecha = '') {
    const ali = res.totales.alicuota;
    return res.lineas.map((l) => {
      const iva = util.round2((l.neto * ali) / 100);
      return [
        res.periodo, numero, fecha ? util.fmtDate(fecha) : '', res.locatario.numeroCliente || '', util.fmtCuit(res.locatario.cuit) || '',
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
          recursosAsignados: res.asignados || [],
          incluidosEnAbono: res.incluidos || [],
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
