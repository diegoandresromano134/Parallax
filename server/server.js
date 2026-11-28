#!/usr/bin/env node
/* ==========================================================================
   PARALLAX · Servidor
   ---------------------------------------------------------------------------
   Servidor web sin dependencias externas (solo Node.js 18 o superior):

   · Sirve el sitio público, el Panel de Gestoría y el Área de Miembros.
   · Usuarios con contraseña cifrada (scrypt) y sesión por cookie HttpOnly.
   · Base de datos en archivos JSON dentro de DATA_DIR (escritura atómica).
   · Archivos adjuntos (contratos firmados, documentación) en DATA_DIR/archivos.
   · Los miembros solo reciben sus propios datos (ver assets/js/core/scope.js).

   Uso:
     node server/server.js
   Variables de entorno:
     PORT                      Puerto (por defecto 3000)
     PARALLAX_DATA_DIR         Carpeta de datos (por defecto ./data)
     PARALLAX_ADMIN_USER       Usuario administrador inicial (por defecto «admin»)
     PARALLAX_ADMIN_PASSWORD   Contraseña inicial; si falta, se genera y se
                               muestra una sola vez en la consola.
     PARALLAX_COOKIE_SECURE    «1» para marcar la cookie como Secure (HTTPS).
   ========================================================================== */
'use strict';

// Hora de Buenos Aires para vencimientos, reservas y constancias de firma
process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { miembro: scopeMiembro } = require('../assets/js/core/scope.js');
const reglas = require('../assets/js/core/reglas.js');
const arca = require('./arca.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.PARALLAX_DATA_DIR || path.join(ROOT, 'data'));
const FILES_DIR = path.join(DATA_DIR, 'archivos');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USERS_FILE = path.join(DATA_DIR, 'usuarios.json');
const COOKIE = 'plx_sesion';
const SESSION_TTL = 12 * 3600 * 1000;
const COOKIE_SECURE = process.env.PARALLAX_COOKIE_SECURE === '1';
const MAX_JSON = 25 * 1024 * 1024;
const MAX_FILE = 15 * 1024 * 1024;

const COLLECTIONS = ['locatarios', 'planes', 'contratos', 'personas', 'accesos', 'insumos', 'consumos', 'consultas', 'resumenes', 'documentos', 'salas', 'reservas', 'pagos', 'facturas'];

/* ---------- Persistencia ---------- */
fs.mkdirSync(FILES_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function emptyDb() {
  const db = { version: 2, meta: { rev: 0, inicializado: false, creado: new Date().toISOString() }, config: null };
  COLLECTIONS.forEach((c) => (db[c] = []));
  return db;
}

let db = readJson(DB_FILE, null) || emptyDb();
COLLECTIONS.forEach((c) => { if (!Array.isArray(db[c])) db[c] = []; });
db.meta = Object.assign({ rev: 0 }, db.meta || {});
let users = readJson(USERS_FILE, []);

const saveDb = () => { db.meta.actualizado = new Date().toISOString(); writeJsonAtomic(DB_FILE, db); };
const saveUsers = () => writeJsonAtomic(USERS_FILE, users);

/* ---------- Contraseñas ---------- */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const a = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const publicUser = (u) => u && { id: u.id, usuario: u.usuario, rol: u.rol, locatarioId: u.locatarioId || null, nombre: u.nombre || '', activo: u.activo !== false, ultimoIngreso: u.ultimoIngreso || null };
const uid = (p) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

// Administrador inicial
if (!users.some((u) => u.rol === 'admin')) {
  const usuario = process.env.PARALLAX_ADMIN_USER || 'admin';
  const password = process.env.PARALLAX_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  users.push(Object.assign({ id: uid('usr'), usuario, rol: 'admin', nombre: 'Administración', activo: true, creadoEn: new Date().toISOString() }, hashPassword(password)));
  saveUsers();
  if (!process.env.PARALLAX_ADMIN_PASSWORD) {
    console.log('\n  Usuario administrador creado');
    console.log(`  Usuario:    ${usuario}`);
    console.log(`  Contraseña: ${password}`);
    console.log('  Guardala ahora y cambiala desde Configuración en el panel.\n');
  }
}

/* ---------- Sesiones ---------- */
const sessions = new Map(); // token → { userId, exp }
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, exp: Date.now() + SESSION_TTL });
  return token;
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  const s = token && sessions.get(token);
  if (!s || s.exp < Date.now()) { if (token) sessions.delete(token); return null; }
  const u = users.find((x) => x.id === s.userId && x.activo !== false);
  if (!u) return null;
  s.exp = Date.now() + SESSION_TTL; // renovación deslizante
  return u;
}
function cookieHeader(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
}
setInterval(() => { const now = Date.now(); sessions.forEach((s, k) => { if (s.exp < now) sessions.delete(k); }); }, 600000).unref();

