/* ==========================================================================
   PARALLAX Suite · Registro de suscriptores (multi-tenant)
   ---------------------------------------------------------------------------
   Cada dueño de coworking que se suscribe es un «tenant»: tiene su propio
   espacio de datos (contratos, locatarios, consumos, resúmenes y facturas),
   su plan y el estado de su suscripción.

   · Landing (suite.html) y panel (suite-panel.html) comparten este registro.
   · Los datos de cada tenant viven bajo el prefijo `plxsaas.<id>.` del
     almacenamiento del navegador (ver PLX_NS en store.js y backend.js).
   · Es una DEMOSTRACIÓN: el registro, el inicio de sesión y el cobro de la
     suscripción son ilustrativos. En producción los resuelve un servidor
     con base de datos por tenant y una pasarela de pago.

   Debe cargarse ANTES que store.js / backend.js, porque define PLX_NS.
   ========================================================================== */
(function (root) {
  'use strict';

  const REG_KEY = 'plxsaas.registro.v1';
  const SES_KEY = 'plxsaas.sesion.v1';
  const TRIAL_DIAS = 14;
  const DAY = 86400000;

  const PLANES = {
    base: {
      id: 'base', nombre: 'Plan Base', usd: 0, ars: 0, maxAbonos: 5,
      incluye: ['Hasta 5 abonos de membresía', 'Gestoría básica en pantalla', 'Resumen con marca de agua'],
      limites: ['Sin exportación contable', 'Sin facturación AFIP', 'Historial de 3 meses', 'Sin marca propia']
    },
    ejecutivo: {
      id: 'ejecutivo', nombre: 'Plan Ejecutivo', usd: 15, ars: 20000, maxAbonos: Infinity,
      incluye: ['Locatarios ilimitados', 'Historial completo', 'Facturación AFIP activada', 'Exportación a Excel/CSV', 'Soporte y Asesoría técnica', 'Panel «White Label» con tu propio logo']
    }
  };

  /* ---------- Utilidades ---------- */
  const ls = {
    get(k) { try { return JSON.parse(root.localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { root.localStorage.removeItem(k); } catch (e) { /* nada */ } }
  };
  const iso = (d) => new Date(d).toISOString();
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diasHasta = (fecha) => Math.ceil((new Date(fecha).getTime() - today0()) / DAY);
  const uid = () => `t_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'coworking';

  async function hash(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    if (root.crypto && root.crypto.subtle) {
      const buf = await root.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261;
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 16777619); }
    return `fnv-${(h >>> 0).toString(16)}`;
  }

  /* ---------- Registro ---------- */
  const lista = () => ls.get(REG_KEY) || [];
  const guardar = (l) => ls.set(REG_KEY, l);

  const DEMOS = [
    { id: 't_parallax', nombre: 'Parallax Coworking', duenio: 'Administración Parallax', email: 'demo@parallax.example', plan: 'ejecutivo', estado: 'activa', cobroEn: 5, lite: false, nota: 'Tres unidades de negocio conviviendo en simultáneo' },
    { id: 't_nodo', nombre: 'Nodo Norte Cowork', duenio: 'Lucía Benítez', email: 'base@nodonorte.example', plan: 'base', estado: 'activa', cobroEn: null, lite: true, nota: 'Plan Base: hasta 5 abonos, resumen con marca de agua' },
    { id: 't_delta', nombre: 'Estudio Delta', duenio: 'Marcos Ibarra', email: 'trial@estudiodelta.example', plan: 'ejecutivo', estado: 'trial', trialEn: 3, lite: true, nota: 'Prueba gratuita: quedan pocos días' },
    { id: 't_faro', nombre: 'Faro Hub', duenio: 'Sofía Arce', email: 'impago@farohub.example', plan: 'ejecutivo', estado: 'impaga', cobroEn: -9, lite: true, nota: 'Suscripción impaga: Gestoría suspendida' }
  ];
  const DEMO_PASS = 'demo1234';

  async function ensureDemo() {
    let l = lista();
    let cambio = false;
    for (const d of DEMOS) {
      if (l.some((t) => t.id === d.id)) continue;
      const salt = uid();
      const t = {
        id: d.id, nombre: d.nombre, duenio: d.duenio, email: d.email, demo: true, lite: d.lite, nota: d.nota,
        plan: d.plan, estado: d.estado, salt, hash: await hash(DEMO_PASS, salt), creado: iso(Date.now() - 120 * DAY)
      };
      if (d.estado === 'trial') t.trialHasta = iso(today0() + d.trialEn * DAY);
      if (d.cobroEn != null) t.proximoCobro = iso(today0() + d.cobroEn * DAY);
      t.pagos = d.plan === 'ejecutivo' && d.estado !== 'trial'
        ? [1, 2, 3].map((n) => ({ id: `pg_${d.id}_${n}`, fecha: iso(today0() - (n * 30 - (d.cobroEn || 0)) * DAY), concepto: 'Suscripción Plan Ejecutivo', usd: 15, ars: 20000, medio: 'Tarjeta •••• 4242' }))
        : [];
      l.push(t);
      cambio = true;
    }
    if (cambio) guardar(l);
    return l;
  }

  /** Estado efectivo de la suscripción (la fuente de verdad del bloqueo). */
  function efectivo(t) {
    if (!t) return null;
    let estado = t.estado;
    let motivo = '';
    if (estado === 'trial' && diasHasta(t.trialHasta) < 0) { estado = 'impaga'; motivo = 'La prueba gratuita terminó.'; }
    if (estado === 'activa' && t.plan === 'ejecutivo' && t.proximoCobro && diasHasta(t.proximoCobro) < -3) { estado = 'impaga'; motivo = 'El cobro mensual no se acreditó.'; }
    if (estado === 'impaga' && !motivo) motivo = t.plan === 'ejecutivo' ? 'El cobro mensual no se acreditó.' : '';
    const diasTrial = t.estado === 'trial' ? Math.max(0, diasHasta(t.trialHasta)) : null;
    const diasCobro = t.proximoCobro ? diasHasta(t.proximoCobro) : null;
    // Durante la prueba se usan todas las funciones del Plan Ejecutivo
    const plan = estado === 'trial' ? 'ejecutivo' : t.plan;
    return {
      plan, planDef: PLANES[plan], planContratado: t.plan, estado, motivo, diasTrial, diasCobro,
      bloqueada: estado === 'impaga',
      avisoCobro: estado === 'activa' && t.plan === 'ejecutivo' && diasCobro != null && diasCobro <= 7
    };
  }

  /* ---------- Sesión ---------- */
  const sesion = () => {
    const s = ls.get(SES_KEY);
    return s && s.exp > Date.now() ? s : null;
  };
  const tenantActual = () => {
    const s = sesion();
    return s ? lista().find((t) => t.id === s.tenantId) || null : null;
  };
  const pub = (t) => t && { id: t.id, nombre: t.nombre, duenio: t.duenio, email: t.email, plan: t.plan, estado: t.estado, demo: !!t.demo, nota: t.nota || '' };

  function entrar(id) {
    ls.set(SES_KEY, { tenantId: id, exp: Date.now() + 12 * 3600000 });
  }

  async function ingresar(email, password) {
    const l = await ensureDemo();
    const e = String(email || '').trim().toLowerCase();
    const t = l.find((x) => x.email.toLowerCase() === e);
    if (!t || (await hash(password, t.salt)) !== t.hash) throw new Error('Email o contraseña incorrectos.');
    entrar(t.id);
    return t;
  }

  async function registrar({ coworking, duenio, email, password }) {
    const l = await ensureDemo();
    const e = String(email || '').trim().toLowerCase();
    if (!coworking || coworking.trim().length < 2) throw new Error('Ingresá el nombre de tu coworking.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Ingresá un email válido.');
    if (String(password || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (l.some((x) => x.email.toLowerCase() === e)) throw new Error('Ya existe una cuenta con ese email. Ingresá con tu contraseña.');
    const salt = uid();
    const t = {
      id: uid(), nombre: coworking.trim(), duenio: (duenio || '').trim() || coworking.trim(), email: e, demo: false, lite: false,
      plan: 'ejecutivo', estado: 'trial', trialHasta: iso(today0() + TRIAL_DIAS * DAY), salt, hash: await hash(password, salt),
      creado: iso(Date.now()), pagos: []
    };
    l.push(t);
    guardar(l);
    entrar(t.id);
    return t;
  }

  function actualizar(id, patch) {
    const l = lista();
    const t = l.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    guardar(l);
    return t;
  }

  /** Cobro simulado de la suscripción: deja la cuenta Activa y fija el próximo cobro. */
  function pagar(id, medio = 'Tarjeta •••• 4242') {
    const l = lista();
    const t = l.find((x) => x.id === id);
    if (!t) throw new Error('Cuenta inexistente.');
    t.plan = 'ejecutivo';
    t.estado = 'activa';
    delete t.trialHasta;
    t.proximoCobro = iso(today0() + 30 * DAY);
    t.pagos = [{ id: `pg_${Date.now().toString(36)}`, fecha: iso(Date.now()), concepto: 'Suscripción Plan Ejecutivo', usd: 15, ars: 20000, medio }].concat(t.pagos || []);
    guardar(l);
    return t;
  }

  function pasarABase(id) {
    return actualizar(id, { plan: 'base', estado: 'activa', trialHasta: null, proximoCobro: null });
  }

  /* ---------- Espacio de datos del tenant en curso ---------- */
  const actual = tenantActual();
  if (actual) root.PLX_NS = `plxsaas.${actual.id}`;

  /** Usuario de administración equivalente para el panel (sin contraseña propia por tenant). */
  function usuario() {
    const t = tenantActual();
    return t ? { id: `own_${t.id}`, usuario: t.email, rol: 'admin', locatarioId: null, nombre: t.duenio || t.nombre, activo: true, ultimoIngreso: null } : null;
  }

  function salir() {
    ls.del(SES_KEY);
    root.location.href = 'suite.html';
  }

  /** Borra los datos del tenant y vuelve a sembrarlos al abrir el panel. */
  function restablecerDatos(id) {
    try {
      const pref = `plxsaas.${id}.`;
      Object.keys(root.localStorage).filter((k) => k.indexOf(pref) === 0).forEach((k) => root.localStorage.removeItem(k));
    } catch (e) { /* nada */ }
  }

  root.PLX_SAAS = {
    PLANES, TRIAL_DIAS, DEMO_PASS, DEMOS, slug,
    lista, ensureDemo, efectivo, ingresar, registrar, actualizar, pagar, pasarABase, entrar, salir, usuario, restablecerDatos,
    sesion, tenant: tenantActual, publico: pub
  };
})(window);
