/* ==========================================================================
   PARALLAX · Reglas de negocio compartidas (navegador y servidor)
   ---------------------------------------------------------------------------
   · sha256          Huella SHA-256 (hexadecimal) de textos o bytes.
   · firma           Texto del contrato, envío a firma, firma del cliente y del
                     prestador, registro de eventos encadenado y verificación.
   · reservas        Validación y alta de reservas de salas, cancelaciones.
   · cuenta          Cuenta corriente: vencimientos, pagos, intereses por mora.
   El servidor (server/server.js) usa exactamente las mismas funciones.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.PLX = root.PLX || {};
    root.PLX.reglas = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ======================================================================
     SHA-256 (FIPS 180-4)
     ====================================================================== */
  const K = new Uint32Array(64);
  const H0 = new Uint32Array(8);
  (function constantes() {
    const primos = [];
    for (let n = 2; primos.length < 64; n++) {
      if (primos.every((p) => n % p)) primos.push(n);
    }
    const frac = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    primos.forEach((p, i) => {
      K[i] = frac(Math.cbrt(p));
      if (i < 8) H0[i] = frac(Math.sqrt(p));
    });
  })();
  const ror = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(input) {
    const bytes = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array ? input : new Uint8Array(input);
    const l = bytes.length;
    const total = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    const bits = l * 8;
    dv.setUint32(total - 4, bits >>> 0);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    const h = Uint32Array.from(H0);
    const w = new Uint32Array(64);
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let t = 0; t < 64; t++) {
        const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
  }

  /* ======================================================================
     Utilidades de fecha y formato (independientes del navegador)
     ====================================================================== */
  const pad = (n) => String(n).padStart(2, '0');
  const hoyStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dUTC = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const diffDias = (a, b) => Math.round((dUTC(b) - dUTC(a)) / 86400000);
  const fmtFecha = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  let fmtM = null;
  const dinero = (n) => {
    if (!fmtM) fmtM = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
    return fmtM.format(r2(n || 0));
  };
  const canon = (o) => JSON.stringify(Object.keys(o).filter((k) => k !== 'hash').sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {}));

  /* ======================================================================
     FIRMA DE CONTRATOS
     ====================================================================== */
  const ESTADOS_FIRMA = {
    'sin-enviar': { nombre: 'Sin enviar a firma', tono: 'outline' },
    enviado: { nombre: 'Pendiente de firma del cliente', tono: 'magenta' },
    'firmado-cliente': { nombre: 'Firmado por el cliente', tono: 'cyan' },
    completo: { nombre: 'Firmado por ambas partes', tono: 'grad' },
    anulado: { nombre: 'Envío anulado', tono: 'outline' }
  };
  const ORD = ['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA', 'NOVENA', 'DÉCIMA', 'UNDÉCIMA', 'DUODÉCIMA'];

  function estadoFirma(c) {
    const f = c && c.firma;
    if (!f) return 'sin-enviar';
    if (f.anulado) return 'anulado';
    if (f.cliente && f.prestador) return 'completo';
    if (f.cliente) return 'firmado-cliente';
    return 'enviado';
  }

  /** Texto completo del contrato a partir de los datos cargados. */
  function textoContrato(db, c) {
    const L = (db.locatarios || []).find((x) => x.id === c.locatarioId) || {};
    const cfg = db.config || {};
    const P = cfg.prestador || {};
    const cob = cfg.cobros || {};
    const plan = (db.planes || []).find((p) => p.id === c.planId) || {};
    const ins = (id) => (db.insumos || []).find((i) => i.id === id);
    const completar = '[a completar]';
    const titular = [L.nombre, L.apellido].filter(Boolean).join(' ');
    const recursos = (c.recursos || []).map((r) => ({ r, i: ins(r.insumoId) })).filter((x) => x.i);
    const unidades = recursos.filter((x) => x.i.tipo === 'unidad').map((x) => `${x.i.nombre}${x.i.codigo ? ` (${x.i.codigo})` : ''}`);
    const incluidos = recursos.filter((x) => x.i.tipo !== 'unidad').map((x) => `${x.r.cantidad} ${x.i.unidad}${Number(x.r.cantidad) === 1 ? '' : 's'} de ${x.i.nombre}`);
    const medios = (cob.mediosPago || []).filter((m) => m.activo !== false).map((m) => m.nombre);
    let n = 0;
    const cl = (titulo, cuerpo) => `${ORD[n++]}. ${titulo}. ${cuerpo}`;

    const NOM = P.nombre || P.razonSocial || 'PARALLAX';
    const partes = [
      'CONTRATO DE LOCACIÓN DE SERVICIOS · ABONO DE MEMBRESÍA',
      `Contrato N° ${c.numero}`,
      '',
      'En la Ciudad Autónoma de Buenos Aires, entre:',
      `EL PRESTADOR: ${P.razonSocial || P.nombre || 'PARALLAX'}, CUIT ${P.cuit || completar}, con domicilio en ${P.domicilio || completar}, en adelante «${NOM}»;`,
      `y EL CLIENTE: ${L.razonSocial || L.nombreComercial || completar}${L.cuit ? `, CUIT ${L.cuit}` : ''}${L.tipo !== 'empresa' && L.documento ? `, DNI ${L.documento}` : ''}, con domicilio en ${L.domicilio || completar}${L.tipo === 'empresa' && titular ? `, representado por ${titular}${L.documento ? ` (DNI ${L.documento})` : ''}` : ''}, N° de cliente ${L.numeroCliente || completar}, en adelante «EL CLIENTE»;`,
      'convienen celebrar el presente contrato de locación de servicios, que se regirá por las siguientes cláusulas:',
      '',
      cl('OBJETO', `${NOM} presta a EL CLIENTE servicios de infraestructura y servicios compartidos en su espacio de coworking, en la modalidad «${plan.nombre || completar}» para ${c.puestos || 1} ${Number(c.puestos) === 1 ? 'puesto' : 'puestos'}.`),
      cl('RECURSOS Y SERVICIOS INCLUIDOS', [
        unidades.length ? `Recursos asignados durante la vigencia: ${unidades.join(', ')}.` : 'No se asignan recursos de uso exclusivo.',
        incluidos.length ? `Cantidades mensuales incluidas en el abono: ${incluidos.join('; ')}.` : '',
        (c.servicios || []).length ? `Servicios incluidos: ${c.servicios.join(', ')}.` : ''
      ].filter(Boolean).join(' ')),
      cl('PLAZO', `El contrato rige desde el ${fmtFecha(c.fechaInicio)}${c.fechaFin ? ` hasta el ${fmtFecha(c.fechaFin)}` : ' por plazo indeterminado'}. Cualquiera de las partes puede rescindirlo con un preaviso escrito de treinta (30) días.`),
      cl('PRECIO', `EL CLIENTE abonará un Abono de Membresía mensual de ${dinero(c.montoMensual)} más IVA. Actualización: ${c.ajuste || 'según acuerdo de partes'}. Los consumos, préstamos de equipos y usos que excedan lo incluido se facturarán según las tarifas vigentes de ${NOM}, informadas en el Área de Miembros.`),
      cl('PAGO, VENCIMIENTO Y MORA', `El abono y los consumos de cada mes se facturan por mes vencido y vencen el día ${c.diaVencimiento || cob.diaVencimiento || 10} del mes siguiente. Medios de pago aceptados: ${medios.length ? medios.join(', ') : completar}. La mora se produce de pleno derecho por el solo vencimiento del plazo (art. 886 del Código Civil y Comercial). Las sumas impagas devengarán un interés punitorio del ${cob.tasaMensual != null ? cob.tasaMensual : completar}% mensual, calculado por día de atraso${cob.recargoFijo ? `, más un recargo administrativo de ${dinero(cob.recargoFijo)}` : ''}. Con más de ${cob.suspenderDias || 30} días de mora, ${NOM} podrá suspender la prestación de los servicios previa notificación.`),
      cl('NATURALEZA DEL VÍNCULO', `La relación entre las partes es estrictamente comercial y se celebra entre partes independientes, cada una con su propia organización, riesgo y responsabilidad. Las personas que EL CLIENTE autorice a ingresar actúan bajo la exclusiva organización y responsabilidad de EL CLIENTE, sin vínculo alguno con ${NOM}.`),
      cl('USO DE LAS INSTALACIONES', 'EL CLIENTE se obliga a usar las instalaciones y los recursos conforme a su destino y al reglamento del espacio, y a devolver en el mismo estado los equipos prestados. Los faltantes o daños se cargarán a su cuenta por su valor de reposición.'),
      cl('DATOS PERSONALES', 'Los datos personales se tratan conforme a la Ley 25.326 de Protección de los Datos Personales, solo para administrar este contrato. Sus titulares pueden ejercer los derechos de acceso, rectificación y supresión.'),
      cl('DOCUMENTO Y FIRMA ELECTRÓNICA', `Las partes acuerdan celebrar este contrato por medios electrónicos y reconocen la validez del documento electrónico y de la firma electrónica utilizada (Ley 25.506 y arts. 286, 288 y 319 del Código Civil y Comercial). La integridad del texto se acredita mediante su huella SHA-256 y el registro de eventos de firma conservado por ${NOM}. Las partes podrán, además, suscribirlo con firma digital emitida por un certificador licenciado.`),
      cl('DOMICILIOS Y JURISDICCIÓN', 'Las partes constituyen domicilio en los indicados y aceptan como válidas las notificaciones a los correos electrónicos registrados. Para cualquier controversia se someten a los tribunales ordinarios en lo comercial de la Ciudad Autónoma de Buenos Aires.'),
      '',
      `Versión del documento generada el ${fmtFecha((c._fechaDocumento || hoyStr()).slice(0, 10))}.`
    ];
    return partes.join('\n');
  }

  function nuevoEvento(eventos, tipo, datos) {
    const prev = eventos.length ? eventos[eventos.length - 1].hash : 'INICIO';
    const ev = Object.assign({ tipo }, datos);
    ev.hash = sha256(`${prev}|${canon(ev)}`);
    return eventos.concat([ev]);
  }

  /** Genera la versión del documento y la deja pendiente de firma del cliente. */
  function enviar(db, c, { fecha, actor }) {
    const texto = textoContrato(db, Object.assign({}, c, { _fechaDocumento: fecha }));
    const hash = sha256(texto);
    const version = ((c.firma && c.firma.version) || 0) + 1;
    let eventos = nuevoEvento([], 'documento-generado', { fecha, actor, docHash: hash, version });
    eventos = nuevoEvento(eventos, 'enviado-a-firma', { fecha, actor });
    return { version, documento: { texto, hash, generadoEn: fecha }, codigo: hash.slice(0, 12).toUpperCase(), eventos, cliente: null, prestador: null, digital: null, anulado: false };
  }

  function exigir(f) {
    if (!f || f.anulado) throw new Error('El contrato no tiene un envío a firma activo.');
    if (sha256(f.documento.texto) !== f.documento.hash) throw new Error('El documento fue alterado: no coincide con su huella SHA-256.');
  }

  function registrarVista(c, { fecha, actor, ip, ua }) {
    const f = c.firma;
    if (!f || f.eventos.some((e) => e.tipo === 'visto-por-cliente')) return f;
    return Object.assign({}, f, { eventos: nuevoEvento(f.eventos, 'visto-por-cliente', { fecha, actor, ip: ip || null, ua: ua || null }) });
  }

  function firmarCliente(c, { nombre, dni, imagen }, { fecha, actor, ip, ua }) {
    const f = c.firma;
    exigir(f);
    if (f.cliente) throw new Error('El contrato ya fue firmado por el cliente.');
    if (String(nombre || '').trim().length < 3) throw new Error('Escribí tu nombre y apellido completos.');
    if (String(dni || '').replace(/\D/g, '').length < 7) throw new Error('Ingresá tu número de documento.');
    const imagenHash = imagen ? sha256(imagen) : null;
    const cliente = {
      nombre: String(nombre).trim(), dni: String(dni).replace(/\D/g, ''), fecha, actor, ip: ip || null, ua: ua || null,
      metodo: 'Firma electrónica: usuario y contraseña del Área de Miembros, reingreso de contraseña, firma manuscrita digitalizada y aceptación expresa',
      imagen: imagen || null, imagenHash
    };
    const eventos = nuevoEvento(f.eventos, 'firmado-por-cliente', { fecha, actor, nombre: cliente.nombre, dni: cliente.dni, ip: cliente.ip, ua: cliente.ua, docHash: f.documento.hash, imagenHash });
    return Object.assign({}, f, { cliente, eventos });
  }

  function firmarPrestador(c, { nombre, fecha, actor }) {
    const f = c.firma;
    exigir(f);
    if (f.prestador) throw new Error('El prestador ya firmó este contrato.');
    const prestador = { nombre, fecha, actor };
    const eventos = nuevoEvento(f.eventos, 'firmado-por-prestador', { fecha, actor, nombre, docHash: f.documento.hash });
    return Object.assign({}, f, { prestador, eventos });
  }

  function anular(c, { fecha, actor, motivo }) {
    const f = c.firma;
    if (!f) return f;
    return Object.assign({}, f, { anulado: true, eventos: nuevoEvento(f.eventos, 'envio-anulado', { fecha, actor, motivo: motivo || '' }) });
  }

  function adjuntarDigital(c, { documentoId, nombre, hash, fecha, actor }) {
    const f = c.firma || { version: 0, eventos: [], documento: null, codigo: null };
    const digital = { documentoId, nombre, hash, fecha, actor };
    return Object.assign({}, f, { digital, eventos: nuevoEvento(f.eventos || [], 'pdf-con-firma-digital', { fecha, actor, nombre, archivoHash: hash }) });
  }

  /** Verifica documento, cadena de eventos e imagen de la firma. */
  function verificar(c) {
    const f = c.firma;
    if (!f) return null;
    const documento = f.documento ? sha256(f.documento.texto) === f.documento.hash : null;
    let prev = 'INICIO';
    let cadena = true;
    (f.eventos || []).forEach((ev) => {
      if (sha256(`${prev}|${canon(ev)}`) !== ev.hash) cadena = false;
      prev = ev.hash;
    });
    const imagen = f.cliente && f.cliente.imagen ? sha256(f.cliente.imagen) === f.cliente.imagenHash : null;
    return { documento, cadena, imagen, ok: documento !== false && cadena && imagen !== false };
  }

  /** ¿Cambió el contrato después de enviarse a firma? */
  function desactualizado(db, c) {
    const f = c.firma;
    if (!f || !f.documento || f.anulado) return false;
    const fecha = f.documento.generadoEn;
    return sha256(textoContrato(db, Object.assign({}, c, { _fechaDocumento: fecha }))) !== f.documento.hash;
  }

  /* ======================================================================
     RESERVAS DE SALAS
     ====================================================================== */
  const RES_DEF = { apertura: '08:00', cierre: '20:00', paso: 30, maxHoras: 4, cancelacionHoras: 24, dias: [1, 2, 3, 4, 5, 6] };
  const cfgReservas = (db) => Object.assign({}, RES_DEF, ((db.config || {}).reservas) || {});
  const minutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const horasReserva = (r) => (minutos(r.hasta) - minutos(r.desde)) / 60;
  const solapa = (a, b) => a.salaId === b.salaId && a.fecha === b.fecha && minutos(a.desde) < minutos(b.hasta) && minutos(b.desde) < minutos(a.hasta);

  function validarReserva(db, d, ahora = new Date()) {
    const sala = (db.salas || []).find((s) => s.id === d.salaId && s.activa !== false);
    if (!sala) return 'Elegí una sala disponible.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') || !/^\d{2}:\d{2}$/.test(d.desde || '') || !/^\d{2}:\d{2}$/.test(d.hasta || '')) return 'Fecha u horario inválidos.';
    if (!d.locatarioId || !(db.locatarios || []).some((l) => l.id === d.locatarioId)) return 'Indicá para qué cliente es la reserva.';
    const c = cfgReservas(db);
    const a = minutos(d.desde), b = minutos(d.hasta);
    if (b <= a) return 'El horario de fin debe ser posterior al de inicio.';
    if (a < minutos(c.apertura) || b > minutos(c.cierre)) return `Las salas se reservan entre las ${c.apertura} y las ${c.cierre} h.`;
    if (a % c.paso || b % c.paso) return `Los horarios van en bloques de ${c.paso} minutos.`;
    if ((b - a) / 60 > c.maxHoras) return `Cada reserva puede durar hasta ${c.maxHoras} horas.`;
    const dow = new Date(`${d.fecha}T12:00:00`).getDay();
    if (!c.dias.includes(dow)) return 'Ese día las salas no se reservan.';
    if (new Date(`${d.fecha}T${d.desde}:00`) < ahora) return 'No se puede reservar en un horario que ya pasó.';
    const choque = (db.reservas || []).find((r) => r.estado !== 'cancelada' && r.id !== d.id && solapa(r, d));
    if (choque) return `${sala.nombre} ya está reservada de ${choque.desde} a ${choque.hasta}.`;
    return null;
  }

  /** Arma la reserva y el consumo que se cobra (lo incluido en el abono se descuenta al facturar). */
  function armarReserva(db, d, { id, consumoId, fecha, origen }) {
    const sala = (db.salas || []).find((s) => s.id === d.salaId);
    const ins = (db.insumos || []).find((i) => i.id === sala.insumoId);
    const h = horasReserva(d);
    const cantidad = !ins ? 0 : ins.unidad === 'hora' ? h : ins.unidad === 'bloque' ? Math.ceil(h / 4) : 1;
    const reserva = {
      id, salaId: sala.id, locatarioId: d.locatarioId, fecha: d.fecha, desde: d.desde, hasta: d.hasta,
      titulo: String(d.titulo || '').slice(0, 120), personas: Number(d.personas) || null, estado: 'confirmada',
      origen: origen || 'administracion', creadoEn: fecha, consumoId: ins ? consumoId : null
    };
    const consumo = ins ? {
      id: consumoId, locatarioId: d.locatarioId, insumoId: ins.id, cantidad, precioUnitario: ins.precio, fecha: d.fecha,
      nota: `Reserva ${sala.nombre} · ${d.desde} a ${d.hasta}`, reservaId: id, creadoEn: fecha
    } : null;
    return { reserva, consumo };
  }

  /** Política de cancelación: con menos de N horas de anticipación se mantiene el cargo. */
  function cancelacion(db, r, ahora = new Date()) {
    const c = cfgReservas(db);
    const faltan = new Date(`${r.fecha}T${r.desde}:00`) - ahora;
    return { tarde: faltan < c.cancelacionHoras * 3600000, yaPaso: faltan < 0, horas: c.cancelacionHoras };
  }

  /* ======================================================================
     CUENTA CORRIENTE Y MORA
     ====================================================================== */
  const COB_DEF = { tasaMensual: 0, recargoFijo: 0, diasGracia: 0, diaVencimiento: 10, suspenderDias: 30, mediosPago: [] };
  const cfgCobros = (db) => Object.assign({}, COB_DEF, ((db.config || {}).cobros) || {});

  function vencimiento(db, r) {
    const cont = (db.contratos || []).filter((c) => c.locatarioId === r.locatarioId).sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio))[0];
    const dia = Math.min(28, Number((cont && cont.diaVencimiento) || cfgCobros(db).diaVencimiento) || 10);
    const [y, m] = r.periodo.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${pad(nm)}-${pad(dia)}`;
  }

  /**
   * Estado de un cargo (resumen emitido) con sus pagos confirmados.
   * Los pagos se imputan primero a intereses y luego a capital (art. 903 CCyC).
   */
  function estadoCargo(db, r, pagos, hoy = hoyStr()) {
    const cfg = cfgCobros(db);
    const venc = vencimiento(db, r);
    const tasaDia = (Number(cfg.tasaMensual) || 0) / 100 / 30;
    const gracia = Number(cfg.diasGracia) || 0;
    let capital = r2(r.total);
    let interes = 0, intPagado = 0, pagado = 0, recargo = 0, cursor = venc;
    const aplicaMora = (fecha) => fecha > venc && diffDias(venc, fecha) > gracia;
    const devengar = (hasta) => {
      if (capital > 0 && aplicaMora(hasta)) {
        interes += capital * tasaDia * Math.max(0, diffDias(cursor > venc ? cursor : venc, hasta));
        if (!recargo && cfg.recargoFijo) recargo = Number(cfg.recargoFijo);
      }
      if (hasta > cursor) cursor = hasta;
    };
    pagos.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach((p) => {
      devengar(p.fecha);
      let monto = Number(p.importe) || 0;
      pagado += monto;
      const debeInt = interes + recargo - intPagado;
      const aInt = Math.min(monto, Math.max(0, debeInt));
      intPagado += aInt;
      monto -= aInt;
      capital = Math.max(0, capital - monto);
    });
    devengar(hoy);
    const saldoInteres = r2(Math.max(0, interes + recargo - intPagado));
    const saldo = r2(capital + saldoInteres);
    const diasMora = capital > 0 && hoy > venc ? diffDias(venc, hoy) : 0;
    const estado = saldo <= 0.5 ? 'pagado' : hoy > venc ? 'vencido' : pagado > 0 ? 'parcial' : 'pendiente';
    return { resumenId: r.id, numero: r.numero, periodo: r.periodo, total: r2(r.total), vencimiento: venc, pagado: r2(pagado), capital: r2(capital), intereses: r2(interes + recargo), saldoInteres, saldo, diasMora, estado };
  }

  function estadoCuenta(db, locId, hoy = hoyStr()) {
    const pagos = (db.pagos || []).filter((p) => p.locatarioId === locId && p.estado === 'confirmado');
    const cargos = (db.resumenes || [])
      .filter((r) => r.locatarioId === locId && r.estado === 'emitido')
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map((r) => estadoCargo(db, r, pagos.filter((p) => p.resumenId === r.id), hoy));
    const sum = (k, f = () => true) => r2(cargos.filter(f).reduce((a, c) => a + c[k], 0));
    return {
      cargos,
      deuda: sum('saldo'),
      vencido: sum('saldo', (c) => c.estado === 'vencido'),
      intereses: sum('saldoInteres'),
      diasMoraMax: cargos.reduce((m, c) => Math.max(m, c.diasMora), 0),
      informados: (db.pagos || []).filter((p) => p.locatarioId === locId && p.estado === 'informado')
    };
  }

  /* ======================================================================
     FACTURA ELECTRÓNICA (datos del comprobante para ARCA · WSFEv1)
     ====================================================================== */
  const COND_IVA_RECEPTOR = { 'Responsable Inscripto': 1, Exento: 4, 'Consumidor Final': 5, Monotributo: 6 };
  const ALICUOTA_ID = { 0: 3, 10.5: 4, 21: 5, 27: 6 };
  const LETRA = { 1: 'A', 6: 'B', 11: 'C' };

  /** Arma los datos del comprobante a partir de un resumen emitido. */
  function armarFactura(db, r, hoy = hoyStr()) {
    const snap = r.snapshot;
    const P = (db.config || {}).prestador || {};
    // Datos del receptor: los del legajo actual (la factura se emite hoy), completados con los del resumen
    const L = Object.assign({}, snap.locatario || {}, (db.locatarios || []).find((l) => l.id === r.locatarioId) || {});
    const legajo = (db.locatarios || []).find((l) => l.id === r.locatarioId) || {};
    const emisorRI = P.condicionIva === 'Responsable Inscripto';
    const receptorRI = L.condicionIva === 'Responsable Inscripto';
    const tipo = !emisorRI ? 11 : receptorRI ? 1 : 6;
    const cuit = String(L.cuit || '').replace(/\D/g, '');
    const dni = String(legajo.documento || '').replace(/\D/g, '');
    const docTipo = cuit.length === 11 ? 80 : dni ? 96 : 99;
    const docNro = cuit.length === 11 ? cuit : dni || '0';
    const t = snap.totales;
    const conIva = tipo !== 11;
    const avisos = [];
    if (tipo === 1 && docTipo !== 80) avisos.push('Para emitir Factura A el cliente necesita un CUIT válido en su legajo.');
    if (!String(P.cuit || '').replace(/\D/g, '')) avisos.push('Falta el CUIT del prestador en Configuración.');
    if (!conIva && t.iva > 0) avisos.push('El prestador no es Responsable Inscripto: la Factura C no discrimina IVA. Revisá la alícuota en Configuración.');
    return {
      tipo, letra: LETRA[tipo], concepto: 2, docTipo, docNro, condicionIvaReceptor: COND_IVA_RECEPTOR[L.condicionIva] || 5,
      receptor: L.razonSocial || L.nombreComercial || '', fecha: hoy,
      servDesde: snap.desde, servHasta: snap.hasta, vtoPago: vencimiento(db, r) < hoy ? hoy : vencimiento(db, r),
      neto: conIva ? r2(t.subtotal) : r2(t.subtotal), iva: conIva ? r2(t.iva) : 0, total: conIva ? r2(t.total) : r2(t.subtotal),
      alicuota: t.alicuota, alicuotaId: ALICUOTA_ID[t.alicuota] || 5, moneda: 'PES', cotizacion: 1, avisos
    };
  }

  /** URL del código QR del comprobante (especificación de ARCA para comprobantes electrónicos). */
  function qrFactura(base, f, cuitEmisor) {
    const datos = {
      ver: 1, fecha: f.fecha, cuit: Number(cuitEmisor), ptoVta: f.puntoVenta, tipoCmp: f.tipo, nroCmp: f.numero,
      importe: f.total, moneda: 'PES', ctz: 1, tipoDocRec: f.docTipo, nroDocRec: Number(f.docNro), tipoCodAut: 'E', codAut: Number(f.cae)
    };
    const json = JSON.stringify(datos);
    const b64 = typeof Buffer !== 'undefined' ? Buffer.from(json).toString('base64') : btoa(json);
    return `${base}?p=${b64}`;
  }

  return {
    sha256,
    factura: { armar: armarFactura, qr: qrFactura, LETRA },
    util: { hoyStr, diffDias, fmtFecha, dinero, minutos, hhmm },
    firma: { ESTADOS: ESTADOS_FIRMA, estado: estadoFirma, texto: textoContrato, enviar, registrarVista, firmarCliente, firmarPrestador, anular, adjuntarDigital, verificar, desactualizado },
    reservas: { config: cfgReservas, validar: validarReserva, armar: armarReserva, cancelacion, horas: horasReserva, solapa },
    cuenta: { config: cfgCobros, vencimiento, estadoCargo, estado: estadoCuenta }
  };
});
