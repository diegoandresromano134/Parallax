'use strict';
// PRODE Amigos — app de una sola página, sin dependencias.

const $app = document.getElementById('app');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* modo privado */ } },
};
const S = {
  token: store.get('token'), me: null, groups: [], gid: Number(store.get('gid')) || null, cfg: { min_age: 16, colors: ['#f5c542'] },
  tab: 'matches', authMode: 'login', scope: 'upcoming', comp: '', comps: [], matches: [], loading: false,
  rank: { mode: 'coins', comp: '', round: '' }, adminPending: 0, pots: { rounds: [], champs: [], jackpot: null, commission_pct: 20 }, shown: {}, tableComp: '', plays: {}, threads: {}, notif: 'unknown', admin: null, members: [],
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Argentina/Buenos_Aires';
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const fmtAgo = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'ahora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const group = () => S.groups.find((g) => g.id === S.gid);
const CH = { green: { icon: '🟢', name: 'verdes', field: 'coins' }, red: { icon: '🔴', name: 'rojas', field: 'red_coins' }, gold: { icon: '🟡', name: 'doradas', field: 'gold_coins' } };
const n$ = (n) => '$' + Number(n || 0).toLocaleString('es-AR'); // pesos ficticios
const toPot = (fee, pct) => fee - Math.round((fee * (pct ?? 20)) / 100); // lo que de cada inscripción va al pozo
const REDUCE = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Cambia un contador con una animación corta de cuenta y un destello. */
function setCount(el, to, money = true) {
  const from = el.dataset.v === undefined ? to : Number(el.dataset.v), isN = el.dataset.f === 'n';
  const fmt = (v) => (isN ? `${Math.round(v)} ${Math.round(v) === 1 ? 'anotado' : 'anotados'}` : money ? n$(v) : String(Math.round(v)));
  el.dataset.v = to;
  if (from === to || REDUCE) { el.textContent = fmt(to); return; }
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 700); el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = fmt(to); };
  requestAnimationFrame(step);
}
const live = (kind, comp, round, field, value) => `<b class="cnt" data-live="${kind}" data-c="${comp}" data-r="${esc(round || '')}" data-f="${field}" data-v="${value}">${field === 'pot' ? n$(value) : `${value} ${value === 1 ? 'anotado' : 'anotados'}`}</b>`;
const bal = (color) => group()?.[CH[color].field] || 0;
const colorSelect = (id, cur = 'green') => `<select class="field" id="${id}">${Object.entries(CH).map(([k, c]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${c.icon} Fichas ${c.name}</option>`).join('')}</select>`;

let toastTimer;
function toast(msg, error) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 2800);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: `Bearer ${S.token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { endSession(); throw new Error('Tu sesión venció, volvé a ingresar'); }
  if (!res.ok) throw new Error(data.error || 'Error de conexión');
  return data;
}
const gq = () => `group=${S.gid}`;
function endSession() { S.token = null; S.me = null; S.groups = []; store.set('token', null); render(); }
function applyBundle(b) {
  S.me = b.user; S.groups = b.groups; S.adminPending = b.admin_pending || 0;
  if (!group()) S.gid = S.groups[0]?.id ?? null;
  store.set('gid', S.gid);
}

