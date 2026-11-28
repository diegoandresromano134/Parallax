/* ==========================================================================
   PARALLAX · Alcance de datos por miembro
   ---------------------------------------------------------------------------
   Devuelve solo la información que un miembro puede ver de sí mismo: su
   legajo, contratos, personas autorizadas, check-ins, consumos, resúmenes
   emitidos, documentos y solicitudes. La usan el servidor (Node) y el modo
   demostración del navegador, para que ambos filtren exactamente igual.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.PLX = root.PLX || {};
    root.PLX.scope = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRIVADOS_LEGAJO = ['notas'];

  function miembro(db, locId) {
    const list = (c) => (Array.isArray(db[c]) ? db[c] : []);
    const loc = list('locatarios').find((l) => l.id === locId) || null;
    const propio = (x) => x.locatarioId === locId;

    const contratos = list('contratos').filter(propio);
    const consumos = list('consumos').filter(propio);
    const accesos = list('accesos').filter(propio);

    const usados = new Set();
    contratos.forEach((c) => (c.recursos || []).forEach((r) => usados.add(r.insumoId)));
    consumos.forEach((c) => usados.add(c.insumoId));
    accesos.forEach((a) => {
      (a.items || []).forEach((i) => usados.add(i.insumoId));
      if (a.espacioId) usados.add(a.espacioId);
    });

    const legajo = loc ? Object.assign({}, loc) : null;
    if (legajo) PRIVADOS_LEGAJO.forEach((k) => delete legajo[k]);

    const cfg = db.config || {};
    return {
      version: db.version,
      meta: { alcance: 'miembro', locatarioId: locId, rev: (db.meta && db.meta.rev) || 0 },
      config: {
        prestador: cfg.prestador,
        ivaAlicuota: cfg.ivaAlicuota,
        prorrateo: cfg.prorrateo,
        cuentas: cfg.cuentas,
        cobros: cfg.cobros,
        reservas: cfg.reservas
      },
      locatarios: legajo ? [legajo] : [],
      planes: list('planes'),
      contratos,
      personas: list('personas').filter(propio),
      accesos,
      insumos: list('insumos').filter((i) => i.activo || usados.has(i.id)),
      consumos,
      consultas: list('consultas').filter((c) => c.origen === 'miembro' && propio(c)),
      resumenes: list('resumenes').filter((r) => propio(r) && r.estado === 'emitido'),
      documentos: list('documentos').filter((d) => propio(d) && d.visibleMiembro !== false),
      salas: list('salas').filter((x) => x.activa !== false),
      // Reservas propias completas; las de otros clientes solo como «ocupado»
      reservas: list('reservas').filter((r) => r.estado !== 'cancelada' || propio(r)).map((r) => (propio(r) ? r : { id: r.id, salaId: r.salaId, fecha: r.fecha, desde: r.desde, hasta: r.hasta, estado: r.estado, ajena: true })),
      pagos: list('pagos').filter(propio),
      facturas: list('facturas').filter(propio)
    };
  }

  return { miembro };
});
