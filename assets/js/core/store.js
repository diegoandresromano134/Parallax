/* ==========================================================================
   PARALLAX · Capa de datos
   ---------------------------------------------------------------------------
   Base documental compartida por el sitio público, el Panel de Gestoría y el
   Área de Miembros. Funciona en dos modos:

   · Demostración: los datos viven en el almacenamiento del navegador
     (localStorage). Sirve para probar sin servidor.
   · Servidor: los datos viven en el servidor (server/server.js). Cada cambio
     se envía como una operación (alta, modificación, baja) y el servidor la
     aplica sobre su base. Ver assets/js/core/backend.js.

   Las vistas solo usan los métodos públicos de `store`, en ambos modos.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util } = PLX;

  const KEY = 'parallax.db.v2';
  const SCHEMA = 2;
  const SEED_VERSION = 3; // sube cuando cambian los datos de demostración
  const COLLECTIONS = ['locatarios', 'planes', 'contratos', 'personas', 'accesos', 'insumos', 'consumos', 'consultas', 'resumenes', 'documentos', 'salas', 'reservas', 'pagos', 'facturas'];

  /* ---------- Constantes del dominio ---------- */
  const domain = {
    COLLECTIONS,
    CATEGORIAS: [
      { id: 'espacios', nombre: 'Espacios', cuenta: '4.1.07' },
      { id: 'utileria', nombre: 'Utilería y equipos', cuenta: '4.1.02' },
      { id: 'mobiliario', nombre: 'Mobiliario', cuenta: '4.1.03' },
      { id: 'papeleria', nombre: 'Papelería', cuenta: '4.1.04' },
      { id: 'otros', nombre: 'Otros insumos', cuenta: '4.1.05' },
      { id: 'servicios', nombre: 'Servicios y horas adicionales', cuenta: '4.1.06' }
    ],
    CUENTA_ABONOS: '4.1.01',
    TIPOS_RECURSO: [
      { id: 'unidad', nombre: 'Unidad numerada', ayuda: 'Se asigna o se presta y se devuelve: oficina, escritorio, computadora, locker.' },
      { id: 'consumible', nombre: 'Consumible', ayuda: 'Se entrega y no se devuelve: resmas, hojas, café.' },
      { id: 'tiempo', nombre: 'Por tiempo', ayuda: 'Se mide en horas o bloques: salas, horas adicionales, cochera.' }
    ],
    UNIDADES: ['unidad', 'hora', 'día', 'mes', 'resma', 'hoja', 'página', 'kg', 'bloque', 'envío', 'litro', 'caja'],
    ESTADOS_CONTRATO: [
      { id: 'vigente', nombre: 'Vigente' },
      { id: 'suspendido', nombre: 'Suspendido' },
      { id: 'finalizado', nombre: 'Finalizado' }
    ],
    ESTADOS_DEVOLUCION: [
      { id: 'ok', nombre: 'Devuelto completo' },
      { id: 'faltante', nombre: 'Faltante' },
      { id: 'danado', nombre: 'Con daños' }
    ],
    CATEGORIAS_DOC: ['Contrato firmado', 'Anexo o adenda', 'Documento de identidad', 'Constancia de CUIT', 'Otro'],
    CONDICIONES_IVA: ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'],
    TIPOS_LOCATARIO: [
      { id: 'profesional', nombre: 'Persona' },
      { id: 'empresa', nombre: 'Empresa' }
    ],
    AJUSTES: ['Sin ajuste', 'Trimestral por IPC', 'Semestral por IPC', 'Anual por IPC', 'Según acuerdo de partes'],
    SERVICIOS_INCLUIDOS: [
      'Conectividad de fibra y Wi-Fi seguro',
      'Recepción y atención de visitas',
      'Recepción de correspondencia',
      'Domicilio comercial',
      'Limpieza y mantenimiento',
      'Café e infusiones',
      'Asesoría administrativa',
      'Gestoría de trámites'
    ],
    INTERESES: [
      'Puesto Flexible',
      'Escritorio Dedicado',
      'Oficina Privada',
      'Suite Corporativa',
      'Salas de reuniones',
      'Asesoría y Gestoría',
      'Agendar una visita'
    ],
    MEDIOS_PAGO: [
      { id: 'transferencia', nombre: 'Transferencia bancaria', detalle: '', activo: true },
      { id: 'mercadopago', nombre: 'Mercado Pago', detalle: '', activo: true },
      { id: 'echeq', nombre: 'Echeq', detalle: '', activo: true },
      { id: 'efectivo', nombre: 'Efectivo en recepción', detalle: '', activo: true },
      { id: 'tarjeta', nombre: 'Tarjeta de débito o crédito', detalle: '', activo: false },
      { id: 'debito', nombre: 'Débito automático', detalle: '', activo: false }
    ],
    ESTADOS_PAGO: {
      confirmado: { nombre: 'Acreditado', tono: 'cyan' },
      informado: { nombre: 'Informado, a confirmar', tono: 'magenta' },
      rechazado: { nombre: 'Rechazado', tono: 'outline' }
    },
    TIPOS_SOLICITUD: ['Reserva de sala', 'Insumos', 'Equipamiento', 'Horas adicionales', 'Asesoría o Gestoría', 'Otra consulta'],
    catNombre(id) {
      const c = domain.CATEGORIAS.find((x) => x.id === id);
      return c ? c.nombre : id || '—';
    },
    tipoNombre(id) {
      const t = domain.TIPOS_RECURSO.find((x) => x.id === id);
      return t ? t.nombre : id || '—';
    }
  };

  /* ---------- Persistencia local ---------- */
  const storage = (() => {
    try {
      const k = '__plx_probe';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return root.localStorage;
    } catch (e) {
      return null; // modo privado / almacenamiento bloqueado → solo memoria
    }
  })();

  let mem = null;
  let remote = null; // { send(op) } en modo servidor
  const listeners = new Set();

  function defaultConfig() {
    const cuentas = { abonos: domain.CUENTA_ABONOS };
    domain.CATEGORIAS.forEach((c) => (cuentas[c.id] = c.cuenta));
    return {
      prestador: { nombre: 'PARALLAX', razonSocial: '', cuit: '', condicionIva: 'Responsable Inscripto', domicilio: '', email: '' },
      ivaAlicuota: 21,
      prorrateo: true,
      cuentas,
      secuenciaResumen: 0,
      secuenciaCliente: 0,
      cobros: {
        mediosPago: domain.MEDIOS_PAGO.map((m) => Object.assign({}, m)),
        banco: '', titular: '', cbu: '', alias: '',
        tasaMensual: 4, recargoFijo: 0, diasGracia: 3, diaVencimiento: 10, suspenderDias: 30
      },
      reservas: { apertura: '08:00', cierre: '20:00', paso: 30, maxHoras: 4, cancelacionHoras: 24, dias: [1, 2, 3, 4, 5, 6] },
      facturacion: { puntoVenta: 1, entorno: 'homologacion' }
    };
  }

  function emptyDb() {
    const db = {
      version: SCHEMA,
      meta: { seeded: false, creado: new Date().toISOString(), actualizado: new Date().toISOString(), rev: 0 },
      config: defaultConfig()
    };
    COLLECTIONS.forEach((c) => (db[c] = []));
    return db;
  }

  function migrate(db) {
    const base = emptyDb();
    Object.keys(base).forEach((k) => {
      if (db[k] == null) db[k] = base[k];
    });
    const def = defaultConfig();
    db.config = Object.assign(def, db.config || {});
    db.config.cuentas = Object.assign(defaultConfig().cuentas, db.config.cuentas || {});
    db.config.prestador = Object.assign(defaultConfig().prestador, db.config.prestador || {});
    db.config.cobros = Object.assign(defaultConfig().cobros, db.config.cobros || {});
    db.config.reservas = Object.assign(defaultConfig().reservas, db.config.reservas || {});
    db.config.facturacion = Object.assign(defaultConfig().facturacion, db.config.facturacion || {});
    db.meta = Object.assign({ rev: 0 }, db.meta || {});
    return db;
  }

  function read() {
    if (!storage) return null;
    try {
      return JSON.parse(storage.getItem(KEY));
    } catch (e) {
      return null;
    }
  }

  function persistLocal() {
    mem.meta.actualizado = new Date().toISOString();
    if (!storage) return true;
    try {
      storage.setItem(KEY, JSON.stringify(mem));
      return true;
    } catch (e) {
      console.warn('[PARALLAX] No se pudo guardar en el navegador:', e);
      emit('error');
      return false;
    }
  }

  function emit(source = 'local') {
    listeners.forEach((fn) => {
      try { fn(source); } catch (e) { console.error(e); }
    });
  }

  /** Registra un cambio: en servidor lo envía como operación; en demo lo guarda localmente. */
  function commit(op) {
    if (remote) remote.send(op);
    else persistLocal();
    emit();
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- API pública ---------- */
  const store = {
    KEY,
    SCHEMA,
    get persistent() { return !!remote || !!storage; },
    get remote() { return !!remote; },

    /**
     * Inicializa la base.
     * · { data, remote }: datos provistos por el servidor y canal de operaciones.
     * · { seed }: en modo demostración, función que genera datos de ejemplo.
     */
    init({ seed, data, remote: r } = {}) {
      if (data) {
        mem = migrate(data);
        remote = r || null;
        return mem;
      }
      let db = read();
      if (!db || db.version !== SCHEMA) db = emptyDb();
      mem = migrate(db);
      const demoViejo = mem.meta.demo && (mem.meta.seedVersion || 2) < SEED_VERSION;
      if (seed && (!mem.meta.seeded || demoViejo)) {
        const keepConsultas = mem.consultas.slice();
        mem = migrate(seed());
        mem.consultas = keepConsultas.concat(mem.consultas);
        mem.meta.seeded = true;
      }
      persistLocal();
      return mem;
    },

    get db() {
      if (!mem) store.init();
      return mem;
    },

    all(col) { return store.db[col]; },
    get(col, id) { return store.db[col].find((x) => x.id === id) || null; },
    where(col, pred) { return store.db[col].filter(pred); },

    insert(col, obj, prefix) {
      const rec = Object.assign({ id: util.uid(prefix || col.slice(0, 3)), creadoEn: new Date().toISOString() }, obj);
      store.db[col].push(rec);
      commit({ op: 'insert', col, rec: clone(rec) });
      return rec;
    },
    update(col, id, patch) {
      const rec = store.get(col, id);
      if (!rec) return null;
      const p = Object.assign({}, patch, { actualizadoEn: new Date().toISOString() });
      Object.assign(rec, p);
      commit({ op: 'update', col, id, patch: clone(p) });
      return rec;
    },
    remove(col, id) {
      const list = store.db[col];
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      commit({ op: 'remove', col, id });
      return true;
    },

    /** Inserta un registro que el servidor ya guardó (p. ej. un archivo subido). */
    applyRemote(col, rec) {
      const list = store.db[col];
      const i = list.findIndex((x) => x.id === rec.id);
      if (i >= 0) list[i] = rec;
      else list.push(rec);
      if (!remote) persistLocal();
      emit();
    },
    /** Reemplaza toda la base con datos frescos del servidor. */
    replaceAll(data) {
      mem = migrate(data);
      emit('external');
    },

    config() { return store.db.config; },
    setConfig(patch) {
      const cfg = store.db.config;
      Object.keys(patch).forEach((k) => {
        if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) cfg[k] = Object.assign({}, cfg[k], patch[k]);
        else cfg[k] = patch[k];
      });
      commit({ op: 'config', config: clone(cfg) });
    },
    nextResumenNumero(periodo) {
      const n = (store.db.config.secuenciaResumen || 0) + 1;
      store.setConfig({ secuenciaResumen: n });
      return `RG-${periodo.replace('-', '')}-${String(n).padStart(4, '0')}`;
    },
    nextNumeroCliente() {
      const usados = store.db.locatarios.map((l) => Number(String(l.numeroCliente || '').replace(/\D/g, '')) || 0);
      const n = Math.max(store.db.config.secuenciaCliente || 0, ...usados, 0) + 1;
      store.setConfig({ secuenciaCliente: n });
      return `CL-${String(n).padStart(4, '0')}`;
    },

    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* ---------- Respaldo y reinicios ---------- */
    exportJSON() { return JSON.stringify(store.db, null, 2); },
    importJSON(text) {
      const data = typeof text === 'string' ? JSON.parse(text) : text;
      if (!data || data.version !== SCHEMA || !Array.isArray(data.locatarios)) {
        throw new Error('El archivo no corresponde a un respaldo válido de PARALLAX (versión 2).');
      }
      store.replace(data);
    },
    replace(data) {
      const rev = mem ? mem.meta.rev : 0;
      mem = migrate(clone(data));
      mem.meta.seeded = true;
      mem.meta.rev = rev;
      commit({ op: 'replace', db: clone(mem) });
    },
    reset(seed) { store.replace(seed ? seed() : emptyDb()); },
    /** Deja la base lista para operar: conserva configuración, modalidades e inventario. */
    clearOperational() {
      const keep = { config: clone(mem.config), planes: clone(mem.planes), insumos: clone(mem.insumos) };
      const db = Object.assign(emptyDb(), keep);
      db.config.secuenciaResumen = 0;
      db.config.secuenciaCliente = 0;
      store.replace(db);
    },
    emptyDb
  };

  // Sincronización entre pestañas en modo demostración
  root.addEventListener('storage', (e) => {
    if (remote || e.key !== KEY || !e.newValue) return;
    try {
      mem = migrate(JSON.parse(e.newValue));
      emit('external');
    } catch (err) { /* ignorar */ }
  });

  PLX.domain = domain;
  PLX.store = store;
})(window);
