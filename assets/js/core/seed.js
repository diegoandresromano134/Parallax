/* ==========================================================================
   PARALLAX · Datos de demostración e inventario de ejemplo
   ---------------------------------------------------------------------------
   · PLX.seed()        Base completa de demostración, relativa a la fecha actual.
   · PLX.seedBase()    Base vacía para operar (configuración y modalidades).
   · PLX.seedInventario() Inventario de ejemplo para cargar con un clic.

   Montos, personas y consumos son ilustrativos. El CUIT y los datos del
   titular de las cuentas principales quedan pendientes de carga para no
   inventar información legal.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util } = PLX;

  function planesBase() {
    return [
      { id: 'plan_pf', nombre: 'Puesto Flexible', precioPuesto: 185000, descripcion: 'Puesto en áreas abiertas sin ubicación fija. Ideal para profesionales independientes.' },
      { id: 'plan_ed', nombre: 'Escritorio Dedicado', precioPuesto: 260000, descripcion: 'Escritorio fijo con locker, en área compartida.' },
      { id: 'plan_op', nombre: 'Oficina Privada', precioPuesto: 310000, descripcion: 'Oficina cerrada y equipada para equipos de 2 a 10 puestos.' },
      { id: 'plan_sc', nombre: 'Suite Corporativa', precioPuesto: 345000, descripcion: 'Planta o ala exclusiva con sala de reuniones propia e identidad de marca.' }
    ];
  }

  /** Inventario de ejemplo: espacios, equipos numerados, mobiliario, insumos y horas. */
  function inventario() {
    const out = [];
    const add = (id, categoria, tipo, nombre, unidad, precio, extra = {}) =>
      out.push(Object.assign({ id, categoria, tipo, nombre, unidad, precio, codigo: '', ubicacion: '', estado: 'disponible', activo: true, descripcion: '' }, extra));
    const serie = (prefijo, n, categoria, nombre, unidad, precio, ubic) => {
      for (let i = 1; i <= n; i++) {
        const cod = `${prefijo}-${String(i).padStart(2, '0')}`;
        add(`ins_${prefijo.toLowerCase()}${String(i).padStart(2, '0')}`, categoria, 'unidad', nombre, unidad, precio, { codigo: cod, ubicacion: typeof ubic === 'function' ? ubic(i) : ubic || '' });
      }
    };
    // Espacios
    add('ins_suitea', 'espacios', 'unidad', 'Suite corporativa A', 'mes', 4140000, { codigo: 'SUITE-A', ubicacion: 'Piso 3 · ala norte', descripcion: 'Hasta 14 puestos, sala de reuniones propia.' });
    serie('OF', 4, 'espacios', 'Oficina privada', 'mes', 1550000, (i) => `Piso 2 · oficina ${i}`);
    serie('ESC', 10, 'espacios', 'Escritorio', 'día', 18000, (i) => `Piso 1 · área abierta, puesto ${i}`);
    add('ins_sala', 'espacios', 'tiempo', 'Sala de reuniones', 'hora', 22000, { codigo: 'SALA', ubicacion: 'Piso 1', descripcion: 'Salas A y B, con pantalla y videoconferencia.' });
    add('ins_conf', 'espacios', 'tiempo', 'Sala de conferencias', 'bloque', 120000, { codigo: 'CONF', ubicacion: 'Piso 3', descripcion: 'Bloque de 4 horas, hasta 40 personas.' });
    // Utilería y equipos
    serie('PC', 6, 'utileria', 'Computadora portátil', 'día', 9000, 'Recepción · armario de equipos');
    serie('MON', 4, 'utileria', 'Monitor 27 pulgadas', 'día', 4000, 'Recepción · armario de equipos');
    serie('PRY', 1, 'utileria', 'Proyector portátil', 'día', 18000, 'Recepción · armario de equipos');
    serie('VID', 2, 'utileria', 'Kit de videoconferencia', 'día', 12000, 'Recepción · armario de equipos');
    serie('ADP', 4, 'utileria', 'Adaptador HDMI / USB-C', 'día', 3500, 'Recepción · cajón de accesorios');
    // Mobiliario
    serie('SIL', 6, 'mobiliario', 'Silla ergonómica adicional', 'mes', 28000, 'Depósito');
    serie('LCK', 12, 'mobiliario', 'Locker con llave', 'mes', 15000, 'Piso 1 · pasillo');
    serie('MESA', 2, 'mobiliario', 'Mesa plegable para eventos', 'día', 9000, 'Depósito');
    // Papelería
    add('ins_resma', 'papeleria', 'consumible', 'Resma A4 75 g', 'resma', 8900, { stock: 40 });
    add('ins_bn', 'papeleria', 'consumible', 'Impresión blanco y negro', 'hoja', 90);
    add('ins_color', 'papeleria', 'consumible', 'Impresión color', 'hoja', 350);
    add('ins_carpetas', 'papeleria', 'consumible', 'Carpetas y biblioratos', 'unidad', 3200, { stock: 30 });
    // Otros insumos
    add('ins_cafe', 'otros', 'consumible', 'Café de especialidad', 'kg', 32000, { stock: 8 });
    add('ins_agua', 'otros', 'consumible', 'Agua mineral (bidón 20 L)', 'unidad', 6800, { stock: 12 });
    add('ins_limpieza', 'otros', 'consumible', 'Kit de limpieza de puesto', 'unidad', 4000, { stock: 20 });
    // Servicios y horas adicionales
    add('ins_horas', 'servicios', 'tiempo', 'Horas adicionales fuera de horario', 'hora', 12000, { codigo: 'HADIC' });
    add('ins_cochera', 'servicios', 'tiempo', 'Cochera', 'día', 14000, { codigo: 'COCH' });
    add('ins_mensajeria', 'servicios', 'consumible', 'Mensajería y cadetería', 'envío', 7500);
    return out;
  }

  function seedBase() {
    return { version: 2, meta: { seeded: true }, planes: planesBase() };
  }

  function seed() {
    const rnd = util.rng(20261122);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

    const now = new Date();
    const hoy = util.todayStr(now);
    const p0 = util.periodOf(now);
    const firstOf = (d) => util.periodRange(util.shiftPeriod(p0, d)).start;
    const lastOf = (d) => util.periodRange(util.shiftPeriod(p0, d)).end;
    const isoAgo = (ms) => new Date(now.getTime() - ms).toISOString();

    const planes = planesBase();
    const insumos = inventario();
    const ins = (id) => insumos.find((i) => i.id === id);
    const porCodigo = (c) => insumos.find((i) => i.codigo === c);

    /* ---------- Legajos ---------- */
    const legajoVacio = { nombre: '', apellido: '', documento: '', nacimiento: '', telefono: '', email: '', domicilio: '' };
    const locatarios = [
      Object.assign({}, legajoVacio, {
        id: 'loc_celius', numeroCliente: 'CL-0001', tipo: 'empresa', nombreComercial: 'Celius Salud', razonSocial: 'Balro S.A.',
        cuit: '', condicionIva: 'Responsable Inscripto', fechaContrato: firstOf(-8), principal: true,
        notas: 'Cuenta corporativa principal. Completar CUIT y datos del titular o representante.'
      }),
      Object.assign({}, legajoVacio, {
        id: 'loc_nivel', numeroCliente: 'CL-0002', tipo: 'empresa', nombreComercial: 'Nivel Salud', razonSocial: 'Care Salud S.A.',
        cuit: '', condicionIva: 'Responsable Inscripto', fechaContrato: firstOf(-7), principal: true,
        notas: 'Cuenta corporativa principal. Completar CUIT y datos del titular o representante.'
      }),
      Object.assign({}, legajoVacio, {
        id: 'loc_myc', numeroCliente: 'CL-0003', tipo: 'empresa', nombreComercial: 'M&C Salud', razonSocial: '',
        cuit: '', condicionIva: 'Responsable Inscripto', fechaContrato: firstOf(-5), principal: true,
        notas: 'Cuenta corporativa principal. Confirmar razón social, CUIT y titular.'
      }),
      Object.assign({}, legajoVacio, {
        id: 'loc_kora', numeroCliente: 'CL-0004', tipo: 'empresa', nombreComercial: 'Kora Estudio', razonSocial: 'Kora Estudio S.R.L.',
        nombre: 'Paula', apellido: 'Ferreyra', documento: '28.555.444', nacimiento: '1988-04-12', email: 'paula@kora.example', telefono: '11 5555-0101',
        cuit: '', condicionIva: 'Responsable Inscripto', fechaContrato: firstOf(-3), principal: false, demo: true,
        notas: 'Legajo de demostración.'
      }),
      Object.assign({}, legajoVacio, {
        id: 'loc_leiva', numeroCliente: 'CL-0005', tipo: 'profesional', nombreComercial: 'Martín Leiva', razonSocial: 'Martín Leiva',
        nombre: 'Martín', apellido: 'Leiva', documento: '12.345.678', nacimiento: '1991-06-15', email: 'martin.leiva@correo.example',
        telefono: '11 5555-0202', cuit: '20-12345678-6', condicionIva: 'Monotributo', fechaContrato: now.getDate() >= 10 ? `${p0}-10` : firstOf(0),
        principal: false, demo: true, notas: 'Legajo de demostración (datos ficticios).'
      })
    ];

    /* ---------- Contratos con recursos incluidos ---------- */
    const unidades = (...codigos) => codigos.map((c) => ({ insumoId: porCodigo(c).id, cantidad: 1 }));
    const incl = (id, cantidad) => ({ insumoId: id, cantidad });
    const servicios = ['Conectividad de fibra y Wi-Fi seguro', 'Recepción y atención de visitas', 'Recepción de correspondencia', 'Limpieza y mantenimiento', 'Café e infusiones'];
    const mk = (n, locId, planId, puestos, inicio, fin, recursos, extra = {}) => {
      const plan = planes.find((p) => p.id === planId);
      return Object.assign({
        id: `con_${n}`, numero: `PLX-${inicio.slice(0, 4)}-${String(n).padStart(3, '0')}`, locatarioId: locId, planId, puestos,
        montoMensual: plan.precioPuesto * puestos, fechaInicio: inicio, fechaFin: fin, ajuste: 'Trimestral por IPC', diaVencimiento: 10,
        recursos, servicios: servicios.slice(), estado: 'vigente', notas: '', creadoEn: isoAgo(200 * 86400000)
      }, extra);
    };
    const contratos = [
      mk(1, 'loc_celius', 'plan_sc', 12, firstOf(-8), lastOf(3),
        [...unidades('SUITE-A', 'LCK-01', 'LCK-02', 'LCK-03', 'LCK-04', 'SIL-01', 'SIL-02'), incl('ins_sala', 20), incl('ins_resma', 4), incl('ins_bn', 1000)],
        { servicios: servicios.concat(['Domicilio comercial', 'Asesoría administrativa', 'Gestoría de trámites']) }),
      mk(2, 'loc_nivel', 'plan_op', 8, firstOf(-7), lastOf(4),
        [...unidades('OF-01', 'LCK-05', 'LCK-06', 'LCK-07'), incl('ins_sala', 12), incl('ins_resma', 2), incl('ins_bn', 500)],
        { servicios: servicios.concat(['Domicilio comercial', 'Asesoría administrativa']) }),
      mk(3, 'loc_myc', 'plan_op', 6, firstOf(-5), lastOf(6),
        [...unidades('OF-02'), incl('ins_sala', 10), incl('ins_resma', 2), incl('ins_bn', 400)],
        { servicios: servicios.concat(['Gestoría de trámites']) }),
      mk(4, 'loc_kora', 'plan_ed', 3, firstOf(-3), util.addDays(hoy, 30),
        [...unidades('ESC-01', 'ESC-02', 'ESC-03', 'LCK-08', 'LCK-09', 'LCK-10'), incl('ins_sala', 6), incl('ins_resma', 1), incl('ins_bn', 200)],
        { ajuste: 'Semestral por IPC' }),
      mk(5, 'loc_leiva', 'plan_pf', 1, locatarios[4].fechaContrato, lastOf(6),
        [incl('ins_sala', 4), incl('ins_resma', 1), incl('ins_bn', 100)], { ajuste: 'Sin ajuste' })
    ];
    const espacioDe = {};
    contratos.forEach((c) => {
      const u = c.recursos.map((r) => ins(r.insumoId)).find((i) => i && i.categoria === 'espacios' && i.tipo === 'unidad');
      if (u) espacioDe[c.locatarioId] = u.id;
    });

    /* ---------- Personas autorizadas ---------- */
    const nombres = ['Lucía', 'Mateo', 'Sofía', 'Tomás', 'Valentina', 'Joaquín', 'Camila', 'Nicolás', 'Martina', 'Facundo', 'Agustina', 'Santiago', 'Florencia', 'Bruno', 'Julieta', 'Ignacio', 'Carolina', 'Federico'];
    const apellidos = ['Pereyra', 'Benítez', 'Ferrari', 'Acosta', 'Medina', 'Herrera', 'Castro', 'Rossi', 'Domínguez', 'Sosa', 'Ibarra', 'Navarro', 'Molina', 'Ojeda', 'Vera', 'Quiroga', 'Luna', 'Godoy'];
    const cupo = { loc_celius: 6, loc_nivel: 5, loc_myc: 4, loc_kora: 3 };
    const personas = [];
    let cred = 1001, ni = 0;
    Object.keys(cupo).forEach((locId) => {
      for (let i = 0; i < cupo[locId]; i++) {
        personas.push({ id: `per_${cred}`, locatarioId: locId, nombre: `${nombres[ni % nombres.length]} ${apellidos[(ni * 7 + 3) % apellidos.length]}`, credencial: `CR-${cred}`, habilitada: true, creadoEn: isoAgo(120 * 86400000) });
        cred++; ni++;
      }
    });
    personas.push({ id: `per_${cred}`, locatarioId: 'loc_leiva', nombre: 'Martín Leiva', credencial: `CR-${cred}`, titular: true, habilitada: true, creadoEn: isoAgo(10 * 86400000) });

    /* ---------- Check-in / check-out (últimos 45 días) ---------- */
    const accesos = [];
    const consumos = [];
    let an = 1, cn = 1;
    const pcs = insumos.filter((i) => i.codigo.startsWith('PC-'));
    const mons = insumos.filter((i) => i.codigo.startsWith('MON-'));
    const adps = insumos.filter((i) => i.codigo.startsWith('ADP-'));
    const escLibres = insumos.filter((i) => /^ESC-(0[4-9]|10)$/.test(i.codigo));
    let incidencia = false;

    for (let back = 45; back >= 0; back--) {
      const d = util.addDays(hoy, -back);
      const dow = util.parseDate(d).getDay();
      const esHoy = back === 0;
      const sabado = dow === 6 && !esHoy;
      if (dow === 0 && !esHoy) continue;
      const prestadosHoy = new Set();
      const libre = (lista) => lista.find((u) => !prestadosHoy.has(u.id));
      personas.forEach((p) => {
        const c = contratos.find((x) => x.locatarioId === p.locatarioId);
        if (c && d < c.fechaInicio) return;
        const prob = sabado ? 0.08 : p.locatarioId === 'loc_leiva' ? 0.55 : 0.74;
        if (rnd() > prob) return;
        let ingreso = util.parseDate(d);
        ingreso.setHours(8, between(0, 150), 0, 0);
        let dur = (sabado ? between(90, 240) : between(240, 570)) * 60000;
        let quedaAdentro = false;
        if (esHoy) {
          // Hoy: ingresos en las últimas horas y la mitad todavía en el espacio
          ingreso = new Date(now.getTime() - between(25, 300) * 60000);
          quedaAdentro = rnd() < 0.5;
          dur = between(20, 120) * 60000;
        }
        if (ingreso > now) return;
        const egresoT = new Date(ingreso.getTime() + dur);
        const abierto = quedaAdentro || egresoT > now;

        let espacioId = espacioDe[p.locatarioId] || null;
        if (!espacioId) { const e = libre(escLibres); if (e) { espacioId = e.id; prestadosHoy.add(e.id); } }
        const items = [];
        const prestar = (lista) => { const u = libre(lista); if (u) { prestadosHoy.add(u.id); items.push({ insumoId: u.id, cantidad: 1, devolver: true, devolucion: null }); } };
        if (rnd() < 0.22) prestar(pcs);
        if (rnd() < 0.08) prestar(mons);
        if (rnd() < 0.06) prestar(adps);
        if (rnd() < 0.05) items.push({ insumoId: 'ins_resma', cantidad: 1, devolver: false, devolucion: null });

        const id = `acc_${an++}`;
        let estado = 'abierto';
        let observaciones = '';
        if (!abierto) {
          estado = 'completo';
          items.forEach((it) => { if (it.devolver) it.devolucion = { estado: 'ok', nota: '' }; });
          const adp = items.find((it) => it.devolver && ins(it.insumoId).codigo.startsWith('ADP-'));
          if (adp && !incidencia && back > 3) {
            adp.devolucion = { estado: 'faltante', nota: 'No se devolvió al salir; quedó en reclamar.' };
            estado = 'observado';
            observaciones = 'Falta el adaptador. Se avisó al locatario.';
            incidencia = true;
          }
        }
        accesos.push({
          id, locatarioId: p.locatarioId, numeroCliente: locatarios.find((l) => l.id === p.locatarioId).numeroCliente,
          personaId: p.id, nombre: p.nombre, credencial: p.credencial,
          ingreso: ingreso.toISOString(), egreso: abierto ? null : egresoT.toISOString(),
          espacioId, items, estado, observaciones, punto: rnd() < 0.12 ? 'Cochera' : 'Recepción', nota: ''
        });
        // Préstamos no incluidos y consumibles pedidos en el ingreso → consumos
        items.forEach((it) => {
          const r = ins(it.insumoId);
          consumos.push({ id: `cns_${cn++}`, locatarioId: p.locatarioId, insumoId: r.id, cantidad: it.cantidad, precioUnitario: r.precio, fecha: d, nota: `Check-in ${util.fmtTime(ingreso.toISOString())}`, accesoId: id, creadoEn: ingreso.toISOString() });
        });
      });
    }

    /* ---------- Consumos registrados en recepción (tres meses) ---------- */
    const pesos = { ins_bn: 6, ins_color: 3, ins_resma: 4, ins_cafe: 2, ins_sala: 5, ins_agua: 2, ins_mensajeria: 2, ins_cochera: 2, ins_horas: 2, ins_carpetas: 1, ins_conf: 1, ins_limpieza: 1 };
    const bolsa = [];
    Object.keys(pesos).forEach((k) => { for (let i = 0; i < pesos[k]; i++) bolsa.push(k); });
    const cantidadPara = (r) => {
      switch (r.unidad) {
        case 'hoja': return between(5, 40) * 10;
        case 'hora': return between(1, 4);
        case 'día': return between(1, 3);
        case 'kg': return between(1, 2);
        case 'bloque': return 1;
        case 'envío': return between(1, 3);
        case 'resma': return between(1, 3);
        default: return between(1, 4);
      }
    };
    const volumen = { loc_celius: 14, loc_nivel: 11, loc_myc: 8, loc_kora: 5, loc_leiva: 3 };
    [-2, -1, 0].forEach((delta) => {
      const per = util.shiftPeriod(p0, delta);
      const { start, days } = util.periodRange(per);
      const tope = delta === 0 ? now.getDate() : days;
      locatarios.forEach((l) => {
        const c = contratos.find((x) => x.locatarioId === l.id);
        let n = Math.round(volumen[l.id] * (tope / days));
        while (n-- > 0) {
          const elegido = pick(bolsa);
          const r = ins(elegido);
          const fecha = util.addDays(start, between(0, tope - 1));
          if ((c && fecha < c.fechaInicio) || fecha > hoy) continue;
          consumos.push({ id: `cns_${cn++}`, locatarioId: l.id, insumoId: r.id, cantidad: cantidadPara(r), precioUnitario: r.precio, fecha, nota: '', creadoEn: isoAgo(0) });
        }
      });
    });

    /* ---------- Consultas y solicitudes ---------- */
    const consultas = [
      { id: 'cta_1', nombre: 'Rocío Almada', email: 'rocio.almada@correo.example', telefono: '', empresa: 'Estudio contable independiente', interes: 'Escritorio Dedicado', puestos: 2, mensaje: 'Somos dos profesionales y buscamos un espacio con sala de reuniones para recibir clientes dos veces por semana. ¿Podemos coordinar una visita?', fecha: isoAgo(95 * 60000), estado: 'nueva', origen: 'sitio' },
      { id: 'cta_2', nombre: 'Diego Funes', email: 'diego.funes@correo.example', telefono: '', empresa: 'Startup de software', interes: 'Oficina Privada', puestos: 5, mensaje: 'Necesitamos una oficina privada para cinco personas a partir del mes próximo, con domicilio comercial incluido.', fecha: isoAgo(26 * 3600000), estado: 'nueva', origen: 'sitio' },
      { id: 'cta_3', nombre: 'Carla Méndez', email: 'carla.mendez@correo.example', telefono: '', empresa: 'Profesional independiente', interes: 'Agendar una visita', puestos: 1, mensaje: 'Me interesa conocer el espacio y las opciones de Asesoría y Gestoría para monotributistas.', fecha: isoAgo(4 * 86400000), estado: 'respondida', origen: 'sitio' },
      { id: 'cta_4', nombre: 'Martín Leiva', email: 'martin.leiva@correo.example', telefono: '', empresa: 'Martín Leiva', interes: 'Reserva de sala', tipo: 'Reserva de sala', fechaDeseada: util.addDays(hoy, 2), mensaje: 'Necesito la sala de reuniones de 15 a 17 h para una reunión con clientes.', fecha: isoAgo(3 * 3600000), estado: 'nueva', origen: 'miembro', locatarioId: 'loc_leiva' }
    ];

    const db = {
      version: 2,
      meta: { seeded: true, demo: true, seedVersion: 3, creado: now.toISOString(), actualizado: now.toISOString(), rev: 0 },
      config: undefined,
      locatarios, planes, contratos, personas, accesos, insumos, consumos, consultas, resumenes: [], documentos: []
    };

    /* ---------- Resúmenes emitidos del mes anterior ---------- */
    if (PLX.billing && PLX.domain) {
      const cuentas = { abonos: PLX.domain.CUENTA_ABONOS };
      PLX.domain.CATEGORIAS.forEach((c) => (cuentas[c.id] = c.cuenta));
      db.config = Object.assign(PLX.store.emptyDb().config, { cuentas, secuenciaResumen: 0, secuenciaCliente: 5 });
      const pPrev = util.shiftPeriod(p0, -1);
      const emision = util.parseDate(firstOf(0));
      emision.setHours(10, 0, 0, 0);
      PLX.billing.computeAll(db, pPrev).forEach((res) => {
        db.config.secuenciaResumen += 1;
        db.resumenes.push({
          id: `rsm_${db.config.secuenciaResumen}`,
          numero: `RG-${pPrev.replace('-', '')}-${String(db.config.secuenciaResumen).padStart(4, '0')}`,
          periodo: pPrev, locatarioId: res.locatario.id, estado: 'emitido', version: 1,
          emitidoEn: emision.toISOString(), total: res.totales.total, snapshot: res
        });
      });
    }
    /* ---------- Salas y reservas (semana actual y próxima) ---------- */
    db.salas = [
      { id: 'sala_a', nombre: 'Sala A', capacidad: 6, insumoId: 'ins_sala', equipamiento: 'Pantalla 55", videoconferencia', color: 'cyan', activa: true },
      { id: 'sala_b', nombre: 'Sala B', capacidad: 10, insumoId: 'ins_sala', equipamiento: 'Pantalla, pizarra', color: 'magenta', activa: true },
      { id: 'sala_conf', nombre: 'Sala de conferencias', capacidad: 40, insumoId: 'ins_conf', equipamiento: 'Proyector y sonido', color: 'violet', activa: true }
    ];
    db.reservas = [];
    if (PLX.reglas) {
      const lunes = util.addDays(hoy, -((util.parseDate(hoy).getDay() + 6) % 7));
      const titulos = ['Reunión de equipo', 'Entrevista con cliente', 'Presentación', 'Capacitación interna', 'Reunión de directorio', 'Videollamada'];
      const clientes = ['loc_celius', 'loc_nivel', 'loc_myc', 'loc_kora', 'loc_leiva'];
      let rn = 1;
      for (let d = 0; d < 12; d++) {
        const fecha = util.addDays(lunes, d);
        const dow = util.parseDate(fecha).getDay();
        if (dow === 0 || dow === 6) continue;
        db.salas.forEach((sala) => {
          let hora = 9 + between(0, 2);
          const cant = sala.id === 'sala_conf' ? (rnd() < 0.25 ? 1 : 0) : between(1, 3);
          for (let k = 0; k < cant && hora < 18; k++) {
            const dur = sala.id === 'sala_conf' ? 4 : between(1, 2);
            const loc = pick(clientes);
            const c = contratos.find((x) => x.locatarioId === loc);
            if (c && fecha < c.fechaInicio) { hora += dur; continue; }
            const desde = `${util.pad(hora)}:00`, hasta = `${util.pad(Math.min(hora + dur, 20))}:00`;
            const { reserva, consumo } = PLX.reglas.reservas.armar(db, { salaId: sala.id, locatarioId: loc, fecha, desde, hasta, titulo: pick(titulos) }, { id: `rsv_${rn}`, consumoId: `cns_r${rn}`, fecha: isoAgo(3 * 86400000), origen: rnd() < 0.6 ? 'miembro' : 'administracion' });
            rn++;
            db.reservas.push(reserva);
            if (consumo) db.consumos.push(consumo);
            hora += dur + between(0, 2);
          }
        });
      }

      /* ---------- Firma de contratos ---------- */
      const F = PLX.reglas.firma;
      const firmaSvg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><path d="M20 80 C 50 20, 80 110, 110 60 S 160 20, 190 70 S 240 100, 270 50 S 320 40, 340 70" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/></svg>');
      const kora = contratos.find((c) => c.id === 'con_4');
      const t0 = new Date(util.parseDate(kora.fechaInicio).getTime() - 3 * 86400000);
      t0.setHours(11, 5, 0, 0);
      kora.firma = F.enviar(db, kora, { fecha: t0.toISOString(), actor: 'admin' });
      kora.firma = F.registrarVista(kora, { fecha: new Date(t0.getTime() + 3600000).toISOString(), actor: 'CL-0004', ip: '190.210.12.34', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)' });
      kora.firma = F.firmarCliente(kora, { nombre: 'Paula Ferreyra', dni: '28555444', imagen: firmaSvg }, { fecha: new Date(t0.getTime() + 3900000).toISOString(), actor: 'CL-0004', ip: '190.210.12.34', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)' });
      kora.firma = F.firmarPrestador(kora, { nombre: 'PARALLAX · Administración', fecha: new Date(t0.getTime() + 7200000).toISOString(), actor: 'admin' });
      const leivaC = contratos.find((c) => c.id === 'con_5');
      leivaC.firma = F.enviar(db, leivaC, { fecha: isoAgo(2 * 86400000), actor: 'admin' });

      /* ---------- Pagos de los resúmenes del mes anterior ---------- */
      const diaMes = (d) => util.todayStr(new Date(now.getFullYear(), now.getMonth(), Math.min(d, now.getDate())));
      const rs = (loc) => db.resumenes.find((r) => r.locatarioId === loc);
      const pago = (loc, frac, dia, medio, estado = 'confirmado', ref = '') => {
        const r = rs(loc);
        if (!r) return;
        db.pagos.push({ id: `pag_${db.pagos.length + 1}`, locatarioId: loc, resumenId: r.id, fecha: diaMes(dia), importe: util.round2(r.total * frac), medio, referencia: ref, estado, origen: estado === 'informado' ? 'miembro' : 'administracion', creadoEn: isoAgo(86400000) });
      };
      db.pagos = [];
      pago('loc_celius', 1, 8, 'Transferencia bancaria', 'confirmado', 'Op. 554120');
      pago('loc_nivel', 0.6, 9, 'Echeq', 'confirmado', 'Echeq 0031');
      pago('loc_kora', 1, 20, 'Mercado Pago', 'confirmado', 'MP 9981');
      pago('loc_myc', 0.5, 26, 'Transferencia bancaria', 'informado', 'Op. 771203');
    }
    db.facturas = [];

    return db;
  }

  PLX.seed = seed;
  PLX.seedBase = seedBase;
  PLX.seedInventario = inventario;
})(window);
