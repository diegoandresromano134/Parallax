/* ==========================================================================
   PARALLAX · Conexión con el servidor e inicio de sesión
   ---------------------------------------------------------------------------
   Detecta automáticamente el modo de funcionamiento:

   · SERVIDOR (server/server.js en marcha): usuarios con contraseña cifrada en
     el servidor, sesión por cookie segura, datos compartidos entre todos los
     dispositivos y archivos adjuntos guardados en el servidor.
   · DEMOSTRACIÓN (archivo abierto directamente o vista previa): todo queda en
     este navegador. El inicio de sesión es ilustrativo y NO es seguro.

   Las páginas solo usan los métodos de `PLX.backend`.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util, store } = PLX;

  const USERS_KEY = 'parallax.usuarios.v1';
  const SESSION_KEY = 'parallax.sesion.v1';
  const DEMO_ADMIN = { usuario: 'admin', password: 'parallax' };
  const DEMO_MIEMBRO_PASS = 'demo1234';

  /* ---------- Utilidades de red ---------- */
  async function api(path, opts = {}) {
    const init = Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: {} }, opts);
    if (opts.json !== undefined) {
      init.method = init.method || 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.json);
    }
    const r = await fetch(path, init);
    let data = null;
    const ct = r.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) data = await r.json();
    if (!r.ok) {
      const err = new Error((data && data.error) || `Error ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  /* ---------- Almacenamiento local seguro ---------- */
  const ls = {
    get(k) { try { return JSON.parse(root.localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { root.localStorage.removeItem(k); } catch (e) { /* nada */ } }
  };

  /* ---------- Hash de contraseñas en demostración (PBKDF2) ---------- */
  const enc = new TextEncoder();
  const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  async function hashPass(password, salt) {
    if (root.crypto && root.crypto.subtle) {
      const key = await root.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await root.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
      return toHex(bits);
    }
    // Sin WebCrypto (contexto inseguro): hash simple, solo para la demo
    let h = 2166136261;
    const s = `${salt}:${password}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `fnv-${(h >>> 0).toString(16)}`;
  }
  const newSalt = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const publicUser = (u) => u && { id: u.id, usuario: u.usuario, rol: u.rol, locatarioId: u.locatarioId || null, nombre: u.nombre || '', activo: u.activo !== false, ultimoIngreso: u.ultimoIngreso || null };

  /* ---------- Usuarios en modo demostración ---------- */
  const demoUsers = {
    all() { return ls.get(USERS_KEY) || []; },
    save(list) { ls.set(USERS_KEY, list); },
    async ensureSeed() {
      let list = demoUsers.all();
      if (!list.some((u) => u.rol === 'admin')) {
        const salt = newSalt();
        list.push({ id: util.uid('usr'), usuario: DEMO_ADMIN.usuario, rol: 'admin', nombre: 'Administración', salt, hash: await hashPass(DEMO_ADMIN.password, salt), activo: true, creadoEn: new Date().toISOString() });
      }
      // Un acceso de ejemplo por cada legajo de la demostración
      const db = store.db;
      for (const l of db.locatarios) {
        if (!l.numeroCliente || list.some((u) => u.locatarioId === l.id)) continue;
        const salt = newSalt();
        list.push({ id: util.uid('usr'), usuario: l.numeroCliente, rol: 'miembro', locatarioId: l.id, nombre: l.nombreComercial, salt, hash: await hashPass(DEMO_MIEMBRO_PASS, salt), activo: true, creadoEn: new Date().toISOString() });
      }
      demoUsers.save(list);
    },
    find(usuario) {
      const u = String(usuario || '').trim().toLowerCase();
      return demoUsers.all().find((x) => x.usuario.toLowerCase() === u) || null;
    }
  };

  /* ---------- Archivos en modo demostración (IndexedDB) ---------- */
  const idb = {
    open() {
      return new Promise((resolve, reject) => {
        if (!root.indexedDB) return reject(new Error('Este navegador no permite guardar archivos.'));
        const req = root.indexedDB.open('parallax-archivos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('archivos');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async put(id, blob) {
      const dbh = await idb.open();
      return new Promise((resolve, reject) => {
        const tx = dbh.transaction('archivos', 'readwrite');
        tx.objectStore('archivos').put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async get(id) {
      const dbh = await idb.open();
      return new Promise((resolve, reject) => {
        const req = dbh.transaction('archivos').objectStore('archivos').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },
    async del(id) {
      const dbh = await idb.open();
      return new Promise((resolve) => {
        const tx = dbh.transaction('archivos', 'readwrite');
        tx.objectStore('archivos').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  };

  /* ---------- Cola de operaciones hacia el servidor ---------- */
  function makeRemote(onError) {
    const queue = [];
    let busy = false;
    let retry = 0;
    async function flush() {
      if (busy || !queue.length) return;
      busy = true;
      const ops = queue.splice(0, queue.length);
      try {
        const r = await api('api/ops', { json: { ops } });
        store.db.meta.rev = r.rev;
        retry = 0;
      } catch (e) {
        if (e.status === 401) { root.location.href = 'ingresar.html?expirada=1'; return; }
        if (e.status === 400) { onError(e.message); }
        else {
          queue.unshift(...ops);
          retry = Math.min(retry + 1, 6);
          onError('Sin conexión con el servidor: los cambios se reintentarán automáticamente.');
          setTimeout(flush, 1500 * retry);
        }
      } finally {
        busy = false;
        if (queue.length && retry === 0) flush();
      }
    }
    return {
      send(op) { queue.push(op); Promise.resolve().then(flush); },
      pending: () => queue.length + (busy ? 1 : 0)
    };
  }

  function actualizarFirma(contratoId, firma) {
    const c = store.get('contratos', contratoId);
    if (!c) return;
    c.firma = firma;
    store.replaceAll(store.db);
  }

  /* ---------- API pública ---------- */
  const backend = {
    mode: null,     // 'servidor' | 'demo'
    user: null,
    DEMO_ADMIN,
    DEMO_MIEMBRO_PASS,
    get demo() { return backend.mode === 'demo'; },

    /** Detecta el modo y la sesión actual. */
    async detect() {
      if (backend.mode) return backend.mode;
      try {
        const r = await fetch('api/estado', { credentials: 'same-origin', cache: 'no-store' });
        if (r.ok && r.headers.get('X-Parallax') === 'servidor') {
          const j = await r.json();
          backend.mode = 'servidor';
          backend.user = j.usuario || null;
          return backend.mode;
        }
      } catch (e) { /* sin servidor */ }
      backend.mode = 'demo';
      const ses = ls.get(SESSION_KEY);
      if (ses && ses.exp > Date.now()) {
        const u = demoUsers.all().find((x) => x.id === ses.userId && x.activo !== false);
        backend.user = publicUser(u) || null;
      }
      return backend.mode;
    },

    /**
     * Prepara la página: detecta modo, exige rol (si se indica) y carga datos.
     * rol: 'admin' | 'miembro' | null. Redirige al ingreso si no corresponde.
     */
    async boot({ rol = null, seed = null, onSyncError = () => {} } = {}) {
      await backend.detect();
      if (backend.mode === 'demo') {
        store.init({ seed });
        await demoUsers.ensureSeed();
        if (rol && (!backend.user || backend.user.rol !== rol)) return backend.redirectLogin();
        return backend.user;
      }
      if (rol && (!backend.user || backend.user.rol !== rol)) return backend.redirectLogin();
      if (rol) {
        const data = await api('api/datos');
        store.init({ data, remote: rol === 'admin' ? makeRemote(onSyncError) : null });
        if (rol === 'admin' && !(data.config && data.config.inicializado)) {
          // Primera vez en el servidor: guarda la configuración base y las modalidades de abono,
          // sin tocar lo que ya exista (por ejemplo, consultas recibidas desde el sitio).
          store.setConfig({ inicializado: true });
          if (!store.all('planes').length && PLX.seedBase) PLX.seedBase().planes.forEach((p) => store.insert('planes', p));
        }
      }
      return backend.user;
    },

    redirectLogin() {
      const next = encodeURIComponent(root.location.pathname.split('/').pop() || 'index.html');
      root.location.href = `ingresar.html?siguiente=${next}`;
      return null;
    },

    async login(usuario, password) {
      await backend.detect();
      if (backend.mode === 'servidor') {
        const r = await api('api/ingresar', { json: { usuario, password } });
        backend.user = r.usuario;
        return r.usuario;
      }
      store.init({ seed: PLX.seed });
      await demoUsers.ensureSeed();
      const u = demoUsers.find(usuario);
      if (!u || u.activo === false || (await hashPass(password, u.salt)) !== u.hash) {
        throw new Error('Usuario o contraseña incorrectos.');
      }
      u.ultimoIngreso = new Date().toISOString();
      demoUsers.save(demoUsers.all().map((x) => (x.id === u.id ? u : x)));
      ls.set(SESSION_KEY, { userId: u.id, exp: Date.now() + 12 * 3600000 });
      backend.user = publicUser(u);
      return backend.user;
    },

    async logout() {
      if (backend.mode === 'servidor') {
        try { await api('api/salir', { method: 'POST' }); } catch (e) { /* igual se sale */ }
      } else {
        ls.del(SESSION_KEY);
      }
      backend.user = null;
      root.location.href = 'ingresar.html';
    },

    async changePassword(actual, nueva) {
      if (String(nueva || '').length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
      if (backend.mode === 'servidor') return api('api/password', { json: { actual, nueva } });
      const list = demoUsers.all();
      const u = list.find((x) => x.id === backend.user.id);
      if (!u || (await hashPass(actual, u.salt)) !== u.hash) throw new Error('La contraseña actual no es correcta.');
      u.salt = newSalt();
      u.hash = await hashPass(nueva, u.salt);
      demoUsers.save(list);
      return { ok: true };
    },

    /* ---------- Usuarios (solo administración) ---------- */
    users: {
      async list() {
        if (backend.mode === 'servidor') return (await api('api/usuarios')).usuarios;
        return demoUsers.all().map(publicUser);
      },
      /** Alta o modificación. data: { id?, usuario, password?, rol, locatarioId?, nombre?, activo } */
      async save(data) {
        const usuario = String(data.usuario || '').trim();
        if (usuario.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres.');
        if (data.password != null && data.password !== '' && String(data.password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        if (backend.mode === 'servidor') return (await api('api/usuarios', { json: data })).usuario;
        const list = demoUsers.all();
        const dup = list.find((x) => x.usuario.toLowerCase() === usuario.toLowerCase() && x.id !== data.id);
        if (dup) throw new Error(`El usuario «${usuario}» ya existe.`);
        let u = data.id ? list.find((x) => x.id === data.id) : null;
        if (!u) {
          if (!data.password) throw new Error('Definí una contraseña inicial.');
          u = { id: util.uid('usr'), creadoEn: new Date().toISOString() };
          list.push(u);
        }
        Object.assign(u, { usuario, rol: data.rol || 'miembro', locatarioId: data.locatarioId || null, nombre: data.nombre || '', activo: data.activo !== false });
        if (data.password) {
          u.salt = newSalt();
          u.hash = await hashPass(data.password, u.salt);
        }
        demoUsers.save(list);
        return publicUser(u);
      },
      async remove(id) {
        if (backend.user && id === backend.user.id) throw new Error('No podés eliminar tu propio usuario.');
        if (backend.mode === 'servidor') return api(`api/usuarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
        demoUsers.save(demoUsers.all().filter((u) => u.id !== id));
        return { ok: true };
      }
    },

    /** Contraseña aleatoria legible (sin caracteres ambiguos). */
    generarPassword(n = 10) {
      const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const buf = new Uint32Array(n);
      (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(buf) : buf.forEach((_, i) => (buf[i] = Math.random() * 1e9));
      return Array.from(buf, (x) => abc[x % abc.length]).join('');
    },

    /* ---------- Archivos adjuntos ---------- */
    files: {
      MAX: 15 * 1024 * 1024,
      async upload(file, meta) {
        if (file.size > backend.files.MAX) throw new Error('El archivo supera los 15 MB.');
        if (backend.mode === 'servidor') {
          const q = new URLSearchParams({
            locatarioId: meta.locatarioId, nombre: file.name, categoria: meta.categoria || 'Otro',
            contratoId: meta.contratoId || '', visibleMiembro: meta.visibleMiembro === false ? '0' : '1'
          });
          const rec = (await api(`api/archivos?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })).documento;
          store.applyRemote('documentos', rec);
          return rec;
        }
        const rec = {
          id: util.uid('doc'), locatarioId: meta.locatarioId, contratoId: meta.contratoId || null,
          nombre: file.name, tipo: file.type || 'application/octet-stream', tamano: file.size,
          categoria: meta.categoria || 'Otro', visibleMiembro: meta.visibleMiembro !== false,
          subidoEn: new Date().toISOString()
        };
        await idb.put(rec.id, file);
        store.insert('documentos', rec);
        return rec;
      },
      /** URL para ver o descargar el archivo. */
      async url(doc) {
        if (backend.mode === 'servidor') return `api/archivos/${encodeURIComponent(doc.id)}`;
        const blob = await idb.get(doc.id);
        if (!blob) throw new Error('El archivo no está disponible en este navegador.');
        return URL.createObjectURL(blob);
      },
      async remove(doc) {
        if (backend.mode === 'servidor') {
          await api(`api/archivos/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
          const list = store.all('documentos');
          const i = list.findIndex((d) => d.id === doc.id);
          if (i >= 0) list.splice(i, 1);
          store.replaceAll(store.db);
          return;
        }
        await idb.del(doc.id);
        store.remove('documentos', doc.id);
      }
    },

    /* ---------- Acciones del miembro ---------- */
    member: {
      async perfil(patch) {
        const p = { telefono: String(patch.telefono || '').trim(), email: String(patch.email || '').trim() };
        if (p.email && !util.isEmail(p.email)) throw new Error('Ingresá un email válido.');
        if (backend.mode === 'servidor') {
          await api('api/miembro/perfil', { json: p });
          Object.assign(store.get('locatarios', backend.user.locatarioId), p);
          store.replaceAll(store.db);
          return;
        }
        store.update('locatarios', backend.user.locatarioId, p);
      },
      async solicitud(data) {
        const rec = {
          tipo: data.tipo, mensaje: String(data.mensaje || '').trim(), fechaDeseada: data.fechaDeseada || '',
          nombre: backend.user.nombre, origen: 'miembro', locatarioId: backend.user.locatarioId,
          interes: data.tipo, estado: 'nueva', fecha: new Date().toISOString()
        };
        if (rec.mensaje.length < 5) throw new Error('Contanos brevemente qué necesitás.');
        if (backend.mode === 'servidor') {
          const r = await api('api/miembro/solicitud', { json: rec });
          store.applyRemote('consultas', r.consulta);
          return r.consulta;
        }
        const loc = store.get('locatarios', backend.user.locatarioId) || {};
        return store.insert('consultas', Object.assign(rec, { email: loc.email || '', empresa: loc.nombreComercial }), 'cta');
      }
    },

    /* ---------- Firma, reservas y pagos del miembro ---------- */
    contrato: {
      async visto(contratoId) {
        if (backend.mode === 'servidor') {
          try { const r = await api('api/miembro/contrato/visto', { json: { contratoId } }); actualizarFirma(contratoId, r.firma); } catch (e) { /* no bloquea */ }
          return;
        }
        const c = store.get('contratos', contratoId);
        if (!c || !c.firma) return;
        const f = PLX.reglas.firma.registrarVista(c, { fecha: new Date().toISOString(), actor: backend.user.usuario, ua: navigator.userAgent });
        if (f !== c.firma) store.update('contratos', c.id, { firma: f });
      },
      async firmar(contratoId, datos) {
        if (backend.mode === 'servidor') {
          const r = await api('api/miembro/contrato/firmar', { json: Object.assign({ contratoId }, datos) });
          actualizarFirma(contratoId, r.firma);
          return r.firma;
        }
        const u = demoUsers.all().find((x) => x.id === backend.user.id);
        if (!u || (await hashPass(datos.password, u.salt)) !== u.hash) throw new Error('La contraseña no es correcta.');
        const c = store.get('contratos', contratoId);
        if (!c || c.locatarioId !== backend.user.locatarioId) throw new Error('Contrato no encontrado.');
        const f = PLX.reglas.firma.firmarCliente(c, datos, { fecha: new Date().toISOString(), actor: backend.user.usuario, ip: null, ua: navigator.userAgent });
        store.update('contratos', c.id, { firma: f });
        return f;
      }
    },
    reservas: {
      async crear(d) {
        if (backend.mode === 'servidor') {
          const r = await api('api/miembro/reservas', { json: d });
          store.applyRemote('reservas', r.reserva);
          if (r.consumo) store.applyRemote('consumos', r.consumo);
          return r.reserva;
        }
        const datos = Object.assign({}, d, { locatarioId: backend.user.locatarioId });
        const err = PLX.reglas.reservas.validar(store.db, datos);
        if (err) throw new Error(err);
        const { reserva, consumo } = PLX.reglas.reservas.armar(store.db, datos, { id: util.uid('rsv'), consumoId: util.uid('cns'), fecha: new Date().toISOString(), origen: 'miembro' });
        if (consumo) store.insert('consumos', consumo);
        return store.insert('reservas', reserva);
      },
      async cancelar(id) {
        if (backend.mode === 'servidor') {
          const r = await api(`api/miembro/reservas/${encodeURIComponent(id)}/cancelar`, { method: 'POST' });
          store.applyRemote('reservas', r.reserva);
          if (!r.cargoMantenido) { const list = store.all('consumos'); const i = list.findIndex((c) => c.id === r.reserva.consumoId); if (i >= 0) list.splice(i, 1); store.replaceAll(store.db); }
          return r;
        }
        return backend.reservas.cancelarLocal(id);
      },
      /** Cancelación aplicando la política (usada también por administración). */
      cancelarLocal(id, { forzarSinCargo = false } = {}) {
        const r = store.get('reservas', id);
        const pol = PLX.reglas.reservas.cancelacion(store.db, r);
        if (pol.yaPaso && !forzarSinCargo) throw new Error('La reserva ya comenzó; no se puede cancelar.');
        store.update('reservas', id, { estado: 'cancelada', canceladaEn: new Date().toISOString() });
        const mantener = pol.tarde && !forzarSinCargo;
        if (!mantener && r.consumoId) store.remove('consumos', r.consumoId);
        else if (r.consumoId && store.get('consumos', r.consumoId)) store.update('consumos', r.consumoId, { nota: `${store.get('consumos', r.consumoId).nota} · cancelada con menos de ${pol.horas} h` });
        return { reserva: store.get('reservas', id), cargoMantenido: mantener };
      }
    },
    pagos: {
      /** El miembro informa un pago (con comprobante opcional). */
      async informar(d, archivo) {
        let comprobanteId = null;
        if (archivo) {
          if (archivo.size > 10 * 1024 * 1024) throw new Error('El comprobante supera los 10 MB.');
          if (backend.mode === 'servidor') {
            const q = new URLSearchParams({ nombre: archivo.name });
            const doc = (await api(`api/miembro/archivos?${q}`, { method: 'POST', body: archivo, headers: { 'Content-Type': archivo.type || 'application/octet-stream' } })).documento;
            store.applyRemote('documentos', doc);
            comprobanteId = doc.id;
          } else {
            const doc = { id: util.uid('doc'), locatarioId: backend.user.locatarioId, nombre: archivo.name, tipo: archivo.type, tamano: archivo.size, categoria: 'Comprobante de pago', visibleMiembro: true, subidoPor: 'miembro', subidoEn: new Date().toISOString() };
            await idb.put(doc.id, archivo);
            store.insert('documentos', doc);
            comprobanteId = doc.id;
          }
        }
        const pago = { resumenId: d.resumenId || null, fecha: d.fecha, importe: Number(d.importe), medio: d.medio, referencia: d.referencia || '', comprobanteId };
        if (!(pago.importe > 0)) throw new Error('Indicá el importe pagado.');
        if (backend.mode === 'servidor') {
          const r = await api('api/miembro/pagos', { json: pago });
          store.applyRemote('pagos', r.pago);
          return r.pago;
        }
        return store.insert('pagos', Object.assign(pago, { locatarioId: backend.user.locatarioId, estado: 'informado', origen: 'miembro' }), 'pag');
      }
    },

    /* ---------- Factura electrónica ARCA ---------- */
    arca: {
      async estado() {
        if (backend.mode === 'servidor') return api('api/arca/estado');
        return { configurado: false, simulacion: true, faltan: ['servidor'], entorno: 'simulacion' };
      },
      async facturar(resumenId) {
        if (backend.mode === 'servidor') {
          const r = await api('api/arca/facturar', { json: { resumenId } });
          store.applyRemote('facturas', r.factura);
          return r.factura;
        }
        // Simulación en modo demostración: muestra los datos que se enviarían, sin CAE
        const resumen = store.get('resumenes', resumenId);
        const f = PLX.reglas.factura.armar(store.db, resumen);
        return store.insert('facturas', Object.assign(f, { resumenId, locatarioId: resumen.locatarioId, puntoVenta: (store.config().facturacion || {}).puntoVenta || 1, numero: null, cae: null, caeVto: null, estado: 'simulada', entorno: 'simulacion' }), 'fac');
      }
    },

    /** Consulta pública del sitio. */
    async consulta(data) {
      await backend.detect();
      if (backend.mode === 'servidor') return (await api('api/consultas', { json: data })).consulta;
      store.init();
      return store.insert('consultas', data, 'cta');
    },

    /** Datos del miembro en modo demostración (mismo filtro que el servidor). */
    scopeDemo(locId) {
      return PLX.scope.miembro(store.db, locId);
    },

    /** Revisa si hay cambios en el servidor (otros dispositivos) y recarga. */
    async poll() {
      if (backend.mode !== 'servidor' || !backend.user) return false;
      try {
        const { rev } = await api('api/rev');
        if (rev !== store.db.meta.rev) {
          const data = await api('api/datos');
          store.replaceAll(data);
          return true;
        }
      } catch (e) {
        if (e.status === 401) root.location.href = 'ingresar.html?expirada=1';
      }
      return false;
    }
  };

  PLX.backend = backend;
})(window);