/* ---------- Límite de intentos ---------- */
const attempts = new Map(); // clave → { n, until }
function limited(key, max, windowMs) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) { attempts.set(key, { n: 1, until: now + windowMs }); return false; }
  a.n += 1;
  return a.n > max;
}

/* ---------- HTTP ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, headers));
  res.end(body);
}
function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Parallax': 'servidor' }, headers));
}
const fail = (res, status, error) => json(res, status, { error });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('El contenido es demasiado grande.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  try {
    // Descarta claves peligrosas (contaminación de prototipos)
    return JSON.parse(buf.toString('utf8') || '{}', (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v));
  } catch (e) {
    throw Object.assign(new Error('JSON inválido.'), { status: 400 });
  }
}

/* ---------- Archivos estáticos ---------- */
const PAGES = new Set(['/index.html', '/gestoria.html', '/miembros.html', '/ingresar.html']);
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (!PAGES.has(pathname) && !pathname.startsWith('/assets/')) return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(path.join(ROOT, path.sep)) || file.includes(`${path.sep}.`)) return send(res, 403, 'Prohibido');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    };
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, headers));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- Operaciones de datos (solo administración) ---------- */
function applyOp(op) {
  if (!op || typeof op !== 'object') throw new Error('Operación inválida.');
  if (op.op === 'config') {
    if (!op.config || typeof op.config !== 'object') throw new Error('Configuración inválida.');
    db.config = op.config;
    return;
  }
  if (op.op === 'replace') {
    const nuevo = op.db;
    if (!nuevo || typeof nuevo !== 'object') throw new Error('Datos inválidos.');
    const rev = db.meta.rev;
    db = Object.assign(emptyDb(), nuevo);
    COLLECTIONS.forEach((c) => { if (!Array.isArray(db[c])) db[c] = []; });
    db.meta = Object.assign({}, nuevo.meta || {}, { rev, inicializado: true });
    return;
  }
  if (!COLLECTIONS.includes(op.col)) throw new Error('Colección inválida.');
  const list = db[op.col];
  if (op.op === 'insert') {
    if (!op.rec || typeof op.rec.id !== 'string') throw new Error('Registro inválido.');
    const i = list.findIndex((x) => x.id === op.rec.id);
    if (i >= 0) list[i] = op.rec; else list.push(op.rec);
  } else if (op.op === 'update') {
    const rec = list.find((x) => x.id === op.id);
    if (rec && op.patch && typeof op.patch === 'object') Object.assign(rec, op.patch);
  } else if (op.op === 'remove') {
    const i = list.findIndex((x) => x.id === op.id);
    if (i >= 0) {
      list.splice(i, 1);
      if (op.col === 'documentos') fs.rm(path.join(FILES_DIR, safeId(op.id)), { force: true }, () => {});
    }
  } else {
    throw new Error('Operación desconocida.');
  }
}
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

