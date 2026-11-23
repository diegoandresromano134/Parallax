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
  rank: { mode: 'coins', comp: '', round: '' }, tableComp: '', plays: {}, threads: {}, notif: 'unknown', admin: null, members: [],
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Argentina/Buenos_Aires';
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const fmtAgo = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'ahora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const group = () => S.groups.find((g) => g.id === S.gid);

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
  S.me = b.user; S.groups = b.groups;
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
function shell(inner) {
  const g = group();
  document.documentElement.style.setProperty('--accent', g.color || S.cfg.colors[0]);
  const tabs = [['matches', '⚽', 'Partidos'], ['ranking', '🏆', 'Ranking'], ['tables', '📊', 'Tablas'], ['group', '👥', 'Grupo'], ['profile', '👤', 'Perfil']];
  $app.innerHTML = `<header class="top"><div class="gsel">${S.groups.length > 1 ? `<select id="groupSel" aria-label="Grupo">${S.groups.map((x) => `<option value="${x.id}" ${x.id === S.gid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<h1>${esc(g.name)}</h1>`}</div>
    <div class="coins" title="Tus fichas en este grupo">🪙 ${g.coins.toLocaleString('es-AR')}</div></header>
    <main>${inner}</main>
    <nav class="tabs">${tabs.map(([k, i, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
}

// ---------- partidos ----------
function matchCard(m) {
  const { prediction: p, bet } = m.mine;
  const live = m.status === 'live' ? '<span class="live">● EN JUEGO</span>' : m.status === 'postponed' ? '<span class="live">POSTERGADO</span>' : `${fmtTime(m.kickoff)} hs`;
  const total = m.pool.L.total + m.pool.E.total + m.pool.V.total;
  const header = `<div class="meta"><span>${esc(m.comp)}${m.round ? ' · ' + esc(m.round) : ''}</span><span>${live}</span></div>`;
  const team = (n, b) => `<div class="team">${badge(b, n)}<span>${esc(n)}</span></div>`;
  const footer = `<div class="foot"><button class="ghost" data-act="chat">💬 Comentarios${m.comments ? ` (${m.comments})` : ''}</button>${m.locked || m.status === 'finished' ? '<button class="ghost" data-act="plays">Jugadas del grupo</button>' : ''}</div>
    <div class="plays" data-box="plays" hidden></div><div class="thread" data-box="thread" hidden></div>`;

  if (m.status === 'finished' || m.status === 'cancelled') {
    const lines = [];
    if (p) lines.push(`Tu pronóstico: <b>${p.home}-${p.away}</b> → <span class="pts-${p.points ?? 0}">${p.points == null ? '' : p.points + (p.points === 1 ? ' punto' : ' puntos')}</span>`);
    if (bet) {
      const net = (bet.payout ?? 0) - bet.stake;
      lines.push(`Tu apuesta: ${bet.stake} 🪙 a <b>${esc(pickName(m, bet.pick))}</b> → ` + (bet.payout == null ? '' : m.status === 'cancelled' ? 'devuelta' : net > 0 ? `<span class="win">+${net} 🪙</span>` : net === 0 ? 'te devolvieron las fichas' : `<span class="lose">${net} 🪙</span>`));
    }
    return `<article class="card" data-id="${m.id}">${header}<div class="teams">${team(m.home, m.home_badge)}<div class="score final">${m.status === 'cancelled' ? 'Susp.' : `${m.home_goals} - ${m.away_goals}`}</div>${team(m.away, m.away_badge)}</div>
      <div class="result">${lines.length ? lines.map((l) => `<div>${l}</div>`).join('') : '<div>No jugaste este partido</div>'}</div>${footer}</article>`;
  }
  if (m.locked) {
    return `<article class="card" data-id="${m.id}">${header}<div class="teams">${team(m.home, m.home_badge)}<div class="score final">${m.home_goals ?? '·'} - ${m.away_goals ?? '·'}</div>${team(m.away, m.away_badge)}</div>
      <div class="result"><div>🔒 Cerrado. ${p ? `Tu pronóstico: <b>${p.home}-${p.away}</b>.` : 'No pronosticaste.'} ${bet ? `Apostaste ${bet.stake} 🪙 a <b>${esc(pickName(m, bet.pick))}</b>.` : ''}</div><div>Pozo en juego: <b>${total} 🪙</b></div></div>${footer}</article>`;
  }
  const sel = bet?.pick;
  const pick = (k) => `<button class="pick ${sel === k ? 'on' : ''}" data-pick="${k}">${esc(pickName(m, k))}<small>${m.pool[k].total ? `${m.pool[k].total} 🪙 · ${m.pool[k].n}` : 'sin apuestas'}</small></button>`;
  return `<article class="card" data-id="${m.id}" data-old="${bet?.stake ?? 0}">${header}
    <div class="teams">${team(m.home, m.home_badge)}
      <div class="score"><input name="h" type="number" inputmode="numeric" min="0" max="30" value="${p?.home ?? ''}" placeholder="-" aria-label="Goles ${esc(m.home)}">
      <span>:</span><input name="a" type="number" inputmode="numeric" min="0" max="30" value="${p?.away ?? ''}" placeholder="-" aria-label="Goles ${esc(m.away)}"></div>${team(m.away, m.away_badge)}</div>
    <div class="picks">${['L', 'E', 'V'].map(pick).join('')}</div>
    <div class="stake"><span class="help">Apuesta:</span>
      <input name="stake" type="number" inputmode="numeric" min="10" step="10" value="${bet?.stake ?? ''}" placeholder="fichas">
      ${[50, 100, 250].map((n) => `<button class="q" data-q="${n}">${n}</button>`).join('')}<button class="q" data-q="max">Todo</button></div>
    <button class="primary" data-act="save">Guardar jugada</button>
    ${p || bet ? '<div class="help">Podés cambiarla hasta que empiece el partido.</div>' : ''}${footer}</article>`;
}

function renderMatches() {
  const chips = [['', 'Todos'], ...S.comps.map((c) => [String(c.id), c.name])];
  let html = `<div class="seg"><button data-scope="upcoming" class="${S.scope === 'upcoming' ? 'on' : ''}">Próximos</button><button data-scope="results" class="${S.scope === 'results' ? 'on' : ''}">Resultados</button></div>
    <div class="chips">${chips.map(([id, n]) => `<button class="chip ${S.comp === id ? 'on' : ''}" data-comp="${id}">${esc(n)}</button>`).join('')}</div>`;
  if (S.loading && !S.matches.length) html += '<div class="empty">Cargando…</div>';
  else if (!S.matches.length) html += `<div class="empty">${S.scope === 'upcoming' ? 'No hay partidos próximos.' : 'Todavía no hay resultados.'}<br><span class="help">${S.me.is_admin ? 'Entrá a Perfil → Administración y tocá “Actualizar fixture”.' : 'El administrador tiene que cargar los torneos.'}</span></div>`;
  else {
    let last = '';
    for (const m of S.matches) {
      const k = dayKey(m.kickoff);
      if (k !== last) { html += `<h2 class="day">${esc(fmtDay(m.kickoff))}</h2>`; last = k; }
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
    const [matches, comps, me] = await Promise.all([api('GET', `/api/matches?${q}`), api('GET', '/api/competitions'), api('GET', '/api/me')]);
    S.matches = matches; S.comps = comps; applyBundle(me);
  } catch (e) { toast(e.message, true); }
  S.loading = false;
  if (S.tab === 'matches' && !document.activeElement?.matches?.('input, textarea')) renderMatches();
}

function paintPlays(card, id) {
  const box = card.querySelector('[data-box=plays]'), rows = S.plays[id]; if (!rows) return;
  const pn = (r) => (r.pick === 'L' ? 'Local' : r.pick === 'V' ? 'Visit.' : 'Empate');
  box.innerHTML = rows.length ? rows.map((r) => `<div><span class="who">${avatar(r, 20)} ${esc(r.nick)}</span><span>${r.home != null ? `${r.home}-${r.away}` : '—'}${r.pick ? ` · ${r.stake}🪙 ${pn(r)}` : ''}${r.points != null ? ` · <span class="pts-${r.points}">${r.points} pt</span>` : ''}${r.payout != null && r.payout !== r.stake ? ` · ${r.payout > r.stake ? `<span class="win">+${r.payout - r.stake}</span>` : `<span class="lose">-${r.stake}</span>`}` : ''}</span></div>`).join('') : '<div>Nadie jugó este partido</div>';
  box.hidden = false;
}
function paintThread(card, id) {
  const box = card.querySelector('[data-box=thread]'), items = S.threads[id]; if (!items) return;
  box.innerHTML = `${items.length ? items.map((c) => `<div class="msg">${avatar(c, 26)}<div><b>${esc(c.nick)}</b> <small>${fmtAgo(c.created_at)}</small>${c.user_id === S.me.id || group()?.is_owner ? ` <button class="x" data-del="${c.id}" aria-label="Borrar">✕</button>` : ''}<br>${esc(c.body)}</div></div>`).join('') : '<div class="help">Todavía no hay comentarios. ¡Mandá la primera cargada!</div>'}
    <form class="msgform" data-id="${id}"><input class="field" name="body" maxlength="280" placeholder="Escribí un comentario" autocomplete="off"><button class="primary nomargin" type="submit">Enviar</button></form>`;
  box.hidden = false;
}

// ---------- ranking ----------
async function renderRanking() {
  shell('<div class="empty">Cargando…</div>');
  const R = S.rank, q = new URLSearchParams(); if (R.comp) q.set('comp', R.comp); if (R.round) q.set('round', R.round);
  const [{ filtered, players }, comps] = await Promise.all([api('GET', `/api/groups/${S.gid}/ranking?${q}`), api('GET', '/api/competitions')]);
  S.comps = comps;
  const rounds = comps.find((c) => String(c.id) === R.comp)?.rounds || [];
  const byPts = R.mode === 'points';
  const val = (p) => (byPts ? p.points : filtered ? p.net : p.coins);
  const sorted = [...players].sort((a, b) => byPts ? b.points - a.points || b.exact - a.exact || b.net - a.net : val(b) - val(a) || b.points - a.points);
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  shell(`<div class="seg"><button data-rank="coins" class="${byPts ? '' : 'on'}">🪙 Fichas</button><button data-rank="points" class="${byPts ? 'on' : ''}">🎯 Puntos PRODE</button></div>
    <div class="inline two"><select class="field" id="rkComp"><option value="">Todos los torneos</option>${comps.map((c) => `<option value="${c.id}" ${String(c.id) === R.comp ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <select class="field" id="rkRound" ${rounds.length ? '' : 'disabled'}><option value="">Todas las fechas</option>${rounds.map((r) => `<option ${r === R.round ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    <table><thead><tr><th>#</th><th>Jugador</th><th>${byPts ? 'Pts' : filtered ? 'Neto' : 'Fichas'}</th><th>${byPts ? 'Exactos' : 'Pts'}</th></tr></thead><tbody>
    ${sorted.map((p, i) => `<tr class="${p.id === S.me.id ? 'me' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td>
      <td><span class="who">${avatar(p, 28)}<span>${esc(p.nick)}${p.fav_team ? `<small>${esc(p.fav_team)}</small>` : ''}</span></span></td>
      <td>${byPts ? p.points : filtered ? `<span class="${p.net > 0 ? 'win' : p.net < 0 ? 'lose' : ''}">${sign(p.net)}</span>` : p.coins.toLocaleString('es-AR')}</td><td>${byPts ? p.exact : p.points}</td></tr>`).join('')}</tbody></table>
    <p class="help">${filtered ? 'Con un filtro se ve lo ganado o perdido en esa fecha o torneo. Elegí un torneo y una fecha para saber quién ganó la semana.' : `Todos arrancan con ${S.cfg.start_coins || 1000} fichas. Puntos: 3 por resultado exacto, 1 por acertar ganador o empate.`}</p>`);
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
  shell(`<div class="box"><h3>Invitá a tus amigos</h3><div class="code">${esc(g.code)}</div>
      <p class="help">Pasales este código (o el link). Lo ponen al crear su cuenta o en “Unirme con un código”.</p>
      <div class="inline two"><button class="ghost" data-copy="${esc(g.code)}">Copiar código</button><button class="ghost" data-share="${esc(share)}" data-name="${esc(g.name)}">Compartir link</button></div></div>
    <div class="box"><h3>Integrantes (${members.length})</h3>${members.map((m) => `<div class="row"><div class="who">${avatar(m, 34)}<span>${esc(m.nick)}${m.is_owner ? ' ⭐' : ''}<small>${m.fav_team ? esc(m.fav_team) + ' · ' : ''}${m.coins} fichas</small></span></div>
      ${g.is_owner ? `<div><button class="ghost" data-coins="${m.id}" data-n="${esc(m.nick)}">± fichas</button> ${m.id !== S.me.id ? `<button class="ghost" data-temp="${m.id}" data-n="${esc(m.nick)}">Clave</button>` : ''}</div>` : ''}</div>`).join('')}</div>
    ${g.is_owner ? `<div class="box"><h3>Ajustes del grupo</h3><input class="field" id="gName" value="${esc(g.name)}" maxlength="30">${swatches('gColor', g.color)}
      <button class="primary" data-act="saveGroup">Guardar nombre y color</button><button class="ghost block" style="margin-top:8px" data-act="newCode">Generar un código nuevo</button>
      <p class="help">“Clave” sirve si alguien olvidó su contraseña: le ponés una temporal y se la pasás.</p></div>` : `<button class="ghost block" data-act="leave">Salir de este grupo</button>`}
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
    ${u.is_admin ? '<div id="adminBox" class="box"><h3>Administración</h3><div class="help">Cargando…</div></div>' : ''}
    <button class="ghost block" data-act="logout">Cerrar sesión</button>`);
  if (u.is_admin) paintAdmin();
}

async function paintAdmin() {
  const ov = await api('GET', '/api/admin/overview'); const comps = ov.competitions;
  const open = (await api('GET', `/api/matches?${gq()}&scope=upcoming`)).filter((m) => m.locked);
  const box = document.getElementById('adminBox'); if (!box) return;
  box.innerHTML = `<h3>Administración</h3><p class="help">Solo la ves vos: manejás los torneos y el fixture para todos los grupos.</p>
    <button class="primary" style="margin-top:0" data-act="sync">🔄 Actualizar fixture ahora</button>
    <p class="help">Se actualiza solo (resultados cada 10 min, fixture cada 6 h). Este botón también busca torneos nuevos.</p>
    <h3 style="margin-top:14px">Torneos</h3>${comps.length ? comps.map((c) => `<div class="row"><div>${esc(c.name)}<small>${esc(c.country || '')} · ${c.matches} partidos</small></div><input class="switch" type="checkbox" data-comp-toggle="${c.id}" ${c.enabled ? 'checked' : ''} aria-label="Activar ${esc(c.name)}"></div>`).join('') : '<p class="help">Todavía no hay torneos. Tocá “Actualizar fixture”.</p>'}
    <div class="inline two" style="margin-top:10px"><input class="field" id="newComp" placeholder="Torneo propio (ej: Mundial)"><button class="ghost" data-act="addComp">Crear</button></div>
    <h3 style="margin-top:14px">Cargar partido a mano</h3><div class="inline"><select class="field" id="mComp">${comps.filter((c) => c.enabled).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div class="inline two"><input class="field" id="mHome" placeholder="Local"><input class="field" id="mAway" placeholder="Visitante"></div><input class="field" id="mRound" placeholder="Fecha (ej: Fecha 3)"><input class="field" id="mWhen" type="datetime-local"><button class="ghost" data-act="addMatch">Agregar partido</button></div>
    <h3 style="margin-top:14px">Cargar resultado a mano</h3><p class="help">Por si la fuente de datos tarda o falla.</p>
    ${open.length ? open.map((m) => `<div class="row" data-mid="${m.id}"><div>${esc(m.home)} vs ${esc(m.away)}<small>${esc(m.comp)}</small></div><div><input class="mini" data-r="h" type="number" min="0" aria-label="Goles local"> <input class="mini" data-r="a" type="number" min="0" aria-label="Goles visitante"> <button class="ghost" data-act="result">OK</button></div></div>`).join('') : '<p class="help">No hay partidos esperando resultado.</p>'}`;
}

// ---------- dispatcher ----------
async function render() {
  if (!S.token) return renderAuth();
  if (!S.me) { try { applyBundle(await api('GET', '/api/me')); } catch { return renderAuth(); } }
  if (!S.groups.length) return renderOnboarding();
  try {
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
    else if (t.id === 'rkComp') { S.rank.comp = t.value; S.rank.round = ''; renderRanking(); }
    else if (t.id === 'rkRound') { S.rank.round = t.value; renderRanking(); }
    else if (t.id === 'photo' && t.files[0]) {
      const data = await resizePhoto(t.files[0]);
      applyBundle(await api('PATCH', '/api/me', { avatar: data })); toast('Foto actualizada'); render();
    } else if (t.dataset.compToggle) { await api('PATCH', `/api/admin/competitions/${t.dataset.compToggle}`, { enabled: t.checked }); toast('Listo'); }
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
    if (t.dataset.pick && card) { card.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b === t)); return; }
    if (t.dataset.q && card) { card.querySelector('[name=stake]').value = t.dataset.q === 'max' ? group().coins + (Number(card.dataset.old) || 0) : t.dataset.q; return; }
    if (t.dataset.del) { await api('DELETE', `/api/comments/${t.dataset.del}`); const id = card.dataset.id; S.threads[id] = await api('GET', `/api/matches/${id}/comments?${gq()}`); return paintThread(card, id); }
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
    if (t.dataset.coins) {
      const n = parseInt(prompt(`Fichas a sumar (o restar con -) a ${t.dataset.n}:`, '100'), 10);
      if (Number.isInteger(n)) { await api('POST', `/api/groups/${S.gid}/members/${t.dataset.coins}/coins`, { delta: n }); applyBundle(await api('GET', '/api/me')); render(); }
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
  const h = card.querySelector('[name=h]').value, a = card.querySelector('[name=a]').value;
  const stake = parseInt(card.querySelector('[name=stake]').value, 10), pick = card.querySelector('.pick.on')?.dataset.pick;
  const body = {};
  if (h !== '' || a !== '') {
    if (h === '' || a === '') return toast('Completá los dos resultados', true);
    body.prediction = { home: parseInt(h, 10), away: parseInt(a, 10) };
  }
  if (pick || stake) {
    if (!pick || !stake) return toast('Elegí a quién apostás y cuántas fichas', true);
    body.bet = { pick, stake };
  } else body.bet = null;
  if (!body.prediction && !body.bet) return toast('No cargaste nada para guardar', true);
  btn.disabled = true;
  try { await api('PUT', `/api/matches/${card.dataset.id}/play?${gq()}`, body); toast('¡Jugada guardada!'); await loadMatches(); }
  catch (err) { toast(err.message, true); btn.disabled = false; }
}

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
