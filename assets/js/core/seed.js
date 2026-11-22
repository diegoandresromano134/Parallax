/* ==========================================================================
   PARALLAX · Datos de demostración
   ---------------------------------------------------------------------------
   Se generan relativos a la fecha actual para que el panel siempre muestre
   actividad coherente. Montos, personas y consumos son ilustrativos y se
   editan o eliminan desde el propio panel (Configuración → Datos).
   CUIT y datos de contacto de las cuentas principales quedan pendientes
   de carga para no inventar información legal.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util } = PLX;

  function seed() {
    const rnd = util.rng(20261122);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

    const now = new Date();
    const hoy = util.todayStr(now);
    const p0 = util.periodOf(now);
    const firstOf = (delta) => util.periodRange(util.shiftPeriod(p0, delta)).start;
    const lastOf = (delta) => util.periodRange(util.shiftPeriod(p0, delta)).end;
    const isoAgo = (ms) => new Date(now.getTime() - ms).toISOString();

    /* ---------- Modalidades de abono ---------- */
    const planes = [
      { id: 'plan_pf', nombre: 'Puesto Flexible', precioPuesto: 185000, descripcion: 'Puesto en áreas abiertas sin ubicación fija. Ideal para profesionales independientes.' },
      { id: 'plan_ed', nombre: 'Escritorio Dedicado', precioPuesto: 260000, descripcion: 'Escritorio fijo con locker, en área compartida.' },
      { id: 'plan_op', nombre: 'Oficina Privada', precioPuesto: 310000, descripcion: 'Oficina cerrada y equipada para equipos de 2 a 10 puestos.' },
      { id: 'plan_sc', nombre: 'Suite Corporativa', precioPuesto: 345000, descripcion: 'Planta o ala exclusiva con sala de reuniones propia e identidad de marca.' }
    ];

    /* ---------- Locatarios ---------- */
    const contactoVacio = () => ({ nombre: '', email: '', telefono: '' });
    const locatarios = [
      {
        id: 'loc_celius', nombreComercial: 'Celius Salud', razonSocial: 'Balro S.A.', tipo: 'empresa',
        principal: true, cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '',
        contacto: contactoVacio(), notas: 'Cuenta corporativa principal. Completar CUIT y contacto administrativo.'
      },
      {
        id: 'loc_nivel', nombreComercial: 'Nivel Salud', razonSocial: 'Care Salud S.A.', tipo: 'empresa',
        principal: true, cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '',
        contacto: contactoVacio(), notas: 'Cuenta corporativa principal. Completar CUIT y contacto administrativo.'
      },
      {
        id: 'loc_myc', nombreComercial: 'M&C Salud', razonSocial: '', tipo: 'empresa',
        principal: true, cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '',
        contacto: contactoVacio(), notas: 'Cuenta corporativa principal. Confirmar razón social y CUIT.'
      },
      {
        id: 'loc_kora', nombreComercial: 'Kora Estudio', razonSocial: 'Kora Estudio S.R.L.', tipo: 'empresa',
        principal: false, demo: true, cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '',
        contacto: { nombre: 'Administración', email: 'administracion@kora.example', telefono: '' },
        notas: 'Locatario de demostración.'
      },
      {
        id: 'loc_leiva', nombreComercial: 'Martín Leiva · Consultoría', razonSocial: 'Martín Leiva', tipo: 'profesional',
        principal: false, demo: true, cuit: '', condicionIva: 'Monotributo', domicilio: '',
        contacto: { nombre: 'Martín Leiva', email: 'martin.leiva@correo.example', telefono: '' },
        notas: 'Locatario de demostración.'
      }
    ];

    /* ---------- Contratos de locación de servicios (Abonos de Membresía) ---------- */
    const inicioLeiva = now.getDate() >= 10 ? `${p0}-10` : firstOf(0);
    const serviciosBase = [
      'Conectividad de fibra y Wi-Fi seguro', 'Recepción y atención de visitas', 'Recepción de correspondencia',
      'Limpieza y mantenimiento', 'Café e infusiones'
    ];
    const mk = (n, locId, planId, puestos, inicio, fin, extra = {}) => {
      const plan = planes.find((p) => p.id === planId);
      return Object.assign({
        id: `con_${n}`,
        numero: `PLX-${inicio.slice(0, 4)}-${String(n).padStart(3, '0')}`,
        locatarioId: locId,
        planId,
        puestos,
        montoMensual: plan.precioPuesto * puestos,
        fechaInicio: inicio,
        fechaFin: fin,
        ajuste: 'Trimestral por IPC',
        diaVencimiento: 10,
        horasSala: puestos >= 6 ? 20 : 8,
        servicios: serviciosBase.slice(),
        estado: 'vigente',
        notas: '',
        creadoEn: isoAgo(1000 * 60 * 60 * 24 * 200)
      }, extra);
    };
    const contratos = [
      mk(1, 'loc_celius', 'plan_sc', 12, firstOf(-8), lastOf(3), {
        servicios: serviciosBase.concat(['Domicilio comercial', 'Asesoría administrativa', 'Gestoría de trámites'])
      }),
      mk(2, 'loc_nivel', 'plan_op', 8, firstOf(-7), lastOf(4), {
        servicios: serviciosBase.concat(['Domicilio comercial', 'Asesoría administrativa'])
      }),
      mk(3, 'loc_myc', 'plan_op', 6, firstOf(-5), lastOf(6), {
        servicios: serviciosBase.concat(['Gestoría de trámites'])
      }),
      mk(4, 'loc_kora', 'plan_ed', 3, firstOf(-3), util.addDays(hoy, 30), {
        servicios: serviciosBase.concat(['Locker personal']), ajuste: 'Semestral por IPC'
      }),
      mk(5, 'loc_leiva', 'plan_pf', 1, inicioLeiva, lastOf(6), { ajuste: 'Sin ajuste', horasSala: 4 })
    ];
    // Numeración consistente con el año de inicio
    contratos.forEach((c, i) => (c.numero = `PLX-${c.fechaInicio.slice(0, 4)}-${String(i + 1).padStart(3, '0')}`));

    /* ---------- Personas autorizadas (credenciales de acceso) ---------- */
    const nombres = ['Lucía', 'Mateo', 'Sofía', 'Tomás', 'Valentina', 'Joaquín', 'Camila', 'Nicolás', 'Martina', 'Facundo', 'Agustina', 'Santiago', 'Florencia', 'Bruno', 'Julieta', 'Ignacio', 'Carolina', 'Federico'];
    const apellidos = ['Pereyra', 'Benítez', 'Ferrari', 'Acosta', 'Medina', 'Herrera', 'Castro', 'Rossi', 'Domínguez', 'Sosa', 'Ibarra', 'Navarro', 'Molina', 'Ojeda', 'Vera', 'Quiroga', 'Luna', 'Godoy'];
    const cupo = { loc_celius: 6, loc_nivel: 5, loc_myc: 4, loc_kora: 3 };
    const personas = [];
    let cred = 1001, ni = 0;
    Object.keys(cupo).forEach((locId) => {
      for (let i = 0; i < cupo[locId]; i++) {
        personas.push({
          id: `per_${cred}`,
          locatarioId: locId,
          nombre: `${nombres[ni % nombres.length]} ${apellidos[(ni * 7 + 3) % apellidos.length]}`,
          credencial: `CR-${cred}`,
          habilitada: true,
          creadoEn: isoAgo(1000 * 60 * 60 * 24 * 120)
        });
        cred++; ni++;
      }
    });
    personas.push({ id: `per_${cred}`, locatarioId: 'loc_leiva', nombre: 'Martín Leiva', credencial: `CR-${cred}`, habilitada: true, creadoEn: isoAgo(1000 * 60 * 60 * 24 * 10) });

    /* ---------- Registro de accesos (últimos 45 días) ---------- */
    const accesos = [];
    let an = 1;
    for (let back = 45; back >= 0; back--) {
      const d = util.addDays(hoy, -back);
      const dow = util.parseDate(d).getDay();
      const sabado = dow === 6;
      const esHoy = back === 0; // el día actual siempre tiene actividad en la demo
      if (dow === 0 && !esHoy) continue;
      personas.forEach((p) => {
        const c = contratos.find((x) => x.locatarioId === p.locatarioId);
        if (c && d < c.fechaInicio) return;
        const prob = sabado && !esHoy ? 0.08 : p.locatarioId === 'loc_leiva' ? 0.55 : 0.74;
        if (rnd() > prob) return;
        const ingreso = util.parseDate(d);
        ingreso.setHours(8, between(0, 150), 0, 0);
        if (ingreso > now) return;
        const dur = (sabado && !esHoy ? between(90, 240) : between(240, 570)) * 60000;
        const egreso = new Date(ingreso.getTime() + dur);
        accesos.push({
          id: `acc_${an++}`,
          personaId: p.id,
          locatarioId: p.locatarioId,
          nombre: p.nombre,
          credencial: p.credencial,
          ingreso: ingreso.toISOString(),
          egreso: egreso > now ? null : egreso.toISOString(),
          punto: rnd() < 0.12 ? 'Cochera' : 'Recepción',
          nota: ''
        });
      });
    }

    /* ---------- Catálogo de insumos ---------- */
    const insumos = [
      ['ins_proy', 'utileria', 'Proyector portátil', 'día', 18000],
      ['ins_video', 'utileria', 'Kit de videoconferencia (cámara y micrófono)', 'día', 12000],
      ['ins_pizarra', 'utileria', 'Pizarra móvil', 'día', 6500],
      ['ins_cables', 'utileria', 'Adaptadores y cables (HDMI / USB-C)', 'día', 3500],
      ['ins_silla', 'mobiliario', 'Silla ergonómica adicional', 'mes', 28000],
      ['ins_escritorio', 'mobiliario', 'Escritorio adicional', 'mes', 45000],
      ['ins_locker', 'mobiliario', 'Locker con llave', 'mes', 15000],
      ['ins_mesa', 'mobiliario', 'Mesa plegable para eventos', 'día', 9000],
      ['ins_resma', 'papeleria', 'Resma A4 75 g', 'unidad', 8900],
      ['ins_bn', 'papeleria', 'Impresión blanco y negro', 'página', 90],
      ['ins_color', 'papeleria', 'Impresión color', 'página', 350],
      ['ins_carpetas', 'papeleria', 'Carpetas y biblioratos', 'unidad', 3200],
      ['ins_cafe', 'otros', 'Café de especialidad', 'kg', 32000],
      ['ins_agua', 'otros', 'Agua mineral (bidón 20 L)', 'unidad', 6800],
      ['ins_limpieza', 'otros', 'Kit de limpieza de puesto', 'unidad', 4000],
      ['ins_sala', 'servicios', 'Sala de reuniones (hora excedente)', 'hora', 22000],
      ['ins_conf', 'servicios', 'Sala de conferencias (bloque de 4 h)', 'bloque', 120000],
      ['ins_cochera', 'servicios', 'Cochera', 'día', 14000],
      ['ins_mensajeria', 'servicios', 'Mensajería y cadetería', 'envío', 7500]
    ].map(([id, categoria, nombre, unidad, precio]) => ({ id, categoria, nombre, unidad, precio, activo: true }));

    /* ---------- Consumos (dos meses anteriores + mes en curso) ---------- */
    const pesos = { ins_bn: 6, ins_color: 4, ins_resma: 4, ins_cafe: 3, ins_sala: 4, ins_agua: 3, ins_mensajeria: 2, ins_cochera: 2, ins_video: 2, ins_proy: 1, ins_pizarra: 1, ins_cables: 1, ins_carpetas: 2, ins_limpieza: 1, ins_conf: 1, ins_mesa: 1 };
    const bolsa = [];
    Object.keys(pesos).forEach((k) => { for (let i = 0; i < pesos[k]; i++) bolsa.push(k); });
    const cantidadPara = (ins) => {
      switch (ins.unidad) {
        case 'página': return between(5, 60) * 10;
        case 'hora': return between(1, 4);
        case 'día': return between(1, 3);
        case 'kg': return between(1, 3);
        case 'bloque': return 1;
        case 'envío': return between(1, 4);
        default: return between(1, 5);
      }
    };
    const volumen = { loc_celius: 14, loc_nivel: 11, loc_myc: 8, loc_kora: 5, loc_leiva: 3 };
    const consumos = [];
    let cn = 1;
    [-2, -1, 0].forEach((delta) => {
      const per = util.shiftPeriod(p0, delta);
      const { start, days } = util.periodRange(per);
      const tope = delta === 0 ? now.getDate() : days;
      locatarios.forEach((l) => {
        const c = contratos.find((x) => x.locatarioId === l.id);
        let n = Math.round(volumen[l.id] * (tope / days));
        // Mobiliario adicional mensual para las cuentas grandes
        if (['loc_celius', 'loc_nivel'].includes(l.id) && c.fechaInicio <= start) {
          const ins = insumos.find((i) => i.id === (l.id === 'loc_celius' ? 'ins_silla' : 'ins_locker'));
          consumos.push({ id: `cns_${cn++}`, locatarioId: l.id, insumoId: ins.id, cantidad: l.id === 'loc_celius' ? 2 : 3, precioUnitario: ins.precio, fecha: util.addDays(start, 1), nota: 'Uso mensual', creadoEn: isoAgo(0) });
        }
        while (n-- > 0) {
          const elegido = pick(bolsa);
          const ins = insumos.find((i) => i.id === elegido);
          const fecha = util.addDays(start, between(0, tope - 1));
          if (c && fecha < c.fechaInicio) continue;
          if (fecha > hoy) continue;
          consumos.push({
            id: `cns_${cn++}`,
            locatarioId: l.id,
            insumoId: ins.id,
            cantidad: cantidadPara(ins),
            precioUnitario: ins.precio,
            fecha,
            nota: '',
            creadoEn: isoAgo(0)
          });
        }
      });
    });

    /* ---------- Consultas recibidas desde el sitio ---------- */
    const consultas = [
      {
        id: 'cta_1', nombre: 'Rocío Almada', email: 'rocio.almada@correo.example', telefono: '',
        empresa: 'Estudio contable independiente', interes: 'Escritorio Dedicado', puestos: 2,
        mensaje: 'Somos dos profesionales y buscamos un espacio con sala de reuniones para recibir clientes dos veces por semana. ¿Podemos coordinar una visita?',
        fecha: isoAgo(1000 * 60 * 95), estado: 'nueva', origen: 'sitio'
      },
      {
        id: 'cta_2', nombre: 'Diego Funes', email: 'diego.funes@correo.example', telefono: '',
        empresa: 'Startup de software', interes: 'Oficina Privada', puestos: 5,
        mensaje: 'Necesitamos una oficina privada para cinco personas a partir del mes próximo, con domicilio comercial incluido.',
        fecha: isoAgo(1000 * 60 * 60 * 26), estado: 'nueva', origen: 'sitio'
      },
      {
        id: 'cta_3', nombre: 'Carla Méndez', email: 'carla.mendez@correo.example', telefono: '',
        empresa: 'Profesional independiente', interes: 'Agendar una visita', puestos: 1,
        mensaje: 'Me interesa conocer el espacio y las opciones de Asesoría y Gestoría para monotributistas.',
        fecha: isoAgo(1000 * 60 * 60 * 24 * 4), estado: 'respondida', origen: 'sitio'
      }
    ];

    const db = {
      version: 1,
      meta: { seeded: true, demo: true, creado: now.toISOString(), actualizado: now.toISOString() },
      config: undefined, // la completa store.migrate()
      locatarios,
      planes,
      contratos,
      personas,
      accesos,
      insumos,
      consumos,
      consultas,
      resumenes: []
    };

    /* ---------- Resúmenes emitidos del mes anterior ---------- */
    if (PLX.billing) {
      const cuentas = { abonos: PLX.domain.CUENTA_ABONOS };
      PLX.domain.CATEGORIAS.forEach((c) => (cuentas[c.id] = c.cuenta));
      db.config = {
        prestador: { nombre: 'PARALLAX', razonSocial: '', cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '', email: '' },
        ivaAlicuota: 21, prorrateo: true, cuentas, secuenciaResumen: 0
      };
      const pPrev = util.shiftPeriod(p0, -1);
      const emision = util.parseDate(firstOf(0));
      emision.setHours(10, 0, 0, 0);
      PLX.billing.computeAll(db, pPrev).forEach((res) => {
        db.config.secuenciaResumen += 1;
        db.resumenes.push({
          id: `rsm_${db.config.secuenciaResumen}`,
          numero: `RG-${pPrev.replace('-', '')}-${String(db.config.secuenciaResumen).padStart(4, '0')}`,
          periodo: pPrev,
          locatarioId: res.locatario.id,
          estado: 'emitido',
          version: 1,
          emitidoEn: emision.toISOString(),
          total: res.totales.total,
          snapshot: res
        });
      });
    }

    return db;
  }

  PLX.seed = seed;
})(window);