/* ---------- Rutas de la API ---------- */
async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api\//, '');
  const user = currentUser(req);
  const ip = req.socket.remoteAddress || '';
  const admin = user && user.rol === 'admin';

  // Estado y sesión
  if (p === 'estado' && req.method === 'GET') return json(res, 200, { servidor: true, usuario: publicUser(user) });

  if (p === 'ingresar' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const usuario = String(body.usuario || '').trim().toLowerCase();
    if (limited(`login:${ip}`, 20, 15 * 60000) || limited(`login:${usuario}`, 8, 15 * 60000)) {
      return fail(res, 429, 'Demasiados intentos. Esperá unos minutos y volvé a intentar.');
    }
    const u = users.find((x) => x.usuario.toLowerCase() === usuario);
    if (!u || u.activo === false || !verifyPassword(body.password, u)) return fail(res, 401, 'Usuario o contraseña incorrectos.');
    attempts.delete(`login:${usuario}`);
    u.ultimoIngreso = new Date().toISOString();
    saveUsers();
    return json(res, 200, { usuario: publicUser(u) }, { 'Set-Cookie': cookieHeader(createSession(u.id), SESSION_TTL / 1000) });
  }

  if (p === 'salir' && req.method === 'POST') {
    const token = parseCookies(req)[COOKIE];
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
  }

  // Consulta pública desde el sitio
  if (p === 'consultas' && req.method === 'POST') {
    if (limited(`consulta:${ip}`, 10, 60 * 60000)) return fail(res, 429, 'Recibimos muchas consultas desde tu conexión. Probá más tarde.');
    const b = await readJsonBody(req, 64 * 1024);
    const s = (v, n) => String(v || '').trim().slice(0, n);
    const consulta = {
      id: uid('cta'), nombre: s(b.nombre, 120), empresa: s(b.empresa, 120), email: s(b.email, 160), telefono: s(b.telefono, 40),
      interes: s(b.interes, 80), puestos: Number(b.puestos) || null, mensaje: s(b.mensaje, 2000),
      fecha: new Date().toISOString(), estado: 'nueva', origen: 'sitio', creadoEn: new Date().toISOString()
    };
    if (consulta.nombre.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(consulta.email) || consulta.mensaje.length < 10) {
      return fail(res, 400, 'Revisá los datos de la consulta.');
    }
    db.consultas.push(consulta);
    db.meta.rev += 1;
    saveDb();
    return json(res, 201, { consulta: { id: consulta.id } });
  }

  if (!user) return fail(res, 401, 'Iniciá sesión para continuar.');

  if (p === 'password' && req.method === 'POST') {
    const b = await readJsonBody(req);
    if (!verifyPassword(b.actual, user)) return fail(res, 400, 'La contraseña actual no es correcta.');
    if (String(b.nueva || '').length < 8) return fail(res, 400, 'La nueva contraseña debe tener al menos 8 caracteres.');
    Object.assign(user, hashPassword(b.nueva));
    saveUsers();
    return json(res, 200, { ok: true });
  }

  if (p === 'rev' && req.method === 'GET') return json(res, 200, { rev: db.meta.rev });

  if (p === 'datos' && req.method === 'GET') {
    if (admin) return json(res, 200, db);
    return json(res, 200, scopeMiembro(db, user.locatarioId));
  }

  // Área de Miembros
  if (p === 'miembro/perfil' && req.method === 'POST' && user.rol === 'miembro') {
    const b = await readJsonBody(req);
    const loc = db.locatarios.find((l) => l.id === user.locatarioId);
    if (!loc) return fail(res, 404, 'Legajo no encontrado.');
    const email = String(b.email || '').trim().slice(0, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'Ingresá un email válido.');
    loc.email = email;
    loc.telefono = String(b.telefono || '').trim().slice(0, 40);
    loc.actualizadoEn = new Date().toISOString();
    db.meta.rev += 1;
    saveDb();
    return json(res, 200, { ok: true });
  }
  if (p === 'miembro/solicitud' && req.method === 'POST' && user.rol === 'miembro') {
    if (limited(`solicitud:${user.id}`, 30, 60 * 60000)) return fail(res, 429, 'Enviaste muchas solicitudes. Probá más tarde.');
    const b = await readJsonBody(req, 64 * 1024);
    const loc = db.locatarios.find((l) => l.id === user.locatarioId) || {};
    const consulta = {
      id: uid('cta'), origen: 'miembro', locatarioId: user.locatarioId, nombre: loc.nombreComercial || user.nombre,
      empresa: loc.nombreComercial || '', email: loc.email || '', telefono: loc.telefono || '',
      tipo: String(b.tipo || '').slice(0, 80), interes: String(b.tipo || '').slice(0, 80),
      fechaDeseada: String(b.fechaDeseada || '').slice(0, 20), mensaje: String(b.mensaje || '').trim().slice(0, 2000),
      fecha: new Date().toISOString(), estado: 'nueva', creadoEn: new Date().toISOString()
    };
    if (consulta.mensaje.length < 5) return fail(res, 400, 'Contanos brevemente qué necesitás.');
    db.consultas.push(consulta);
    db.meta.rev += 1;
    saveDb();
    return json(res, 201, { consulta });
  }

  // Firma del contrato por el miembro
  const clientIp = String(req.headers['x-forwarded-for'] || ip).split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '').slice(0, 240);
  const ahoraIso = () => new Date().toISOString();
  const propioContrato = (id) => db.contratos.find((c) => c.id === id && c.locatarioId === user.locatarioId);

  if (p === 'miembro/contrato/visto' && req.method === 'POST' && user.rol === 'miembro') {
    const b = await readJsonBody(req);
    const c = propioContrato(b.contratoId);
    if (!c || !c.firma) return fail(res, 404, 'Contrato no encontrado.');
    c.firma = reglas.firma.registrarVista(c, { fecha: ahoraIso(), actor: user.usuario, ip: clientIp, ua });
    db.meta.rev += 1; saveDb();
    return json(res, 200, { firma: c.firma });
  }
  if (p === 'miembro/contrato/firmar' && req.method === 'POST' && user.rol === 'miembro') {
    if (limited(`firma:${user.id}`, 10, 15 * 60000)) return fail(res, 429, 'Demasiados intentos. Esperá unos minutos.');
    const b = await readJsonBody(req, 1024 * 1024);
    if (!verifyPassword(b.password, user)) return fail(res, 400, 'La contraseña no es correcta.');
    const c = propioContrato(b.contratoId);
    if (!c) return fail(res, 404, 'Contrato no encontrado.');
    try {
      c.firma = reglas.firma.firmarCliente(c, { nombre: b.nombre, dni: b.dni, imagen: typeof b.imagen === 'string' && b.imagen.length < 600000 ? b.imagen : null }, { fecha: ahoraIso(), actor: user.usuario, ip: clientIp, ua });
    } catch (e) { return fail(res, 400, e.message); }
    db.meta.rev += 1; saveDb();
    return json(res, 200, { firma: c.firma });
  }

  // Reservas de salas por el miembro
  if (p === 'miembro/reservas' && req.method === 'POST' && user.rol === 'miembro') {
    if (limited(`reserva:${user.id}`, 40, 60 * 60000)) return fail(res, 429, 'Hiciste muchas reservas seguidas. Probá más tarde.');
    const b = await readJsonBody(req);
    const d = { salaId: String(b.salaId || ''), fecha: String(b.fecha || ''), desde: String(b.desde || ''), hasta: String(b.hasta || ''), titulo: b.titulo, personas: b.personas, locatarioId: user.locatarioId };
    const err = reglas.reservas.validar(db, d, new Date());
    if (err) return fail(res, 400, err);
    const { reserva, consumo } = reglas.reservas.armar(db, d, { id: uid('rsv'), consumoId: uid('cns'), fecha: ahoraIso(), origen: 'miembro' });
    db.reservas.push(reserva);
    if (consumo) db.consumos.push(consumo);
    db.meta.rev += 1; saveDb();
    return json(res, 201, { reserva, consumo });
  }
  const mCancel = p.match(/^miembro\/reservas\/([a-zA-Z0-9_-]+)\/cancelar$/);
  if (mCancel && req.method === 'POST' && user.rol === 'miembro') {
    const r = db.reservas.find((x) => x.id === mCancel[1] && x.locatarioId === user.locatarioId);
    if (!r || r.estado === 'cancelada') return fail(res, 404, 'Reserva no encontrada.');
    const pol = reglas.reservas.cancelacion(db, r, new Date());
    if (pol.yaPaso) return fail(res, 400, 'La reserva ya comenzó; no se puede cancelar.');
    r.estado = 'cancelada';
    r.canceladaEn = ahoraIso();
    if (!pol.tarde) db.consumos = db.consumos.filter((c) => c.id !== r.consumoId);
    else { const cns = db.consumos.find((c) => c.id === r.consumoId); if (cns) cns.nota += ' · cancelada con menos de ' + pol.horas + ' h'; }
    db.meta.rev += 1; saveDb();
    return json(res, 200, { reserva: r, cargoMantenido: pol.tarde });
  }

  // Pagos informados por el miembro
  if (p === 'miembro/pagos' && req.method === 'POST' && user.rol === 'miembro') {
    if (limited(`pago:${user.id}`, 20, 60 * 60000)) return fail(res, 429, 'Probá más tarde.');
    const b = await readJsonBody(req);
    const importe = Number(b.importe);
    if (!(importe > 0)) return fail(res, 400, 'Indicá el importe pagado.');
    const resumen = db.resumenes.find((r) => r.id === b.resumenId && r.locatarioId === user.locatarioId);
    const pago = {
      id: uid('pag'), locatarioId: user.locatarioId, resumenId: resumen ? resumen.id : null, fecha: /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : reglas.util.hoyStr(),
      importe: Math.round(importe * 100) / 100, medio: String(b.medio || '').slice(0, 60), referencia: String(b.referencia || '').slice(0, 120),
      comprobanteId: db.documentos.some((d) => d.id === b.comprobanteId && d.locatarioId === user.locatarioId) ? b.comprobanteId : null,
      estado: 'informado', origen: 'miembro', creadoEn: ahoraIso()
    };
    db.pagos.push(pago);
    db.meta.rev += 1; saveDb();
    return json(res, 201, { pago });
  }
  if (p === 'miembro/archivos' && req.method === 'POST' && user.rol === 'miembro') {
    if (limited(`subida:${user.id}`, 20, 60 * 60000)) return fail(res, 429, 'Probá más tarde.');
    const buf = await readBody(req, 10 * 1024 * 1024);
    const doc = {
      id: uid('doc'), locatarioId: user.locatarioId, contratoId: null,
      nombre: String(url.searchParams.get('nombre') || 'comprobante').replace(/[\\/\r\n]/g, '_').slice(0, 160),
      tipo: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100), tamano: buf.length,
      categoria: 'Comprobante de pago', visibleMiembro: true, subidoPor: 'miembro', subidoEn: ahoraIso(), creadoEn: ahoraIso()
    };
    fs.writeFileSync(path.join(FILES_DIR, doc.id), buf);
    db.documentos.push(doc);
    db.meta.rev += 1; saveDb();
    return json(res, 201, { documento: doc });
  }

  // Archivos: lectura (administración o el miembro dueño)
  const mFile = p.match(/^archivos\/([a-zA-Z0-9_-]+)$/);
  if (mFile && req.method === 'GET') {
    const doc = db.documentos.find((d) => d.id === mFile[1]);
    if (!doc || (!admin && (doc.locatarioId !== user.locatarioId || doc.visibleMiembro === false))) return fail(res, 404, 'Archivo no encontrado.');
    const file = path.join(FILES_DIR, safeId(doc.id));
    if (!fs.existsSync(file)) return fail(res, 404, 'Archivo no encontrado.');
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
      'Content-Type': doc.tipo || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.nombre)}`,
      'Cache-Control': 'private, no-store'
    }));
    return fs.createReadStream(file).pipe(res);
  }

  if (!admin) return fail(res, 403, 'No tenés permiso para esta acción.');

  /* ----- Solo administración ----- */
  if (p === 'ops' && req.method === 'POST') {
    const b = await readJsonBody(req, MAX_JSON);
    if (!Array.isArray(b.ops)) return fail(res, 400, 'Operaciones inválidas.');
    const respaldo = JSON.stringify(db);
    try { b.ops.forEach(applyOp); } catch (e) { db = JSON.parse(respaldo); return fail(res, 400, e.message); }
    db.meta.rev += 1;
    saveDb();
    return json(res, 200, { rev: db.meta.rev });
  }

  if (p === 'usuarios' && req.method === 'GET') return json(res, 200, { usuarios: users.map(publicUser) });

  // Factura electrónica ARCA
  if (p === 'arca/estado' && req.method === 'GET') return json(res, 200, arca.estado());
  if (p === 'arca/facturar' && req.method === 'POST') {
    const b = await readJsonBody(req);
    const r = db.resumenes.find((x) => x.id === b.resumenId && x.estado === 'emitido');
    if (!r) return fail(res, 404, 'Resumen no encontrado.');
    if (db.facturas.some((f) => f.resumenId === r.id && f.estado === 'autorizada')) return fail(res, 400, 'Ese resumen ya tiene factura autorizada.');
    try {
      const factura = await arca.facturar(db, r, { id: uid('fac') });
      db.facturas.push(factura);
      db.meta.rev += 1; saveDb();
      return json(res, 201, { factura });
    } catch (e) {
      return fail(res, 502, `ARCA: ${e.message}`);
    }
  }

  if (p === 'usuarios' && req.method === 'POST') {
    const b = await readJsonBody(req);
    const usuario = String(b.usuario || '').trim();
    if (usuario.length < 3) return fail(res, 400, 'El usuario debe tener al menos 3 caracteres.');
    if (users.some((x) => x.usuario.toLowerCase() === usuario.toLowerCase() && x.id !== b.id)) return fail(res, 400, `El usuario «${usuario}» ya existe.`);
    if (b.password && String(b.password).length < 8) return fail(res, 400, 'La contraseña debe tener al menos 8 caracteres.');
    let u = b.id ? users.find((x) => x.id === b.id) : null;
    if (!u) {
      if (!b.password) return fail(res, 400, 'Definí una contraseña inicial.');
      u = { id: uid('usr'), creadoEn: new Date().toISOString() };
      users.push(u);
    }
    const rol = b.rol === 'admin' ? 'admin' : 'miembro';
    if (u.id === user.id && (rol !== 'admin' || b.activo === false)) return fail(res, 400, 'No podés quitarte el acceso de administración.');
    Object.assign(u, { usuario, rol, locatarioId: rol === 'miembro' ? String(b.locatarioId || '') : null, nombre: String(b.nombre || '').slice(0, 120), activo: b.activo !== false });
    if (b.password) Object.assign(u, hashPassword(b.password));
    if (u.activo === false) sessions.forEach((s, k) => { if (s.userId === u.id) sessions.delete(k); });
    saveUsers();
    return json(res, 200, { usuario: publicUser(u) });
  }

  const mUser = p.match(/^usuarios\/([a-zA-Z0-9_-]+)$/);
  if (mUser && req.method === 'DELETE') {
    if (mUser[1] === user.id) return fail(res, 400, 'No podés eliminar tu propio usuario.');
    users = users.filter((u) => u.id !== mUser[1]);
    sessions.forEach((s, k) => { if (s.userId === mUser[1]) sessions.delete(k); });
    saveUsers();
    return json(res, 200, { ok: true });
  }

  if (p === 'archivos' && req.method === 'POST') {
    const q = url.searchParams;
    const locatarioId = q.get('locatarioId');
    if (!db.locatarios.some((l) => l.id === locatarioId)) return fail(res, 400, 'Legajo inválido.');
    const buf = await readBody(req, MAX_FILE);
    const doc = {
      id: uid('doc'), locatarioId, contratoId: q.get('contratoId') || null,
      nombre: String(q.get('nombre') || 'archivo').replace(/[\\/\r\n]/g, '_').slice(0, 160),
      tipo: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100),
      tamano: buf.length, categoria: String(q.get('categoria') || 'Otro').slice(0, 60),
      visibleMiembro: q.get('visibleMiembro') !== '0', subidoEn: new Date().toISOString(), creadoEn: new Date().toISOString()
    };
    fs.writeFileSync(path.join(FILES_DIR, doc.id), buf);
    db.documentos.push(doc);
    db.meta.rev += 1;
    saveDb();
    return json(res, 201, { documento: doc });
  }
  if (mFile && req.method === 'DELETE') {
    const i = db.documentos.findIndex((d) => d.id === mFile[1]);
    if (i < 0) return fail(res, 404, 'Archivo no encontrado.');
    db.documentos.splice(i, 1);
    fs.rm(path.join(FILES_DIR, safeId(mFile[1])), { force: true }, () => {});
    db.meta.rev += 1;
    saveDb();
    return json(res, 200, { ok: true });
  }

  return fail(res, 404, 'Ruta no encontrada.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      // Protección CSRF básica: las escrituras deben venir del mismo origen
      if (req.method !== 'GET' && req.headers.origin) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (new URL(req.headers.origin).host !== host) return fail(res, 403, 'Origen no permitido.');
      }
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Error interno del servidor.');
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => {
  console.log(`PARALLAX en http://localhost:${PORT}  ·  datos en ${DATA_DIR}`);
});