// ---------- piezas ----------
const FALLBACK = '#2d6a57';
function avatar(u, size = 34) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  return u.avatar ? `<img class="av" style="${st}" src="${esc(u.avatar)}" alt="">`
    : `<span class="av" style="${st};background:${esc(u.color || FALLBACK)}">${esc((u.nick || '?')[0].toUpperCase())}</span>`;
}
const swatches = (name, cur) => `<div class="swatches">${S.cfg.colors.map((c) =>
  `<label><input type="radio" name="${name}" value="${c}" ${c === cur ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}</div>`;
const badge = (url, name) => url ? `<img src="${esc(url)}/tiny" alt="" loading="lazy" onerror="this.outerHTML='<div class=ph>${esc(name[0])}</div>'">` : `<div class="ph">${esc(name[0])}</div>`;
const pickName = (m, k) => (k === 'L' ? m.home : k === 'V' ? m.away : 'Empate');
const field = (label, name, type = 'text', extra = '') => `<label>${label}</label><input class="field" name="${name}" type="${type}" ${extra}>`;

// ---------- ingreso / registro ----------
function renderAuth() {
  document.documentElement.style.removeProperty('--accent');
  const reg = S.authMode === 'register';
  const d = new Date(); d.setFullYear(d.getFullYear() - S.cfg.min_age);
  const maxBirth = d.toISOString().slice(0, 10);
  $app.innerHTML = `<div class="auth">
    <h1>⚽ PRODE Amigos</h1><p class="sub">Pronósticos y fichas ficticias entre amigos. Sin plata de verdad.</p>
    <div class="seg" style="margin-top:20px"><button data-auth="login" class="${reg ? '' : 'on'}">Ingresar</button><button data-auth="register" class="${reg ? 'on' : ''}">Crear cuenta</button></div>
    <form id="authForm" autocomplete="on" novalidate>
      ${reg ? `<div class="two"><div>${field('Nombre', 'first_name', 'text', 'maxlength=40 required autocomplete=given-name')}</div><div>${field('Apellido', 'last_name', 'text', 'maxlength=40 required autocomplete=family-name')}</div></div>
        ${field('Apodo (así te ven los demás)', 'nick', 'text', 'maxlength=20 required')}` : ''}
      ${field('Mail', 'email', 'email', 'required autocomplete=email inputmode=email autocapitalize=none')}
      ${reg ? field(`Fecha de nacimiento (mínimo ${S.cfg.min_age} años)`, 'birth_date', 'date', `required max="${maxBirth}" autocomplete=bday`) : ''}
      ${field('Contraseña' + (reg ? ' (8 o más, con letras y números)' : ''), 'password', 'password', `required autocomplete=${reg ? 'new-password' : 'current-password'}`)}
      ${reg ? `${field('Repetí la contraseña', 'password2', 'password', 'required autocomplete=new-password')}
        ${field('Equipo del que sos hincha (opcional)', 'fav_team', 'text', 'maxlength=40')}
        ${field('Código de grupo (opcional, si ya te invitaron)', 'code', 'text', 'maxlength=12 autocapitalize=characters')}
        <label class="check"><input type="checkbox" name="accept"><span>Tengo ${S.cfg.min_age} años o más y entiendo que es un juego entre amigos con fichas ficticias, sin dinero real.</span></label>` : ''}
      <div class="err" id="authErr"></div>
      <button class="primary" type="submit">${reg ? 'Crear cuenta' : 'Entrar'}</button>
      ${reg ? '' : '<p class="help center">¿Olvidaste tu contraseña? Pedile a quien creó tu grupo que te genere una clave temporal.</p>'}
    </form></div>`;
}

function renderOnboarding() {
  $app.innerHTML = `<div class="auth"><h1>¡Hola, ${esc(S.me.nick)}!</h1><p class="sub">Para jugar necesitás estar en un grupo. Unite con un código o creá uno nuevo.</p>
    ${groupForms()}<button class="ghost block" data-act="logout">Cerrar sesión</button></div>`;
}
function groupForms() {
  return `<div class="box"><h3>Unirme con un código</h3><div class="inline two"><input class="field" id="joinCode" placeholder="Código del grupo" maxlength="12" autocapitalize="characters"><button class="primary nomargin" data-act="join">Unirme</button></div></div>
    <div class="box"><h3>Crear un grupo nuevo</h3><input class="field" id="newGroupName" placeholder="Nombre (ej: Los pibes)" maxlength="30">${swatches('newGroupColor', S.cfg.colors[0])}
    <button class="primary" data-act="createGroup">Crear grupo</button></div>`;
}

// ---------- estructura principal ----------
const JK = [['green', '🟢', 'g'], ['red', '🔴', 'r'], ['gold', '🟡', 'y']];
function potCounters(jp) {
  return `<div class="pots" title="Pozos acumulados en vivo (lo que aportó cada inscripción)"><span class="pl">POZOS</span>${JK.map(([k, ic, c]) => `<span class="pt ${c}">${ic}<b class="cnt" id="hp-${k}" data-v="${S.shown[k] ?? jp?.[k]?.pot ?? 0}">${n$(S.shown[k] ?? jp?.[k]?.pot ?? 0)}</b></span>`).join('')}</div>`;
}
function paintHeaderPots(jp) {
  if (!jp) return;
  for (const [k] of JK) { const el = document.getElementById('hp-' + k); if (el) setCount(el, jp[k].pot); S.shown[k] = jp[k].pot; }
}
function shell(inner) {
  const g = group();
  document.documentElement.style.setProperty('--accent', g?.color || S.cfg.colors[0]);
  let tabs = [['matches', '⚽', 'Partidos'], ['ranking', '🏆', 'Ranking'], ['tables', '📊', 'Tablas'], ['group', '👥', 'Grupo'], ['profile', '👤', 'Perfil']];
  if (!g) tabs = [];
  if (S.me.is_admin) tabs.push(['admin', '🛠️', 'Admin']);
  if (!g) tabs.push(['profile', '👤', 'Perfil']);
  const badge = (k) => (k === 'admin' && S.adminPending ? `<i class="dot">${S.adminPending}</i>` : '');
  const head = g
    ? `<div class="toprow"><div class="gsel">${S.groups.length > 1 ? `<select id="groupSel" aria-label="Grupo">${S.groups.map((x) => `<option value="${x.id}" ${x.id === S.gid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<h1>${esc(g.name)}</h1>`}</div>${potCounters(S.pots.jackpot)}</div>
       <button class="wallets" data-tab="group" title="Tus fichas en este grupo. Tocá para pedir más o canjear."><span class="wl">Mis fichas</span>
         <span class="w g">🟢 ${n$(g.coins)}</span><span class="w r">🔴 ${n$(g.red_coins)}</span><span class="w y">🟡 ${n$(g.gold_coins)}</span></button>`
    : `<div class="toprow"><div class="gsel"><h1>🛠️ Panel de control</h1></div>${potCounters(S.pots.jackpot)}</div>`;
  $app.innerHTML = `<header class="top">${head}</header><main>${inner}</main>
    <nav class="tabs">${tabs.map(([k, i, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><span>${i}${badge(k)}</span>${l}</button>`).join('')}</nav>`;
  paintHeaderPots(S.pots.jackpot);
}

// ---------- partidos ----------
function matchCard(m) {
  const mine = m.mine || {}, g = group();
  const live = m.status === 'live' ? '<span class="live">● EN JUEGO</span>' : m.status === 'postponed' ? '<span class="live">POSTERGADO</span>' : `${fmtTime(m.kickoff)} hs`;
  const header = `<div class="meta"><span>${esc(m.comp)}${m.round ? ' · ' + esc(m.round) : ''}</span><span>${live}</span></div>`;
  const team = (n, b) => `<div class="team">${badge(b, n)}<span>${esc(n)}</span></div>`;
  const footer = `<div class="foot"><button class="ghost" data-act="chat">💬 Comentarios${m.comments ? ` (${m.comments})` : ''}</button>${m.locked || m.status === 'finished' ? '<button class="ghost" data-act="plays">Jugadas del grupo</button>' : ''}</div>
    <div class="plays" data-box="plays" hidden></div><div class="thread" data-box="thread" hidden></div>`;
  const teams = (mid) => `<div class="teams">${team(m.home, m.home_badge)}${mid}${team(m.away, m.away_badge)}</div>`;
  // resumen de lo que pronosticó el jugador
  const mineLines = (done) => {
    const l = [];
    if (mine.pick) l.push(`🟢 Tu ganador: <b>${esc(pickName(m, mine.pick))}</b>${done ? (mine.points === 1 ? ' → <span class="win">¡acertaste!</span>' : mine.points === 0 ? ' → <span class="lose">no acertaste</span>' : '') : ''}`);
    if (mine.prediction) l.push(`🔴 Tu marcador: <b>${mine.prediction.home}-${mine.prediction.away}</b>${done ? (mine.exact === 1 ? ' → <span class="win">¡exacto!</span>' : mine.exact === 0 ? ' → <span class="lose">no fue exacto</span>' : '') : ''}`);
    return l.length ? l : [m.enrolled ? 'No pronosticaste este partido' : 'No participaste en esta fecha'];
  };

  if (m.status === 'finished' || m.status === 'cancelled') {
    return `<article class="card" data-id="${m.id}">${header}${teams(`<div class="score final">${m.status === 'cancelled' ? 'Susp.' : `${m.home_goals} - ${m.away_goals}`}</div>`)}<div class="result">${mineLines(true).map((x) => `<div>${x}</div>`).join('')}</div>${footer}</article>`;
  }
  if (m.locked) {
    return `<article class="card" data-id="${m.id}">${header}${teams(`<div class="score final">${m.home_goals ?? '·'} - ${m.away_goals ?? '·'}</div>`)}
      <div class="result"><div>🔒 Cerrado.</div>${mineLines(false).map((x) => `<div>${x}</div>`).join('')}</div>${footer}</article>`;
  }
  if (!m.enrolled) {
    const r = S.pots.rounds.find((x) => x.comp_id === m.comp_id && x.round === m.round), fee = m.fee, falta = fee - g.coins;
    const cta = !r ? '<div class="help">La inscripción a esta fecha todavía no está disponible.</div>'
      : !r.can_join ? '<div class="help">La fecha ya empezó: no se puede anotar.</div>'
      : falta > 0 ? `<div class="help"><b>Te faltan ${n$(falta)} fichas verdes 🟢</b> para anotarte (${n$(fee)}). Sin fichas no se puede jugar: <button class="link" data-tab="group">pedile fichas al admin</button>.</div>`
      : `<button class="primary" data-join="${m.comp_id}" data-round="${esc(m.round)}">${fee ? `Anotarme a la fecha (${n$(fee)} 🟢)` : 'Anotarme (gratis)'}</button>`;
    return `<article class="card" data-id="${m.id}">${header}${teams('<div class="score final">- : -</div>')}
      <div class="help" style="text-align:center">🔒 Para pronosticar quién gana en todos los partidos de esta fecha tenés que anotarte con fichas verdes.</div>${cta}${footer}</article>`;
  }
  const sel = mine.pick, p = mine.prediction;
  const pk = (k) => `<button class="pick ${sel === k ? 'on' : ''}" data-pick="${k}">${esc(pickName(m, k))}</button>`;
  const goals = m.red_enrolled
    ? `<div class="redgoals"><span>🔴 Goles exactos</span><div class="score"><input name="h" type="number" inputmode="numeric" min="0" max="30" value="${p?.home ?? ''}" placeholder="-" aria-label="Goles ${esc(m.home)}"><span>:</span><input name="a" type="number" inputmode="numeric" min="0" max="30" value="${p?.away ?? ''}" placeholder="-" aria-label="Goles ${esc(m.away)}"></div></div>`
    : '<div class="help">🔴 Para pronosticar los goles exactos, anotate al pozo de goles de la fecha (arriba).</div>';
  return `<article class="card" data-id="${m.id}">${header}${teams('<div class="score final">vs</div>')}
    <div class="help" style="margin:10px 0 4px">🟢 ¿Quién gana?</div><div class="picks">${['L', 'E', 'V'].map(pk).join('')}</div>${goals}
    <button class="primary" data-act="save">Guardar pronóstico</button>
    <div class="help">${mine.pick ? 'Podés cambiarlo hasta que empiece el partido. ' : ''}Gana el pozo verde quien acierta más ganadores de la fecha.</div>${footer}</article>`;
}

function roundStrip(r) {
  const pct = S.pots.commission_pct, who = r.board.filter((b) => b.payout > 0).map((b) => esc(b.nick)).join(' y ');
  const stat = `pozo ${live('g', r.comp_id, r.round, 'pot', r.pot)} · ${live('g', r.comp_id, r.round, 'n', r.players)}`;
  let body;
  if (r.settled) body = who ? `🏆 Ganó <b>${who}</b> el pozo de ${n$(r.pot)} 🟢${r.board.find((b) => b.user_id === S.me.id)?.payout > 0 ? ' · <span class="win">¡Fue tuyo!</span>' : ''}` : 'Fecha cerrada · se devolvieron las inscripciones';
  else if (r.joined) body = `🟢 Estás en la fecha · ${stat} ${r.can_join ? `<button class="link" data-leave="${r.comp_id}" data-round="${esc(r.round)}">Salir</button>` : `<small>(${r.finished}/${r.matches} partidos)</small>`}`;
  else if (r.can_join) body = `🟢 Fecha: ${stat} <button class="mini-btn" data-join="${r.comp_id}" data-round="${esc(r.round)}">Anotarme (${n$(r.fee)} 🟢)</button><small class="share">${n$(toPot(r.fee, pct))} al pozo</small>`;
  else body = `🟢 Fecha: ${stat} · inscripción cerrada`;
  return `<div class="strip green">${body}</div>${redStrip(r)}`;
}
function redStrip(r) {
  const x = r.red; if (!x) return '';
  const pct = S.pots.commission_pct, win = x.board.filter((b) => b.payout > 0).map((b) => esc(b.nick)).join(' y ');
  const stat = `pozo de goles ${live('r', r.comp_id, r.round, 'pot', x.pot)}${x.carry ? ` <small>(incluye ${n$(x.carry)} acumulados)</small>` : ''} · ${live('r', r.comp_id, r.round, 'n', x.players)}`;
  let body;
  if (r.settled) body = win ? `🔴 Pozo de goles: ganó <b>${win}</b>` : `🔴 Pozo de goles: nadie acertó los goles exactos${x.carry ? ` · <b>${n$(x.carry)}</b> pasan a la próxima fecha, el resto se lo quedó la casa` : ''}`;
  else if (x.joined) body = `🔴 Estás en el ${stat} ${r.can_join ? `<button class="link" data-leavered="${r.comp_id}" data-round="${esc(r.round)}">Salir</button>` : ''}`;
  else if (x.can_join) body = `🔴 ${stat.replace('pozo de goles', 'Pozo de goles')} <button class="mini-btn red" data-joinred="${r.comp_id}" data-round="${esc(r.round)}">Anotarme (${n$(x.fee)} 🔴)</button><small class="share">${n$(toPot(x.fee, pct))} al pozo</small>`;
  else if (!r.joined) return '';
  else body = `🔴 ${stat} · inscripción cerrada`;
  return `<div class="strip red">${body}</div>`;
}
function champStrip(c) {
  const pct = S.pots.commission_pct;
  const stat = `pozo ${live('c', c.comp_id, '', 'pot', c.pot)} · ${live('c', c.comp_id, '', 'n', c.players)}`;
  const opts = (cur) => `<select class="field team-sel" data-champsel="${c.comp_id}">${cur ? '' : '<option value="">Elegí al campeón</option>'}${c.teams.map((t) => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  let body;
  if (c.closed) body = `🟡 Campeón: <b>${esc(c.champion)}</b>${c.joined ? (c.picks.find((p) => p.nick === S.me.nick)?.payout > 0 ? ' · <span class="win">¡Acertaste!</span>' : ' · no acertaste') : ''}`;
  else if (c.joined) body = `🟡 Tu campeón: <b>${esc(c.my_pick)}</b> · ${stat}${c.open ? ` · cambiar: ${opts(c.my_pick)}<button class="mini-btn gold" data-champ="${c.comp_id}">Cambiar</button>` : ''}`;
  else if (c.open) body = `🟡 ¿Quién sale campeón? ${stat} ${opts('')}<button class="mini-btn gold" data-champ="${c.comp_id}">Elegir (${n$(c.fee)} 🟡)</button><small class="share">${n$(toPot(c.fee, pct))} al pozo</small>`;
  else body = `🟡 Campeón: ${stat} · inscripción cerrada`;
  return `<div class="strip gold">${body}</div>`;
}

/** Actualiza en el lugar los contadores de cada fecha y torneo cuando cambian los anotados. */
function applyLive(pots) {
  document.querySelectorAll('[data-live]').forEach((el) => {
    const { live: k, c, r, f } = el.dataset;
    const round = pots.rounds.find((x) => String(x.comp_id) === c && x.round === r);
    const obj = k === 'g' ? round : k === 'r' ? round?.red : pots.champs.find((x) => String(x.comp_id) === c);
    if (obj) setCount(el, f === 'pot' ? obj.pot : obj.players, f === 'pot');
  });
}
async function refreshPots() {
  if (!S.token || !S.me || document.hidden) return;
  try {
    const jp = group() ? null : S.me.is_admin ? { jackpot: await api('GET', '/api/admin/jackpot') } : null;
    if (group()) { const pots = await api('GET', `/api/groups/${S.gid}/pots`); S.pots = pots; paintHeaderPots(pots.jackpot); applyLive(pots); }
    else if (jp) { S.pots.jackpot = jp.jackpot; paintHeaderPots(jp.jackpot); }
  } catch { /* sin conexión: se reintenta */ }
}
setInterval(refreshPots, 8000);

function renderMatches() {
  const chips = [['', 'Todos'], ...S.comps.map((c) => [String(c.id), c.name])];
  const g = group();
  let html = g.coins < 1 ? `<div class="notice"><b>No tenés fichas verdes 🟢.</b> Sin fichas no podés participar en ningún torneo. <button class="link" data-tab="group">Pedile fichas al admin</button>.</div>` : '';
  html += `<div class="seg"><button data-scope="upcoming" class="${S.scope === 'upcoming' ? 'on' : ''}">Próximos</button><button data-scope="results" class="${S.scope === 'results' ? 'on' : ''}">Resultados</button></div>
    <div class="chips">${chips.map(([id, n]) => `<button class="chip ${S.comp === id ? 'on' : ''}" data-comp="${id}">${esc(n)}</button>`).join('')}</div>`;
  if (S.loading && !S.matches.length) html += '<div class="empty">Cargando…</div>';
  else if (!S.matches.length) html += `<div class="empty">${S.scope === 'upcoming' ? 'No hay partidos próximos.' : 'Todavía no hay resultados.'}<br><span class="help">${S.me.is_admin ? 'Entrá a Admin y tocá “Actualizar fixture”.' : 'El administrador tiene que cargar los torneos.'}</span></div>`;
  else {
    let last = '', lastRound = '';
    const seenCups = new Set();
    for (const m of S.matches) {
      const k = dayKey(m.kickoff);
      if (k !== last) { html += `<h2 class="day">${esc(fmtDay(m.kickoff))}</h2>`; last = k; }
      if (m.round && `${m.comp_id}|${m.round}` !== lastRound) {
        lastRound = `${m.comp_id}|${m.round}`;
        const r = S.pots.rounds.find((x) => x.comp_id === m.comp_id && x.round === m.round);
        if (r) html += `<div class="roundhead">${esc(m.comp)} · ${esc(m.round)}</div>${roundStrip(r)}`;
      }
      if (!seenCups.has(m.comp_id)) {
        seenCups.add(m.comp_id);
        const c = S.pots.champs.find((x) => x.comp_id === m.comp_id);
        if (c) html += champStrip(c);
      }
      html += matchCard(m);
    }
  }
  shell(html);
  // reabrir lo que estaba abierto
  for (const id of Object.keys(S.threads)) { const c = cardEl(id); if (c) paintThread(c, id); }
  for (const id of Object.keys(S.plays)) { const c = cardEl(id); if (c) paintPlays(c, id); }
}
const cardEl = (id) => document.querySelector(`.card[data-id="${id}"]`);

async function loadMatches() {
  if (!S.gid) return;
  S.loading = true;
  try {
    const q = new URLSearchParams({ scope: S.scope, group: S.gid }); if (S.comp) q.set('comp', S.comp);
    const [matches, comps, me, pots] = await Promise.all([api('GET', `/api/matches?${q}`), api('GET', '/api/competitions'), api('GET', '/api/me'), api('GET', `/api/groups/${S.gid}/pots`)]);
    S.matches = matches; S.comps = comps; S.pots = pots; applyBundle(me);
  } catch (e) { toast(e.message, true); }
  S.loading = false;
  if (S.tab === 'matches' && !document.activeElement?.matches?.('input, textarea')) renderMatches();
}

function paintPlays(card, id) {
  const box = card.querySelector('[data-box=plays]'), rows = S.plays[id], m = S.matches.find((x) => x.id === Number(id)); if (!rows) return;
  const mark = (v, ok) => (v == null ? '' : v === ok ? ' ✅' : ' ❌');
  box.innerHTML = rows.length ? rows.map((r) => `<div><span class="who">${avatar(r, 20)} ${esc(r.nick)}</span><span>${r.pick ? `🟢 ${esc(pickName(m, r.pick))}${mark(r.points, 1)}` : ''}${r.home != null ? ` · 🔴 ${r.home}-${r.away}${mark(r.exact, 1)}` : ''}</span></div>`).join('') : '<div>Nadie pronosticó este partido</div>';
  box.hidden = false;
}
function paintThread(card, id) {
  const box = card.querySelector('[data-box=thread]'), items = S.threads[id]; if (!items) return;
  box.innerHTML = `${items.length ? items.map((c) => `<div class="msg">${avatar(c, 26)}<div><b>${esc(c.nick)}</b> <small>${fmtAgo(c.created_at)}</small>${c.user_id === S.me.id || group()?.is_owner ? ` <button class="x" data-del="${c.id}" aria-label="Borrar">✕</button>` : ''}<br>${esc(c.body)}</div></div>`).join('') : '<div class="help">Todavía no hay comentarios. ¡Mandá la primera cargada!</div>'}
    <form class="msgform" data-id="${id}"><input class="field" name="body" maxlength="280" placeholder="Escribí un comentario" autocomplete="off"><button class="primary nomargin" type="submit">Enviar</button></form>`;
  box.hidden = false;
}

// ---------- ranking ----------
const rankSeg = (mode) => `<div class="seg"><button data-rank="coins" class="${mode === 'coins' ? 'on' : ''}">🪙 Fichas</button><button data-rank="points" class="${mode === 'points' ? 'on' : ''}">🎯 Aciertos</button><button data-rank="prizes" class="${mode === 'prizes' ? 'on' : ''}">💰 Premios</button></div>`;
function board(rows, showPrize) {
  return `<table class="std"><thead><tr><th>#</th><th>Jugador</th><th>Ganadores acertados</th>${showPrize ? '<th>Premio</th>' : ''}</tr></thead><tbody>
    ${rows.map((b, i) => `<tr class="${b.user_id === S.me.id ? 'me' : ''}"><td>${i + 1}</td><td><span class="who">${avatar(b, 24)}<span>${esc(b.nick)}</span></span></td><td>${b.pts}${b.total ? ` / ${b.total}` : ''}</td>${showPrize ? `<td>${b.payout > 0 ? `<span class="win">+${n$(b.payout)}</span>` : b.payout === 0 ? '—' : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
async function renderPrizes() {
  shell(`${rankSeg('prizes')}<div class="empty">Cargando…</div>`);
  const pots = await api('GET', `/api/groups/${S.gid}/pots`); S.pots = pots;
  const rounds = pots.rounds.filter((r) => r.players > 0 || r.can_join).sort((a, b) => (a.settled - b.settled) || a.first_kickoff.localeCompare(b.first_kickoff));
  const redBoard = (rows, paid) => `<table class="std"><thead><tr><th>#</th><th>Jugador</th><th>Ganadores</th><th>Exactos</th>${paid ? '<th>Premio</th>' : ''}</tr></thead><tbody>
    ${rows.map((b, i) => `<tr class="${b.user_id === S.me.id ? 'me' : ''}"><td>${i + 1}</td><td><span class="who">${avatar(b, 24)}<span>${esc(b.nick)}</span></span></td><td>${b.pts}/${b.total} ${b.eligible ? '✅' : '✖'}</td><td>${b.exact}</td>${paid ? `<td>${b.payout > 0 ? `<span class="win">+${n$(b.payout)}</span>` : '—'}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  const html = `${rankSeg('prizes')}
    <div class="box"><h3>Cómo se gana</h3><p class="help">
      <b>🟢 Verdes:</b> te anotás a una fecha o ronda y pronosticás <b>quién gana</b> en todos sus partidos. Gana el pozo verde quien acierta más ganadores.<br>
      <b>🔴 Rojas:</b> inscripción aparte para el pozo de <b>goles</b> de esa fecha (hay que estar en verde). Pronosticás el marcador exacto. Para llevártelo tenés que haber acertado también la mayoría de los ganadores y tener marcadores exactos. Si nadie lo logra, la mitad del pozo queda acumulada para la fecha siguiente y la otra mitad se la queda la casa.<br>
      <b>🟡 Doradas:</b> elegís al campeón del torneo. El pozo se reparte entre quienes aciertan; si nadie acierta, se lo queda la casa.<br>
      Cada color es una billetera aparte y cada pozo se paga en su color. Todo son <b>pesos ficticios</b>: cada inscripción vale ${n$(5000)} y de cada una, ${n$(toPot(5000, pots.commission_pct))} van al pozo y ${n$(5000 - toPot(5000, pots.commission_pct))} quedan para el admin. Podés canjear fichas por premios en la pestaña Grupo.</p></div>
    ${pots.champs.map((c) => `<div class="box"><h3>🟡 ${esc(c.comp)} · campeón</h3>${champStrip(c).replace('class="strip gold"', 'class="strip gold flat"')}
      ${c.closed && c.picks.length ? `<table class="std"><thead><tr><th>Jugador</th><th>Eligió</th><th>Premio</th></tr></thead><tbody>${c.picks.map((p) => `<tr><td><span class="who">${avatar(p, 24)}<span>${esc(p.nick)}</span></span></td><td>${esc(p.pick)}</td><td>${p.payout > 0 ? `<span class="win">+${n$(p.payout)}</span>` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="help">Las elecciones de los demás se ven cuando se cierra el campeonato. Lo cierra el admin.</p>'}</div>`).join('')}
    ${rounds.length ? rounds.map((r) => `<div class="box"><h3>${esc(r.comp)} · ${esc(r.round)}</h3>${roundStrip(r).replace('class="strip green"', 'class="strip green flat"').replace('class="strip red"', 'class="strip red flat"')}
      ${r.board.length ? `<p class="help" style="margin:4px 0">🟢 Ganadores acertados</p>${board(r.board, r.settled)}` : ''}
      ${r.red.board.length ? `<p class="help" style="margin:10px 0 4px">🔴 Pozo de goles (✅ = acertó la mayoría de los ganadores)</p>${redBoard(r.red.board, r.settled)}` : ''}</div>`).join('') : '<div class="empty">No hay fechas con pozo por ahora.</div>'}`;
  shell(html);
}

async function renderRanking() {
  if (S.rank.mode === 'prizes') return renderPrizes();
  shell('<div class="empty">Cargando…</div>');
  const R = S.rank, q = new URLSearchParams(); if (R.comp) q.set('comp', R.comp); if (R.round) q.set('round', R.round);
  const [{ filtered, players }, comps] = await Promise.all([api('GET', `/api/groups/${S.gid}/ranking?${q}`), api('GET', '/api/competitions')]);
  S.comps = comps;
  const rounds = comps.find((c) => String(c.id) === R.comp)?.rounds || [];
  const byPts = R.mode === 'points';
  const val = (p) => (byPts ? p.points : filtered ? p.net : p.coins);
  const sorted = [...players].sort((a, b) => byPts ? b.points - a.points || b.exact - a.exact || b.net - a.net : val(b) - val(a) || b.points - a.points);
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  shell(`${rankSeg(byPts ? 'points' : 'coins')}
    <div class="inline two"><select class="field" id="rkComp"><option value="">Todos los torneos</option>${comps.map((c) => `<option value="${c.id}" ${String(c.id) === R.comp ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <select class="field" id="rkRound" ${rounds.length ? '' : 'disabled'}><option value="">Todas las fechas</option>${rounds.map((r) => `<option ${r === R.round ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    <table><thead><tr><th>#</th><th>Jugador</th><th>${byPts ? 'Aciertos' : filtered ? 'Neto' : 'Fichas'}</th><th>${byPts ? 'Exactos' : 'Aciert.'}</th></tr></thead><tbody>
    ${sorted.map((p, i) => `<tr class="${p.id === S.me.id ? 'me' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td>
      <td><span class="who">${avatar(p, 28)}<span>${esc(p.nick)}${p.fav_team ? `<small>${esc(p.fav_team)}</small>` : ''}</span></span></td>
      <td>${byPts ? p.points : filtered ? `<span class="${p.net > 0 ? 'win' : p.net < 0 ? 'lose' : ''}">${sign(p.net)}</span>` : p.coins.toLocaleString('es-AR')}</td><td>${byPts ? p.exact : p.points}</td></tr>`).join('')}</tbody></table>
    <p class="help">${filtered ? 'Con un filtro se ve lo ganado o perdido en esa fecha o torneo. Elegí un torneo y una fecha para saber quién ganó la semana.' : 'Las fichas las carga el administrador a pedido. Aciertos: partidos en los que acertaste quién gana. Exactos: marcadores exactos (🔴). “Fichas” y “Neto” son de las verdes.'}</p>`);
}

// ---------- tablas ----------
async function renderTables() {
  shell('<div class="empty">Cargando…</div>');
  S.comps = await api('GET', '/api/competitions');
  if (!S.tableComp || !S.comps.some((c) => String(c.id) === S.tableComp)) S.tableComp = String(S.comps[0]?.id || '');
  let body = '<div class="empty">No hay torneos cargados.</div>';
  if (S.tableComp) {
    const t = await api('GET', `/api/competitions/${S.tableComp}/standings`);
    body = t.rows.length ? `<table class="std"><thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead><tbody>
      ${t.rows.map((r) => `<tr><td>${r.pos}</td><td>${esc(r.team)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.points}</b></td></tr>`).join('')}</tbody></table>
      <p class="help">${t.computed ? 'Tabla calculada con los resultados cargados en la app. Puede no coincidir con la oficial.' : 'Tabla oficial.'}</p>` : '<div class="empty">Todavía no hay resultados para armar la tabla.</div>';
  }
  shell(`<div class="chips">${S.comps.map((c) => `<button class="chip ${String(c.id) === S.tableComp ? 'on' : ''}" data-tcomp="${c.id}">${esc(c.name)}</button>`).join('')}</div>${body}`);
}

// ---------- grupo ----------
async function renderGroup() {
  const g = group();
  shell('<div class="empty">Cargando…</div>');
  const members = await api('GET', `/api/groups/${g.id}/members`);
  const share = `${location.origin}/?codigo=${g.code}`;
  const [reqs, rewards, reds] = await Promise.all([api('GET', `/api/groups/${g.id}/coin-requests`), api('GET', '/api/rewards'), api('GET', `/api/groups/${g.id}/redemptions`)]);
  const rst = { pending: '⏳ Pendiente de entrega', delivered: '✅ Entregado', rejected: '↩️ Devuelto' };
  const st = { pending: '⏳ Esperando al admin', approved: '✅ Aprobado', rejected: '❌ No aprobado' };
  shell(`<div class="box"><h3>Mis fichas</h3>
      <div class="walletbox"><div class="w g"><b>🟢 ${n$(g.coins)}</b><small>Verdes · inscripción a fechas</small></div><div class="w r"><b>🔴 ${n$(g.red_coins)}</b><small>Rojas · pozo de goles</small></div><div class="w y"><b>🟡 ${n$(g.gold_coins)}</b><small>Doradas · campeón</small></div></div>
      <p class="help">Cada color es una billetera aparte. Las fichas las carga solo el administrador, a pedido: decile qué color y cuántas querés.</p>
      <form id="reqForm"><div class="inline">${colorSelect('reqColor')}<div class="inline two"><input class="field" name="amount" type="number" inputmode="numeric" min="10" placeholder="¿Cuántas fichas?"><button class="primary nomargin" type="submit">Pedir fichas</button></div>
      <input class="field" name="note" maxlength="200" placeholder="Mensaje para el admin (opcional)"></div></form>
      ${reqs.length ? `<div style="margin-top:10px">${reqs.map((r) => `<div class="row"><div>${n$(r.amount)} ${CH[r.color || 'green'].icon}<small>${st[r.status]}${r.status === 'approved' && r.granted !== r.amount ? ` · te cargaron ${n$(r.granted)}` : ''}</small></div><small>${fmtAgo(r.created_at)}</small></div>`).join('')}</div>` : ''}</div>
    <div class="box"><h3>🎁 Canjear fichas por premios</h3>
      ${rewards.length ? rewards.map((r) => { const ok = bal(r.color) >= r.cost; return `<div class="row"><div>${esc(r.title)}${r.description ? `<small>${esc(r.description)}</small>` : ''}</div>
        <button class="${ok ? 'mini-btn' : 'ghost'}" data-redeem="${r.id}" data-t="${esc(r.title)}" data-c="${n$(r.cost)} ${CH[r.color].icon}" ${ok ? '' : 'disabled'}>${n$(r.cost)} ${CH[r.color].icon}</button></div>`; }).join('') : '<p class="help">El admin todavía no cargó premios para canjear.</p>'}
      ${reds.length ? `<div style="margin-top:10px">${reds.map((r) => `<div class="row"><div>${esc(r.title)}<small>${rst[r.status]}</small></div><small>${n$(r.cost)} ${CH[r.color || 'green'].icon}</small></div>`).join('')}</div>` : ''}
      <p class="help">Las fichas se descuentan al canjear, del color que pide cada premio. El admin coordina la entrega con vos.</p></div>
    <div class="box"><h3>Invitá a tus amigos</h3><div class="code">${esc(g.code)}</div>
      <p class="help">Pasales este código (o el link). Lo ponen al crear su cuenta o en “Unirme con un código”.</p>
      <div class="inline two"><button class="ghost" data-copy="${esc(g.code)}">Copiar código</button><button class="ghost" data-share="${esc(share)}" data-name="${esc(g.name)}">Compartir link</button></div></div>
    <div class="box"><h3>Integrantes (${members.length})</h3>${members.map((m) => `<div class="row"><div class="who">${avatar(m, 34)}<span>${esc(m.nick)}${m.is_owner ? ' ⭐' : ''}<small>${m.fav_team ? esc(m.fav_team) + ' · ' : ''}</small></span></div>
      ${g.is_owner && m.id !== S.me.id ? `<div><button class="ghost" data-temp="${m.id}" data-n="${esc(m.nick)}">Clave</button></div>` : ''}</div>`).join('')}</div>
    ${g.is_owner ? `<div class="box"><h3>Ajustes del grupo</h3><input class="field" id="gName" value="${esc(g.name)}" maxlength="30">${swatches('gColor', g.color)}
      <button class="primary" data-act="saveGroup">Guardar nombre y color</button><button class="ghost block" style="margin-top:8px" data-act="newCode">Generar un código nuevo</button>
      <p class="help">Como creador del grupo podés cambiar el nombre y color, y poner una “Clave” temporal si alguien olvidó la suya: le ponés una temporal y se la pasás.</p></div>` : `<button class="ghost block" data-act="leave">Salir de este grupo</button>`}
    <details class="box"><summary><b>Unirme a otro grupo o crear uno</b></summary>${groupForms()}</details>`);
}

// ---------- perfil ----------
function notifLabel() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return ['No disponible', 'En iPhone, primero agregá la app a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí. Requiere iOS 16.4 o más.'];
  if (Notification.permission === 'denied') return ['Bloqueados', 'Los bloqueaste en el navegador. Activalos desde los ajustes del teléfono para esta app.'];
  return S.notif === 'on' ? ['Activados', 'Te avisamos antes de que cierre un partido que no jugaste y cuando termina uno.'] : ['Desactivados', 'Activalos para que te avisemos antes del cierre y con cada resultado.'];
}
async function refreshNotif() {
  try { const reg = await navigator.serviceWorker.ready; S.notif = (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch { S.notif = 'off'; }
}
async function toggleNotif() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); S.notif = 'off'; return toast('Avisos desactivados'); }
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('No diste permiso para los avisos');
  const { key } = await api('GET', '/api/push/key');
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  const ns = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
  await api('POST', '/api/push/subscribe', { endpoint: ns.endpoint });
  S.notif = 'on'; toast('¡Avisos activados!');
}

async function renderProfile() {
  await refreshNotif();
  const u = S.me, [nl, nh] = notifLabel();
  const canPush = nl !== 'No disponible' && nl !== 'Bloqueados';
  shell(`<div class="box"><div class="who big">${avatar(u, 64)}<div><b>${esc(u.nick)}</b><br><small>${esc(u.email)}</small></div></div>
      <div class="inline two" style="margin-top:10px"><label class="ghost filebtn">📷 Cambiar foto<input type="file" accept="image/*" id="photo" hidden></label>${u.avatar ? '<button class="ghost" data-act="rmPhoto">Quitar foto</button>' : '<span></span>'}</div></div>
    <form class="box" id="profileForm"><h3>Mis datos</h3>
      <div class="two"><div>${field('Nombre', 'first_name', 'text', `value="${esc(u.first_name)}" maxlength=40`)}</div><div>${field('Apellido', 'last_name', 'text', `value="${esc(u.last_name)}" maxlength=40`)}</div></div>
      ${field('Apodo', 'nick', 'text', `value="${esc(u.nick)}" maxlength=20`)}${field('Mail', 'email', 'email', `value="${esc(u.email)}"`)}
      ${field('Fecha de nacimiento', 'birth_date', 'date', `value="${esc(u.birth_date)}"`)}${field('Equipo del que sos hincha', 'fav_team', 'text', `value="${esc(u.fav_team || '')}" maxlength=40`)}
      <label>Color de tu avatar</label>${swatches('color', u.color)}<div class="err" id="pErr"></div><button class="primary" type="submit">Guardar cambios</button></form>
    <div class="box"><h3>Avisos en el celular: ${nl}</h3><p class="help">${nh}</p>${canPush ? `<button class="primary" data-act="notif">${S.notif === 'on' ? 'Desactivar avisos' : 'Activar avisos'}</button>` : ''}</div>
    <form class="box" id="passForm"><h3>Cambiar contraseña</h3>${field('Contraseña actual', 'current', 'password', 'autocomplete=current-password')}${field('Contraseña nueva', 'password', 'password', 'autocomplete=new-password')}
      <div class="err" id="wErr"></div><button class="primary" type="submit">Cambiar contraseña</button></form>
    <button class="ghost block" data-act="logout">Cerrar sesión</button>`);
}

async function renderAdmin() {
  shell('<div class="empty">Cargando…</div>');
  const [ov, reqs, users, ledger, pending, pots, rewards, reds, cash, jp] = await Promise.all([api('GET', '/api/admin/overview'), api('GET', '/api/admin/coin-requests'),
    api('GET', '/api/admin/users'), api('GET', '/api/admin/ledger'), api('GET', '/api/admin/pending-matches'), api('GET', '/api/admin/pots'),
    api('GET', '/api/admin/rewards'), api('GET', '/api/admin/redemptions'), api('GET', '/api/admin/cash'), api('GET', '/api/admin/jackpot')]);
  S.adminPending = reqs.length + reds.length; S.admin = ov; if (!group()) S.pots.jackpot = jp;
  const comps = ov.competitions, src = ov.source, g0 = ov.groups[0];
  const sec = (title, body, open) => `<details class="box" ${open ? 'open' : ''}><summary><b>${title}</b></summary><div style="margin-top:10px">${body}</div></details>`;
  shell(`<p class="help" style="margin:0 0 10px">Solo vos ves esta pantalla. Acá manejás las fichas, la suscripción de datos y los torneos de todos los grupos.</p>
    ${sec(`Pedidos de fichas${reqs.length ? ` (${reqs.length})` : ''}`, reqs.length ? reqs.map((r) => `<div class="req" data-rid="${r.id}">
        <div class="who"><b>${esc(r.nick)} pide ${n$(r.amount)} ${CH[r.color].icon}</b><small>${esc(r.group_name)} · tiene ${n$(r.coins)} ${CH[r.color].icon} · ${fmtAgo(r.created_at)}</small></div>
        ${r.note ? `<p class="help">“${esc(r.note)}”</p>` : ''}
        <div class="inline two" style="margin-top:6px"><input class="field" name="amt" type="number" min="1" value="${r.amount}" aria-label="Fichas ${CH[r.color].name} a cargar"><div class="two"><button class="primary nomargin" data-act="reqOk">Cargar</button><button class="ghost" data-act="reqNo">Rechazar</button></div></div></div>`).join('') : '<p class="help">No hay pedidos pendientes.</p>', true)}
    ${sec('💼 Caja del admin', `<div class="walletbox">${JK.map(([k, ic, c]) => `<div class="w ${c}"><b>${ic} ${n$(cash.commission[k])}</b><small>Comisiones cobradas</small></div>`).join('')}</div>
        <div class="walletbox">${JK.map(([k, ic, c]) => `<div class="w ${c}"><b>${ic} ${n$(cash.unclaimed[k])}</b><small>Pozos sin ganador (la casa)</small></div>`).join('')}</div>
        <label class="l">Comisión por inscripción (%)</label><div class="inline two"><input class="field" id="commPct" type="number" min="0" max="90" value="${cash.commission_pct}"><button class="primary nomargin" data-act="saveComm">Guardar</button></div>
        <p class="help">Con ${cash.commission_pct}%, de cada inscripción de ${n$(5000)}: <b>${n$(toPot(5000, cash.commission_pct))}</b> van al pozo y <b>${n$(5000 - toPot(5000, cash.commission_pct))}</b> quedan para vos. Vale para las inscripciones nuevas. Si una inscripción se devuelve (por salir antes de que empiece o por fecha suspendida), se devuelve completa y se descuenta tu comisión.</p>
        ${cash.recent.length ? cash.recent.map((h) => `<div class="row"><div>${esc(h.reason || '')}<small>${esc(h.group_name)} · ${h.kind === 'commission' ? 'comisión' : 'pozo sin ganador'} · ${fmtAgo(h.created_at)}</small></div><b class="win">+${n$(h.amount)} ${CH[h.color].icon}</b></div>`).join('') : '<p class="help">Todavía no hay comisiones.</p>'}`, true)}
    ${sec(`Canjes pendientes${reds.length ? ` (${reds.length})` : ''}`, reds.length ? reds.map((r) => `<div class="req" data-did="${r.id}"><div class="who"><b>${esc(r.title)}</b><small>${esc(r.nick)} · ${esc(r.group_name)} · ${n$(r.cost)} ${CH[r.color].icon} · ${fmtAgo(r.created_at)}<br>${esc(r.email)}</small></div>
        <div class="two" style="margin-top:6px"><button class="primary nomargin" data-act="redOk">Marcar entregado</button><button class="ghost" data-act="redNo">Rechazar y devolver</button></div></div>`).join('') : '<p class="help">No hay canjes pendientes.</p>', reds.length > 0)}
    ${sec('Premios para canjear', `<p class="help" style="margin-top:0">Lo que definas acá aparece en la pestaña Grupo de todos los jugadores. Al canjear se descuentan las fichas.</p>
        ${rewards.map((r) => `<div class="comprow" data-rwid="${r.id}"><div class="row"><div>${esc(r.title)}<small>${n$(r.cost)} ${CH[r.color].icon} · ${r.active ? 'visible' : 'oculto'}</small></div><input class="switch" type="checkbox" data-rw-toggle="${r.id}" ${r.active ? 'checked' : ''} aria-label="Mostrar ${esc(r.title)}"></div>
          <details class="mini"><summary>Editar</summary><div class="inline"><input class="field" name="title" value="${esc(r.title)}" maxlength="80"><input class="field" name="description" value="${esc(r.description || '')}" placeholder="Descripción (opcional)" maxlength="300"><input class="field" name="cost" type="number" min="1" value="${r.cost}"><select class="field" name="color">${Object.entries(CH).map(([k, c]) => `<option value="${k}" ${k === r.color ? 'selected' : ''}>Se paga con fichas ${c.icon} ${c.name}</option>`).join('')}</select><button class="ghost" data-act="rwSave">Guardar premio</button></div></details></div>`).join('')}
        <h3 style="margin-top:12px">Nuevo premio</h3><div class="inline"><input class="field" id="rwTitle" placeholder="Premio (ej: Asado para dos)" maxlength="80"><input class="field" id="rwDesc" placeholder="Descripción (opcional)" maxlength="300"><input class="field" id="rwCost" type="number" min="1" placeholder="Costo en fichas"><select class="field" id="rwColor">${Object.entries(CH).map(([k, c]) => `<option value="${k}">Se paga con fichas ${c.icon} ${c.name}</option>`).join('')}</select><button class="primary nomargin" data-act="rwNew">Agregar premio</button></div>`)}
    ${sec('Cargar fichas directo', ov.groups.length ? `<div class="inline"><select class="field" id="grGroup">${ov.groups.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
        <select class="field" id="grUser">${g0.members.map((m) => `<option value="${m.id}">${esc(m.nick)} (🟢${n$(m.coins)} 🔴${n$(m.red_coins)} 🟡${n$(m.gold_coins)})</option>`).join('')}</select>
        ${colorSelect('grColor')}<input class="field" id="grAmt" type="number" inputmode="numeric" placeholder="Fichas (con - para restar)"><input class="field" id="grWhy" placeholder="Motivo (opcional)" maxlength="100">
        <button class="primary nomargin" data-act="grant">Cargar fichas</button></div>` : '<p class="help">Todavía no hay grupos.</p>')}
    ${sec('Fuente de datos (suscripción)', `<p class="help" style="margin-top:0">Estado: <b>${src.key_set ? `clave cargada ${src.hint} (${src.from})` : 'usando la clave gratuita, con límites'}</b></p>
        <input class="field" id="keyInp" type="password" autocomplete="off" placeholder="${src.key_set ? 'Pegá una clave nueva para reemplazarla' : 'Pegá acá la clave de tu suscripción'}">
        <div class="two" style="margin-top:8px"><button class="primary nomargin" data-act="saveKey">Guardar clave</button><button class="ghost" data-act="testKey">Probar conexión</button></div>
        ${src.key_set ? '<button class="ghost block" data-act="rmKey">Volver a la clave gratuita</button>' : ''}<div class="help" id="keyMsg"></div>
        <button class="primary" data-act="sync">🔄 Actualizar fixture ahora</button>
        <p class="help">Se actualiza solo: resultados cada 10 min, fixture cada 6 h y torneos nuevos una vez por día.</p>`)}
    ${sec(`Premios en juego${pots.rounds.length + pots.champs.filter((c) => c.players).length ? ` (${pots.rounds.length + pots.champs.filter((c) => c.players).length})` : ''}`, `<p class="help" style="margin-top:0">Las fechas se reparten solas cuando terminan todos sus partidos (verde y roja). Si una quedó trabada (partido postergado), cerrala acá. El pozo dorado lo cerrás vos cuando termina el torneo, eligiendo al campeón. Si nadie lo eligió, se lo queda la casa.</p>
        ${pots.rounds.map((r) => `<div class="row"><div>${esc(r.comp)} · ${esc(r.round)}<small>${esc(r.group_name)} · ${r.players} jugadores · 🟢 ${n$(r.pot)}${r.red_players ? ` · 🔴 ${r.red_players} anotados` : ''} · ${r.pending ? r.pending + ' partidos sin cerrar' : 'listo'}</small></div><button class="ghost" data-closeround="${r.group_id}|${r.comp_id}|${esc(r.round)}">Cerrar fecha</button></div>`).join('')}
        ${pots.champs.map((c) => `<div class="req"><div class="who"><b>🟡 ${esc(c.comp)}</b><small>${c.groups} grupos · ${c.players} jugadores · pozo ${n$(c.pot)} · ${c.pending ? c.pending + ' partidos sin jugar' : 'todos los partidos jugados'}</small></div>
          <div class="inline two" style="margin-top:6px"><select class="field" data-champwin="${c.comp_id}"><option value="">¿Quién salió campeón?</option>${c.teams.map((t) => `<option>${esc(t)}</option>`).join('')}</select><button class="ghost" data-closecup="${c.comp_id}" data-n="${esc(c.comp)}">Cerrar y repartir</button></div></div>`).join('')}
        ${pots.house && pots.house.length ? `<h3 style="margin-top:12px">Se quedó la casa</h3>${pots.house.map((h) => `<div class="row"><div>${esc(h.group_name)}<small>${esc(h.reason)}</small></div><b>${n$(h.amount)} ${CH[h.color].icon}</b></div>`).join('')}` : ''}
        ${pots.rounds.length + pots.champs.length ? '' : '<p class="help">No hay pozos abiertos.</p>'}`, pots.champs.some((c) => c.pending === 0 && c.players))}
    ${sec('Torneos', `${comps.length ? comps.map((c) => `<div class="comprow" data-cid="${c.id}"><div class="row"><div>${esc(c.name)}<small>${esc(c.country || '')} · ${c.matches} partidos · 🟢${n$(c.entry_fee)} 🔴${n$(c.red_fee)} 🟡${n$(c.champ_fee)}</small></div><input class="switch" type="checkbox" data-comp-toggle="${c.id}" ${c.enabled ? 'checked' : ''} aria-label="Activar ${esc(c.name)}"></div>
        <details class="mini"><summary>Precios de inscripción de este torneo</summary><div class="inline">
        <label class="l">🟢 Verde: fecha completa<input class="field" name="entry_fee" type="number" min="0" value="${c.entry_fee}"></label>
        <label class="l">🔴 Roja: pozo de goles por fecha<input class="field" name="red_fee" type="number" min="0" value="${c.red_fee}"></label>
        <label class="l">🟡 Dorada: elegir campeón<input class="field" name="champ_fee" type="number" min="0" value="${c.champ_fee}"></label>
        <label class="l">Inscripción dorada<select class="field" name="champ_open"><option value="1" ${c.champ_open ? 'selected' : ''}>Abierta</option><option value="0" ${c.champ_open ? '' : 'selected'}>Cerrada</option></select></label></div>
        <button class="ghost block" data-act="saveComp">Guardar precios</button><p class="help">0 = sin ese pozo. Valores de ejemplo: 5.000 cada una.</p></details></div>`).join('') : '<p class="help">Todavía no hay torneos. Tocá “Actualizar fixture”.</p>'}
        <div class="inline two" style="margin-top:10px"><input class="field" id="newComp" placeholder="Torneo propio (ej: Mundial)"><button class="ghost" data-act="addComp">Crear torneo</button></div>`)}
    ${sec('Cargar partidos y resultados a mano', `<div class="inline"><select class="field" id="mComp">${comps.filter((c) => c.enabled).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <div class="inline two"><input class="field" id="mHome" placeholder="Local"><input class="field" id="mAway" placeholder="Visitante"></div><input class="field" id="mRound" placeholder="Fecha (ej: Fecha 3)"><input class="field" id="mWhen" type="datetime-local"><button class="ghost" data-act="addMatch">Agregar partido</button></div>
        <h3 style="margin-top:14px">Esperando resultado</h3>${pending.length ? pending.map((m) => `<div class="row" data-mid="${m.id}"><div>${esc(m.home)} vs ${esc(m.away)}<small>${esc(m.comp)}</small></div><div><input class="mini" data-r="h" type="number" min="0" aria-label="Goles local"> <input class="mini" data-r="a" type="number" min="0" aria-label="Goles visitante"> <button class="ghost" data-act="result">OK</button></div></div>`).join('') : '<p class="help">No hay partidos esperando resultado.</p>'}`)}
    ${sec(`Usuarios (${users.length})`, users.map((u) => `<div class="row"><div>${esc(u.nick)}${u.is_admin ? ' ⭐' : ''}<small>${esc(u.first_name)} ${esc(u.last_name)} · ${esc(u.email)}<br>${esc(u.groups || 'sin grupo')}</small></div>${u.is_admin ? '' : `<button class="ghost" data-upass="${u.id}" data-n="${esc(u.nick)}">Clave</button>`}</div>`).join(''))}
    ${sec('Últimos movimientos de fichas', ledger.length ? ledger.map((l) => `<div class="row"><div>${esc(l.nick)} · ${esc(l.group_name)}<small>${esc(l.reason || '')} · ${fmtAgo(l.created_at)}</small></div><b class="${l.amount > 0 ? 'win' : 'lose'}">${l.amount > 0 ? '+' : ''}${n$(l.amount)} ${CH[l.color || 'green'].icon}</b></div>`).join('') : '<p class="help">Todavía no cargaste fichas.</p>')}`);
}

// ---------- dispatcher ----------
async function render() {
  if (!S.token) return renderAuth();
  if (!S.me) { try { applyBundle(await api('GET', '/api/me')); } catch { return renderAuth(); } }
  if (!S.groups.length) {
    if (!S.me.is_admin) return renderOnboarding();
    if (S.tab !== 'profile') S.tab = 'admin'; // el admin no necesita grupo para manejar el panel
  }
  try {
    if (S.tab === 'admin' && S.me.is_admin) return await renderAdmin();
    if (S.tab === 'ranking') return await renderRanking();
    if (S.tab === 'tables') return await renderTables();
    if (S.tab === 'group') return await renderGroup();
    if (S.tab === 'profile') return await renderProfile();
    renderMatches(); loadMatches();
  } catch (e) { toast(e.message, true); }
}

// ---------- eventos ----------
const readColor = (form, name) => form.querySelector(`[name=${name}]:checked`)?.value;

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target, f = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'authForm') {
      const err = document.getElementById('authErr'); err.textContent = '';
      if (S.authMode === 'register') {
        if (f.password !== f.password2) { err.textContent = 'Las contraseñas no coinciden'; return; }
        f.accept = form.querySelector('[name=accept]').checked;
      }
      try {
        const r = await api('POST', S.authMode === 'register' ? '/api/register' : '/api/login', f);
        S.token = r.token; store.set('token', r.token); applyBundle(r); S.tab = 'matches'; render();
      } catch (x) { err.textContent = x.message; }
    } else if (form.id === 'profileForm') {
      try { applyBundle(await api('PATCH', '/api/me', { ...f, color: readColor(form, 'color') })); toast('Datos guardados'); render(); }
      catch (x) { document.getElementById('pErr').textContent = x.message; }
    } else if (form.id === 'passForm') {
      try { await api('POST', '/api/me/password', f); form.reset(); toast('Contraseña cambiada'); document.getElementById('wErr').textContent = ''; }
      catch (x) { document.getElementById('wErr').textContent = x.message; }
    } else if (form.id === 'reqForm') {
      await api('POST', `/api/groups/${S.gid}/coin-requests`, { amount: Number(f.amount), note: f.note, color: document.getElementById('reqColor').value });
      toast('Pedido enviado al admin'); render();
    } else if (form.classList.contains('msgform')) {
      const id = form.dataset.id; if (!f.body.trim()) return;
      await api('POST', `/api/matches/${id}/comments?${gq()}`, { body: f.body });
      S.threads[id] = await api('GET', `/api/matches/${id}/comments?${gq()}`);
      const m = S.matches.find((x) => x.id === Number(id)); if (m) m.comments = S.threads[id].length;
      paintThread(cardEl(id), id); cardEl(id).querySelector('.msgform input').focus();
    }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.id === 'groupSel') { S.gid = Number(t.value); store.set('gid', S.gid); S.matches = []; S.plays = {}; S.threads = {}; S.comp = ''; render(); }
    else if (t.id === 'grGroup') {
      const gr = S.admin.groups.find((x) => x.id === Number(t.value));
      document.getElementById('grUser').innerHTML = gr.members.map((m) => `<option value="${m.id}">${esc(m.nick)} (🟢${n$(m.coins)} 🔴${n$(m.red_coins)} 🟡${n$(m.gold_coins)})</option>`).join('');
    } else if (t.id === 'rkComp') { S.rank.comp = t.value; S.rank.round = ''; renderRanking(); }
    else if (t.id === 'rkRound') { S.rank.round = t.value; renderRanking(); }
    else if (t.id === 'photo' && t.files[0]) {
      const data = await resizePhoto(t.files[0]);
      applyBundle(await api('PATCH', '/api/me', { avatar: data })); toast('Foto actualizada'); render();
    } else if (t.dataset.rwToggle) { await api('PATCH', `/api/admin/rewards/${t.dataset.rwToggle}`, { active: t.checked }); toast('Listo'); }
    else if (t.dataset.compToggle) { await api('PATCH', `/api/admin/competitions/${t.dataset.compToggle}`, { enabled: t.checked }); toast('Listo'); }
  } catch (err) { toast(err.message, true); }
});

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 160;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const card = t.closest('.card');
  try {
    if (t.dataset.auth) { S.authMode = t.dataset.auth; return renderAuth(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; return render(); }
    if (t.dataset.scope) { S.scope = t.dataset.scope; S.matches = []; renderMatches(); return loadMatches(); }
    if (t.classList.contains('chip') && t.dataset.comp !== undefined) { S.comp = t.dataset.comp; S.matches = []; renderMatches(); return loadMatches(); }
    if (t.dataset.tcomp) { S.tableComp = t.dataset.tcomp; return renderTables(); }
    if (t.dataset.rank) { S.rank.mode = t.dataset.rank; return renderRanking(); }
    if (t.dataset.del) { await api('DELETE', `/api/comments/${t.dataset.del}`); const id = card.dataset.id; S.threads[id] = await api('GET', `/api/matches/${id}/comments?${gq()}`); return paintThread(card, id); }
    if (t.dataset.pick && card) { card.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b === t)); return; }
    if (t.dataset.act === 'save' && card) return saveCard(card, t);
    if (t.dataset.act === 'plays' && card) {
      const id = card.dataset.id, box = card.querySelector('[data-box=plays]');
      if (!box.hidden) { box.hidden = true; delete S.plays[id]; return; }
      S.plays[id] = await api('GET', `/api/matches/${id}/plays?${gq()}`); return paintPlays(card, id);
    }
    if (t.dataset.act === 'chat' && card) {
      const id = card.dataset.id, box = card.querySelector('[data-box=thread]');
      if (!box.hidden) { box.hidden = true; delete S.threads[id]; return; }
      S.threads[id] = await api('GET', `/api/matches/${id}/comments?${gq()}`); return paintThread(card, id);
    }
    if (t.dataset.act === 'logout') { try { await api('POST', '/api/logout', {}); } catch { /* igual salimos */ } return endSession(); }
    if (t.dataset.act === 'join') { applyBundle(await api('POST', '/api/groups/join', { code: document.getElementById('joinCode').value })); toast('¡Te uniste al grupo!'); S.tab = 'matches'; return render(); }
    if (t.dataset.act === 'createGroup') {
      const r = await api('POST', '/api/groups', { name: document.getElementById('newGroupName').value, color: readColor(document, 'newGroupColor') });
      applyBundle(r); S.gid = r.groups.at(-1).id; store.set('gid', S.gid); toast('Grupo creado'); S.tab = 'group'; return render();
    }
    if (t.dataset.act === 'saveGroup') { applyBundle(await api('PATCH', `/api/groups/${S.gid}`, { name: document.getElementById('gName').value, color: readColor(document, 'gColor') })); toast('Guardado'); return render(); }
    if (t.dataset.act === 'newCode') { applyBundle(await api('POST', `/api/groups/${S.gid}/code`, {})); toast('Código nuevo generado'); return render(); }
    if (t.dataset.act === 'leave') { applyBundle(await api('POST', `/api/groups/${S.gid}/leave`, {})); S.gid = S.groups[0]?.id ?? null; return render(); }
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast('Código copiado'); } catch { toast(t.dataset.copy); } return; }
    if (t.dataset.share) {
      if (navigator.share) { try { await navigator.share({ title: 'PRODE Amigos', text: `Sumate a "${t.dataset.name}" en PRODE Amigos`, url: t.dataset.share }); } catch { /* canceló */ } }
      else { try { await navigator.clipboard.writeText(t.dataset.share); toast('Link copiado'); } catch { toast(t.dataset.share); } }
      return;
    }
    if (t.dataset.redeem) {
      if (!confirm(`¿Canjear "${t.dataset.t}" por ${t.dataset.c} fichas?`)) return;
      await api('POST', `/api/groups/${S.gid}/redeem`, { reward_id: Number(t.dataset.redeem) }); toast('¡Canje enviado! El admin te avisa.'); applyBundle(await api('GET', '/api/me')); return render();
    }
    if (t.dataset.act === 'redOk' || t.dataset.act === 'redNo') {
      const id = t.closest('[data-did]').dataset.did;
      await api('POST', `/api/admin/redemptions/${id}`, { action: t.dataset.act === 'redOk' ? 'deliver' : 'reject' }); toast(t.dataset.act === 'redOk' ? 'Marcado como entregado' : 'Canje rechazado, fichas devueltas'); return render();
    }
    if (t.dataset.act === 'rwNew') {
      const v = (id) => document.getElementById(id).value;
      await api('POST', '/api/admin/rewards', { title: v('rwTitle'), description: v('rwDesc'), cost: Number(v('rwCost')), color: v('rwColor') }); toast('Premio agregado'); return render();
    }
    if (t.dataset.act === 'rwSave') {
      const row = t.closest('[data-rwid]'), v = (n) => row.querySelector(`[name=${n}]`).value;
      await api('PATCH', `/api/admin/rewards/${row.dataset.rwid}`, { title: v('title'), description: v('description'), cost: Number(v('cost')), color: v('color') }); toast('Premio guardado'); return render();
    }
    if (t.dataset.join) { await api('POST', `/api/groups/${S.gid}/rounds/join`, { comp_id: Number(t.dataset.join), round: t.dataset.round }); toast('¡Anotado en la fecha!'); return loadMatches(); }
    if (t.dataset.leave) { await api('POST', `/api/groups/${S.gid}/rounds/leave`, { comp_id: Number(t.dataset.leave), round: t.dataset.round }); toast('Inscripción devuelta'); return loadMatches(); }
    if (t.dataset.joinred) { await api('POST', `/api/groups/${S.gid}/rounds/join-red`, { comp_id: Number(t.dataset.joinred), round: t.dataset.round }); toast('¡Anotado en el pozo de goles!'); return loadMatches(); }
    if (t.dataset.leavered) { await api('POST', `/api/groups/${S.gid}/rounds/leave-red`, { comp_id: Number(t.dataset.leavered), round: t.dataset.round }); toast('Inscripción roja devuelta'); return loadMatches(); }
    if (t.dataset.champ) {
      const sel = document.querySelector(`[data-champsel="${t.dataset.champ}"]`);
      if (!sel || !sel.value) throw new Error('Elegí un equipo');
      const r = await api('POST', `/api/groups/${S.gid}/champs/${t.dataset.champ}/join`, { pick: sel.value });
      toast(r.changed ? 'Elección cambiada' : '¡Elegiste a tu campeón!'); return S.tab === 'ranking' ? renderPrizes() : loadMatches();
    }
    if (t.dataset.closeround) {
      const [gid, cid, ...r] = t.dataset.closeround.split('|');
      if (!confirm('¿Cerrar esta fecha y repartir el pozo con los partidos ya jugados?')) return;
      await api('POST', '/api/admin/rounds/close', { group_id: Number(gid), comp_id: Number(cid), round: r.join('|') }); toast('Fecha cerrada'); return render();
    }
    if (t.dataset.closecup) {
      const champion = document.querySelector(`[data-champwin="${t.dataset.closecup}"]`).value;
      if (!champion) throw new Error('Elegí quién salió campeón');
      if (!confirm(`¿Cerrar "${t.dataset.n}" con ${champion} como campeón y repartir el pozo dorado en todos los grupos? No se puede deshacer.`)) return;
      await api('POST', `/api/admin/competitions/${t.dataset.closecup}/close`, { champion }); toast('Campeonato cerrado y premios repartidos'); return render();
    }
    if (t.dataset.act === 'saveComp') {
      const row = t.closest('.comprow'), v = (n) => row.querySelector(`[name=${n}]`).value;
      await api('PATCH', `/api/admin/competitions/${row.dataset.cid}`, { entry_fee: Number(v('entry_fee')), red_fee: Number(v('red_fee')), champ_fee: Number(v('champ_fee')), champ_open: v('champ_open') === '1' });
      toast('Premios guardados'); return render();
    }
    if (t.dataset.act === 'reqOk' || t.dataset.act === 'reqNo') {
      const row = t.closest('[data-rid]'), ok = t.dataset.act === 'reqOk';
      await api('POST', `/api/admin/coin-requests/${row.dataset.rid}`, ok ? { action: 'approve', amount: Number(row.querySelector('[name=amt]').value) } : { action: 'reject' });
      toast(ok ? 'Fichas cargadas' : 'Pedido rechazado'); return render();
    }
    if (t.dataset.act === 'grant') {
      const amount = parseInt(document.getElementById('grAmt').value, 10);
      if (!Number.isInteger(amount) || !amount) throw new Error('Poné cuántas fichas');
      await api('POST', '/api/admin/grant', { group_id: Number(document.getElementById('grGroup').value), user_id: Number(document.getElementById('grUser').value), amount, color: document.getElementById('grColor').value, reason: document.getElementById('grWhy').value });
      toast('Listo'); return render();
    }
    if (t.dataset.act === 'saveComm') {
      await api('POST', '/api/admin/settings', { commission_pct: Number(document.getElementById('commPct').value) }); toast('Comisión guardada'); return render();
    }
    if (t.dataset.act === 'saveKey' || t.dataset.act === 'rmKey') {
      const key = t.dataset.act === 'rmKey' ? '' : document.getElementById('keyInp').value.trim();
      if (t.dataset.act === 'saveKey' && !key) throw new Error('Pegá primero la clave');
      await api('POST', '/api/admin/settings', { thesportsdb_key: key }); toast(key ? 'Clave guardada' : 'Usando la clave gratuita'); return render();
    }
    if (t.dataset.act === 'testKey') {
      const msg = document.getElementById('keyMsg'); msg.textContent = 'Probando…';
      const r = await api('POST', '/api/admin/test-source');
      msg.innerHTML = r.ok ? `<span class="win">Conectó.</span> ${esc(r.league)} ${esc(r.season)}: ${r.events} partidos. Plan: ${r.premium ? 'con clave de suscripción' : 'gratuito'}.` : `<span class="lose">No conectó:</span> ${esc(r.error)}`;
      return;
    }
    if (t.dataset.upass) {
      const p = prompt(`Clave temporal para ${t.dataset.n} (8 o más, con letras y números):`);
      if (p) { await api('POST', `/api/admin/users/${t.dataset.upass}/password`, { password: p }); toast('Clave cambiada'); }
      return;
    }
    if (t.dataset.temp) {
      const p = prompt(`Clave temporal para ${t.dataset.n} (8 o más, con letras y números). Se la pasás y después la cambia en Perfil:`);
      if (p) { await api('POST', `/api/groups/${S.gid}/members/${t.dataset.temp}/password`, { password: p }); toast('Clave cambiada'); }
      return;
    }
    if (t.dataset.act === 'rmPhoto') { applyBundle(await api('PATCH', '/api/me', { avatar: null })); return render(); }
    if (t.dataset.act === 'notif') { await toggleNotif(); return render(); }
    if (t.dataset.act === 'sync') {
      t.disabled = true; t.textContent = 'Buscando partidos…';
      const r = await api('POST', '/api/admin/sync');
      const errs = r.report.filter((x) => x.error);
      toast(`${r.report.reduce((s, x) => s + (x.matches || 0), 0)} partidos en ${r.report.length} torneos` + (errs.length ? ` (${errs.length} con error)` : ''), !!errs.length);
      return render();
    }
    if (t.dataset.act === 'addComp') { const name = document.getElementById('newComp').value.trim(); if (!name) return; await api('POST', '/api/admin/competitions', { name }); toast('Torneo creado'); return render(); }
    if (t.dataset.act === 'addMatch') {
      const v = (id) => document.getElementById(id).value;
      await api('POST', '/api/admin/matches', { comp_id: v('mComp'), home: v('mHome'), away: v('mAway'), round: v('mRound'), kickoff: new Date(v('mWhen')).toISOString() });
      toast('Partido agregado'); return render();
    }
    if (t.dataset.act === 'result') {
      const row = t.closest('[data-mid]'), g = (k) => parseInt(row.querySelector(`[data-r=${k}]`).value, 10);
      await api('POST', `/api/admin/matches/${row.dataset.mid}/result`, { home: g('h'), away: g('a') });
      toast('Resultado cargado y fichas repartidas'); return render();
    }
  } catch (err) { toast(err.message, true); if (t.disabled) render(); }
});

async function saveCard(card, btn) {
  const pick = card.querySelector('.pick.on')?.dataset.pick;
  const h = card.querySelector('[name=h]')?.value ?? '', a = card.querySelector('[name=a]')?.value ?? '';
  if ((h === '') !== (a === '')) return toast('Completá los goles de los dos equipos', true);
  if (!pick && h === '') return toast('Elegí quién gana', true);
  const body = {};
  if (pick) body.pick = pick;
  if (h !== '') body.prediction = { home: parseInt(h, 10), away: parseInt(a, 10) };
  btn.disabled = true;
  try { await api('PUT', `/api/matches/${card.dataset.id}/play?${gq()}`, body); toast('¡Pronóstico guardado!'); await loadMatches(); }
  catch (err) { toast(err.message, true); btn.disabled = false; }
}

// al escribir un marcador, se marca solo el ganador que corresponde
document.addEventListener('input', (e) => {
  const card = e.target.closest?.('.card'); if (!card || !/^[ha]$/.test(e.target.name || '')) return;
  const h = card.querySelector('[name=h]').value, a = card.querySelector('[name=a]').value;
  if (h === '' || a === '') return;
  const k = +h > +a ? 'L' : +h < +a ? 'V' : 'E';
  card.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b.dataset.pick === k));
});

// al volver a la app o cada minuto en Partidos, traer resultados nuevos
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.tab === 'matches') loadMatches(); });
setInterval(() => { if (!document.hidden && S.token && S.tab === 'matches' && !document.activeElement?.matches?.('input, textarea')) loadMatches(); }, 60000);

// link de invitación: /?codigo=ABC123
const inviteCode = new URLSearchParams(location.search).get('codigo');
if (inviteCode) { store.set('invite', inviteCode); history.replaceState(null, '', '/'); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async () => {
  try { S.cfg = await api('GET', '/api/config'); } catch { /* usa valores por defecto */ }
  await render();
  const pending = store.get('invite');
  if (pending && !S.token) {
    S.authMode = 'register'; renderAuth();
    const c = document.querySelector('[name=code]'); if (c) c.value = pending;
  } else if (pending && S.token && S.me) {
    try { applyBundle(await api('POST', '/api/groups/join', { code: pending })); toast('¡Te uniste al grupo!'); render(); } catch { /* código inválido */ }
    store.set('invite', null);
  }
})();
// el código se usa una sola vez
document.addEventListener('submit', () => setTimeout(() => store.set('invite', null), 3000), true);
