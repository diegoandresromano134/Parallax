// Avisos al celular (Web Push) sin dependencias externas.
// El servidor manda un "toque" vacío firmado con VAPID; el service worker pide el texto
// a /api/push/pull. Así no hace falta cifrar el contenido.
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function keys() {
  if (!getSetting('vapid_private')) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    setSetting('vapid_public', b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])));
    setSetting('vapid_private', JSON.stringify(privateKey.export({ format: 'jwk' })));
  }
  return { pub: getSetting('vapid_public'), priv: crypto.createPrivateKey({ key: JSON.parse(getSetting('vapid_private')), format: 'jwk' }) };
}
export const publicKey = () => keys().pub;

/** JWT ES256 que identifica al servidor ante el servicio de push (Apple, Google, Mozilla). */
export function vapidAuth(endpoint, now = Date.now()) {
  const { pub, priv } = keys();
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600,
    sub: process.env.PRODE_PUSH_SUBJECT || 'mailto:admin@prode.local',
  }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: priv, dsaEncoding: 'ieee-p1363' });
  return { header: `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`, jwt: `${head}.${body}.${b64u(sig)}`, pub };
}

export function enqueueForUser(userId, title, body) {
  const ins = db.prepare('INSERT INTO push_queue(endpoint, title, body) VALUES (?,?,?)');
  for (const s of db.prepare('SELECT endpoint FROM push_subs WHERE user_id=?').all(userId)) ins.run(s.endpoint, title, body);
}

/** Entrega los avisos pendientes de un dispositivo (los llama el service worker). */
export function pull(endpoint) {
  const rows = db.prepare('SELECT id, title, body FROM push_queue WHERE endpoint=? ORDER BY id').all(endpoint);
  db.prepare('DELETE FROM push_queue WHERE endpoint=?').run(endpoint);
  return rows;
}

/** Despierta a los dispositivos que tienen avisos sin entregar. */
export async function flush() {
  const pending = db.prepare('SELECT DISTINCT endpoint FROM push_queue WHERE pinged=0').all();
  for (const { endpoint } of pending) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { TTL: '3600', Urgency: 'high', Authorization: vapidAuth(endpoint).header, 'Content-Length': '0' },
      });
      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint);
        db.prepare('DELETE FROM push_queue WHERE endpoint=?').run(endpoint);
      } else if (res.ok) db.prepare('UPDATE push_queue SET pinged=1 WHERE endpoint=?').run(endpoint);
      else console.log('[push]', res.status, endpoint.slice(0, 50));
    } catch (e) { console.log('[push] error:', e.message); }
  }
  db.prepare("DELETE FROM push_queue WHERE created_at < datetime('now','-2 days')").run();
}

/** Avisa a quien todavía no jugó un partido que empieza en menos de ~90 minutos. */
export function queueReminders(now = Date.now()) {
  const rows = db.prepare(`SELECT DISTINCT mb.user_id, m.id AS match_id, m.home, m.away, m.kickoff
    FROM matches m JOIN competitions c ON c.id=m.comp_id AND c.enabled=1
    JOIN memberships mb ON 1=1
    JOIN push_subs ps ON ps.user_id=mb.user_id
    WHERE m.status='scheduled' AND m.kickoff > ? AND m.kickoff < ?
      AND NOT EXISTS (SELECT 1 FROM predictions p WHERE p.user_id=mb.user_id AND p.group_id=mb.group_id AND p.match_id=m.id)`)
    .all(new Date(now).toISOString(), new Date(now + 90 * 60e3).toISOString());
  let n = 0;
  for (const r of rows) {
    if (!db.prepare("INSERT OR IGNORE INTO notified(user_id, match_id, kind) VALUES (?,?,'remind')").run(r.user_id, r.match_id).changes) continue;
    const mins = Math.max(1, Math.round((new Date(r.kickoff) - now) / 60e3));
    enqueueForUser(r.user_id, 'Se cierra la jugada', `${r.home} vs ${r.away} empieza en ${mins} min y todavía no jugaste.`);
    n++;
  }
  return n;
}

export function startNotifier() {
  const tick = () => { try { queueReminders(); } catch (e) { console.log('[push]', e.message); } flush(); };
  setInterval(tick, 60 * 1000);
}
