/* ==========================================================================
   PARALLAX · Capa de datos
   ---------------------------------------------------------------------------
   Base de datos documental persistida en localStorage del navegador.
   La interfaz pública (formulario de contacto) y el Panel de Gestoría
   comparten esta capa, de modo que las consultas enviadas desde el sitio
   aparecen en el panel (incluso en otra pestaña, vía evento «storage»).

   Para producción, reemplazar `read()` / `write()` por llamadas a una API
   propia: el resto del sistema consume solo los métodos públicos de `store`.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util } = PLX;

  const KEY = 'parallax.db.v1';
  const SCHEMA = 1;

  /* ---------- Constantes del dominio ---------- */
  const domain = {
    CATEGORIAS: [
      { id: 'utileria', nombre: 'Utilería', cuenta: '4.1.02' },
      { id: 'mobiliario', nombre: 'Mobiliario', cuenta: '4.1.03' },
      { id: 'papeleria', nombre: 'Papelería', cuenta: '4.1.04' },
      { id: 'otros', nombre: 'Otros insumos', cuenta: '4.1.05' },
      { id: 'servicios', nombre: 'Servicios adicionales', cuenta: '4.1.06' }
    ],
    CUENTA_ABONOS: '4.1.01',
    ESTADOS_CONTRATO: [
      { id: 'vigente', nombre: 'Vigente' },
      { id: 'suspendido', nombre: 'Suspendido' },
      { id: 'finalizado', nombre: 'Finalizado' }
    ],
    CONDICIONES_IVA: ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'],
    TIPOS_LOCATARIO: [
      { id: 'empresa', nombre: 'Empresa' },
      { id: 'profesional', nombre: 'Profesional independiente' }
    ],
    AJUSTES: ['Sin ajuste', 'Trimestral por IPC', 'Semestral por IPC', 'Anual por IPC', 'Según acuerdo de partes'],
    SERVICIOS_INCLUIDOS: [
      'Conectividad de fibra y Wi-Fi seguro',
      'Recepción y atención de visitas',
      'Recepción de correspondencia',
      'Domicilio comercial',
      'Limpieza y mantenimiento',
      'Café e infusiones',
      'Locker personal',
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
    catNombre(id) {
      const c = domain.CATEGORIAS.find((x) => x.id === id);
      return c ? c.nombre : id;
    }
  };

  /* ---------- Persistencia ---------- */
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
  const listeners = new Set();

  function emptyDb() {
    return {
      version: SCHEMA,
      meta: { seeded: false, creado: new Date().toISOString(), actualizado: new Date().toISOString() },
      config: defaultConfig(),
      locatarios: [],
      planes: [],
      contratos: [],
      personas: [],
      accesos: [],
      insumos: [],
      consumos: [],
      consultas: [],
      resumenes: []
    };
  }

  function defaultConfig() {
    const cuentas = { abonos: domain.CUENTA_ABONOS };
    domain.CATEGORIAS.forEach((c) => (cuentas[c.id] = c.cuenta));
    return {
      prestador: {
        nombre: 'PARALLAX',
        razonSocial: '',
        cuit: '',
        condicionIva: 'Responsable Inscripto',
        domicilio: '',
        email: ''
      },
      ivaAlicuota: 21,
      prorrateo: true,
      cuentas,
      secuenciaResumen: 0
    };
  }

  function read() {
    if (!storage) return null;
    try {
      return JSON.parse(storage.getItem(KEY));
    } catch (e) {
      return null;
    }
  }

  function persist() {
    mem.meta.actualizado = new Date().toISOString();
    if (!storage) return true;
    try {
      storage.setItem(KEY, JSON.stringify(mem));
      return true;
    } catch (e) {
      console.warn('[PARALLAX] No se pudo guardar en el navegador:', e);
      return false;
    }
  }

  function emit(source = 'local') {
    listeners.forEach((fn) => {
      try { fn(source); } catch (e) { console.error(e); }
    });
  }

  function migrate(db) {
    // Punto de extensión para futuras versiones del esquema.
    const base = emptyDb();
    Object.keys(base).forEach((k) => {
      if (db[k] == null) db[k] = base[k];
    });
    db.config = Object.assign(defaultConfig(), db.config || {});
    db.config.cuentas = Object.assign(defaultConfig().cuentas, db.config.cuentas || {});
    db.config.prestador = Object.assign(defaultConfig().prestador, db.config.prestador || {});
    return db;
  }

  /* ---------- API pública ---------- */
  const store = {
    KEY,
    persistent: !!storage,

    /**
     * Inicializa la base. `seed` (opcional) es una función que devuelve datos
     * de demostración; el panel la provee, el sitio público no.
     */
    init({ seed } = {}) {
      let db = read();
      if (!db || db.version !== SCHEMA) db = emptyDb();
      mem = migrate(db);
      if (seed && !mem.meta.seeded) {
        const keepConsultas = mem.consultas.slice();
        const seeded = migrate(seed());
        seeded.consultas = keepConsultas.concat(seeded.consultas);
        seeded.meta.seeded = true;
        mem = seeded;
      }
      persist();
      return mem;
    },

    get db() {
      if (!mem) store.init();
      return mem;
    },

    all(col) {
      return store.db[col];
    },
    get(col, id) {
      return store.db[col].find((x) => x.id === id) || null;
    },
    where(col, pred) {
      return store.db[col].filter(pred);
    },
    insert(col, obj, prefix) {
      const now = new Date().toISOString();
      const rec = Object.assign({ id: util.uid(prefix || col.slice(0, 3)), creadoEn: now }, obj);
      store.db[col].push(rec);
      persist();
      emit();
      return rec;
    },
    update(col, id, patch) {
      const rec = store.get(col, id);
      if (!rec) return null;
      Object.assign(rec, patch, { actualizadoEn: new Date().toISOString() });
      persist();
      emit();
      return rec;
    },
    remove(col, id) {
      const list = store.db[col];
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        persist();
        emit();
        return true;
      }
      return false;
    },
    /** Agrupa varias escrituras en una sola persistencia + notificación. */
    batch(fn) {
      fn(store.db);
      persist();
      emit();
    },

    config() {
      return store.db.config;
    },
    setConfig(patch) {
      const cfg = store.db.config;
      Object.keys(patch).forEach((k) => {
        if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
          cfg[k] = Object.assign({}, cfg[k], patch[k]);
        } else {
          cfg[k] = patch[k];
        }
      });
      persist();
      emit();
    },
    nextResumenNumero(periodo) {
      const cfg = store.db.config;
      cfg.secuenciaResumen = (cfg.secuenciaResumen || 0) + 1;
      return `RG-${periodo.replace('-', '')}-${String(cfg.secuenciaResumen).padStart(4, '0')}`;
    },

    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* ---------- Respaldo ---------- */
    exportJSON() {
      return JSON.stringify(store.db, null, 2);
    },
    importJSON(text) {
      const data = typeof text === 'string' ? JSON.parse(text) : text;
      if (!data || data.version !== SCHEMA || !Array.isArray(data.locatarios)) {
        throw new Error('El archivo no corresponde a un respaldo válido de PARALLAX.');
      }
      mem = migrate(data);
      mem.meta.seeded = true;
      persist();
      emit();
    },
    /** Restablece los datos de demostración. */
    reset(seed) {
      mem = migrate(seed ? seed() : emptyDb());
      mem.meta.seeded = true;
      persist();
      emit();
    },
    /** Deja la base lista para operación real: conserva configuración, modalidades y catálogo. */
    clearOperational() {
      const keep = { config: mem.config, planes: mem.planes, insumos: mem.insumos };
      mem = Object.assign(emptyDb(), keep);
      mem.config.secuenciaResumen = 0;
      mem.meta.seeded = true;
      persist();
      emit();
    }
  };

  // Sincronización entre pestañas (p. ej. consulta enviada desde el sitio público)
  root.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      mem = migrate(JSON.parse(e.newValue));
      emit('external');
    } catch (err) { /* ignorar */ }
  });

  PLX.domain = domain;
  PLX.store = store;
})(window);
