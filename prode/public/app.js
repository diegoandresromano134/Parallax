'use strict';
// PRODE Amigos — app de una sola página, sin dependencias.

const $app = document.getElementById('app');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* modo privado */ } },
};
const S = { token: store.get('token'), user: null, tab: 'matches', scope: 'upcoming', comp: '', comps: [], matches: [], loading: false, authMode: 'login' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Argentina/Buenos_Aires';
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

let toastTimer;
function toast(msg, error) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 2600);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: `Bearer ${S.token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { logout(); throw new Error('Tu sesión venció, volvé a ingresar'); }
  if (!res.ok) throw new Error(data.error || 'Error de conexión');
  return data;
}
function logout() { S.token = null; S.user = null; store.set('token', null); render(); }

// ---------- pantallas ----------
function renderAuth() {
  const reg = S.authMode === 'register';
  $app.innerHTML = `<div class="auth">
    <h1>⚽ PRODE Amigos</h1><p class="sub">Pronósticos y fichas ficticias, sin plata de verdad</p>
    <div class="seg" style="margin-top:24px"><button data-auth="login" class="${reg ? '' : 'on'}">Ingresar</button><button data-auth="register" class="${reg ? 'on' : ''}">Crear cuenta</button></div>
    <form id="authForm" autocomplete="off">
      <label>Tu nombre</label><input class="field" name="name" maxlength="20" required autocapitalize="words">
      <label>PIN (4 a 8 números)</label><input class="field" name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" required>
      ${reg ? '<label>Código del grupo (te lo pasa el administrador)</label><input class="field" name="code" required autocapitalize="none">' : ''}
      <div class="err" id="authErr"></div>
      <button class="primary" type="submit">${reg ? 'Crear cuenta' : 'Entrar'}</button>
    </form></div>`;
}

function shell(inner) {
  const tabs = [['matches', '⚽', 'Partidos'], ['ranking', '🏆', 'Ranking'], ['more', '⚙️', S.user.is_admin ? 'Admin' : 'Perfil']];
  $app.innerHTML = `<header class="top"><h1>⚽ PRODE Amigos</h1><div class="coins">🪙 ${S.user.coins.toLocaleString('es-AR')}</div></header>
    <main>${inner}</main>
    <nav class="tabs">${tabs.map(([k, i, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
}

const badge = (url, name) => url ? `<img src="${esc(url)}/tiny" alt="" loading="lazy" onerror="this.outerHTML='<div class=ph>${esc(name[0])}</div>'">` : `<div class="ph">${esc(name[0])}</div>`;
const pickName = (m, k) => (k === 'L' ? m.home : k === 'V' ? m.away : 'Empate');

function matchCard(m) {
  const { prediction: p, bet } = m.mine;
  const when = `${fmtTime(m.kickoff)} hs`;
  const live = m.status === 'live' ? '<span class="live">● EN JUEGO</span>' : m.status === 'postponed' ? '<span class="live">POSTERGADO</span>' : when;
  const totalPool = m.pool.L.total + m.pool.E.total + m.pool.V.total;
  const header = `<div class="meta"><span>${esc(m.comp)}${m.round ? ' · ' + esc(m.round) : ''}</span><span>${live}</span></div>`;
  const team = (n, b) => `<div class="team">${badge(b, n)}<span>${esc(n)}</span></div>`;

  if (m.status === 'finished' || m.status === 'cancelled') {
    const cancelled = m.status === 'cancelled';
    const lines = [];
    if (p) lines.push(`Tu pronóstico: <b>${p.home}-${p.away}</b> → <span class="pts-${p.points ?? 0}">${p.points == null ? '' : p.points + (p.points === 1 ? ' punto' : ' puntos')}</span>`);
    if (bet) {
      const net = (bet.payout ?? 0) - bet.stake;
      lines.push(`Tu apuesta: ${bet.stake} 🪙 a <b>${esc(pickName(m, bet.pick))}</b> → ` +
        (bet.payout == null ? '' : cancelled ? 'devuelta' : net > 0 ? `<span class="win">+${net} 🪙</span>` : net === 0 ? 'te devolvieron las fichas' : `<span class="lose">${net} 🪙</span>`));
    }
    return `<article class="card" data-id="${m.id}">${header}
      <div class="teams">${team(m.home, m.home_badge)}<div class="score final">${cancelled ? 'Susp.' : `${m.home_goals} - ${m.away_goals}`}</div>${team(m.away, m.away_badge)}</div>
      <div class="result">${lines.join('') ? lines.map((l) => `<div>${l}</div>`).join('') : '<div>No jugaste este partido</div>'}</div>
      <button class="ghost" data-act="plays" style="margin-top:10px">Ver jugadas del grupo</button><div class="plays" hidden></div></article>`;
  }

  if (m.locked) {
    return `<article class="card" data-id="${m.id}">${header}
      <div class="teams">${team(m.home, m.home_badge)}<div class="score final">${m.home_goals ?? '·'} - ${m.away_goals ?? '·'}</div>${team(m.away, m.away_badge)}</div>
      <div class="result"><div>🔒 Cerrado. ${p ? `Tu pronóstico: <b>${p.home}-${p.away}</b>.` : 'No pronosticaste.'} ${bet ? `Apostaste ${bet.stake} 🪙 a <b>${esc(pickName(m, bet.pick))}</b>.` : ''}</div>
      <div>Pozo en juego: <b>${totalPool} 🪙</b></div></div>
      <button class="ghost" data-act="plays" style="margin-top:10px">Ver jugadas del grupo</button><div class="plays" hidden></div></article>`;
  }

  const sel = bet?.pick;
  const pick = (k) => {
    const pl = m.pool[k];
    return `<button class="pick ${sel === k ? 'on' : ''}" data-pick="${k}">${esc(pickName(m, k))}<small>${pl.total ? `${pl.total} 🪙 · ${pl.n}` : 'sin apuestas'}</small></button>`;
  };
  return `<article class="card" data-id="${m.id}" data-old="${bet?.stake ?? 0}">${header}
    <div class="teams">${team(m.home, m.home_badge)}
      <div class="score"><input name="h" type="number" inputmode="numeric" min="0" max="30" value="${p?.home ?? ''}" placeholder="-" aria-label="Goles ${esc(m.home)}">
      <span>:</span><input name="a" type="number" inputmode="numeric" min="0" max="30" value="${p?.away ?? ''}" placeholder="-" aria-label="Goles ${esc(m.away)}"></div>
      ${team(m.away, m.away_badge)}</div>
    <div class="picks">${['L', 'E', 'V'].map(pick).join('')}</div>
    <div class="stake"><span class="help">Apuesta:</span>
      <input name="stake" type="number" inputmode="numeric" min="10" step="10" value="${bet?.stake ?? ''}" placeholder="fichas">
      ${[50, 100, 250].map((n) => `<button class="q" data-q="${n}">${n}</button>`).join('')}<button class="q" data-q="max">Todo</button></div>
    <button class="primary" data-act="save">Guardar jugada</button>
    ${p || bet ? '<div class="help" style="margin-top:6px">Podés cambiarla hasta que empiece el partido.</div>' : ''}</article>`;
}

function renderMatches() {
  const chips = [['', 'Todos'], ...S.comps.map((c) => [String(c.id), c.name])];
  let html = `<div class="seg"><button data-scope="upcoming" class="${S.scope === 'upcoming' ? 'on' : ''}">Próximos</button><button data-scope="results" class="${S.scope === 'results' ? 'on' : ''}">Resultados</button></div>
    <div class="chips">${chips.map(([id, n]) => `<button class="chip ${S.comp === id ? 'on' : ''}" data-comp="${id}">${esc(n)}</button>`).join('')}</div>`;
  if (S.loading && !S.matches.length) html += '<div class="empty">Cargando…</div>';
  else if (!S.matches.length) html += `<div class="empty">${S.scope === 'upcoming' ? 'No hay partidos próximos.' : 'Todavía no hay resultados.'}<br><span class="help">${S.user.is_admin ? 'Entrá a Admin y tocá “Actualizar fixture”.' : 'El administrador tiene que cargar los torneos.'}</span></div>`;
  else {
    let last = '';
    for (const m of S.matches) {
      const k = dayKey(m.kickoff);
      if (k !== last) { html += `<h2 class="day">${esc(fmtDay(m.kickoff))}</h2>`; last = k; }
      html += matchCard(m);
    }
  }
  shell(html);
}

async function renderRanking() {
  shell('<div class="empty">Cargando…</div>');
  const { start, players } = await api('GET', '/api/ranking');
  const byPts = S.rankBy === 'points';
  const sorted = [...players].sort((a, b) => byPts ? b.points - a.points || b.exact - a.exact : b.coins - a.coins);
  shell(`<div class="seg"><button data-rank="coins" class="${byPts ? '' : 'on'}">🪙 Fichas</button><button data-rank="points" class="${byPts ? 'on' : ''}">🎯 Puntos PRODE</button></div>
    <table><thead><tr><th>#</th><th>Jugador</th><th>${byPts ? 'Pts' : 'Fichas'}</th><th>${byPts ? 'Exactos' : 'Ganadas'}</th></tr></thead><tbody>
    ${sorted.map((p, i) => `<tr class="${p.id === S.user.id ? 'me' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td>${esc(p.name)}</td>
      <td>${byPts ? p.points : p.coins.toLocaleString('es-AR')}</td><td>${byPts ? p.exact : `${p.bets_won}/${p.bets_done}`}</td></tr>`).join('')}</tbody></table>
    <p class="help">Todos arrancan con ${start} fichas. Fichas = apuestas al pozo. Puntos = 3 por resultado exacto, 1 por acertar ganador o empate.</p>`);
}

async function renderMore() {
  if (!S.user.is_admin) {
    shell(`<div class="box"><h3>Cómo se juega</h3><p class="help">1) Poné el resultado que creés que sale.<br>2) Elegí local / empate / visitante y apostá fichas: todas las fichas del partido forman un pozo que se reparte entre los que acertaron.<br>3) Si nadie acierta, se devuelven las fichas.<br>Todo se cierra cuando arranca el partido.</p></div>
      <button class="ghost" data-act="logout" style="width:100%">Cerrar sesión (${esc(S.user.name)})</button>`);
    return;
  }
  shell('<div class="empty">Cargando…</div>');
  const ov = await api('GET', '/api/admin/overview');
  const comps = ov.competitions;
  shell(`<div class="box"><h3>Invitá a tus amigos</h3><div class="code">${esc(ov.invite)}</div>
      <p class="help">Código de grupo para crear cuenta. Pasales este código y la dirección de la app.</p></div>
    <div class="box"><h3>Fixture y resultados</h3>
      <button class="primary" style="margin:0" data-act="sync">🔄 Actualizar fixture ahora</button>
      <p class="help">Se actualiza solo (resultados cada 10 min, fixture cada 6 h). Este botón también busca torneos nuevos.</p></div>
    <div class="box"><h3>Torneos</h3>
      ${comps.length ? comps.map((c) => `<div class="row"><div>${esc(c.name)}<small>${esc(c.country || '')} · ${c.matches} partidos</small></div>
        <input class="switch" type="checkbox" data-comp-toggle="${c.id}" ${c.enabled ? 'checked' : ''}></div>`).join('') : '<p class="help">Todavía no hay torneos. Tocá “Actualizar fixture”.</p>'}
      <div class="inline two" style="margin-top:10px"><input class="field" id="newComp" placeholder="Torneo propio (ej: Mundial)"><button class="ghost" data-act="addComp">Crear</button></div></div>
    <div class="box"><h3>Cargar partido a mano</h3>
      <div class="inline"><select class="field" id="mComp">${comps.filter((c) => c.enabled).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div class="inline two"><input class="field" id="mHome" placeholder="Local"><input class="field" id="mAway" placeholder="Visitante"></div>
      <input class="field" id="mWhen" type="datetime-local"><button class="ghost" data-act="addMatch">Agregar partido</button></div></div>
    <div class="box"><h3>Cargar resultado a mano</h3><p class="help">Por si la fuente de datos tarda o falla.</p><div id="pending"></div></div>
    <div class="box"><h3>Jugadores</h3>${ov.users.map((u) => `<div class="row"><div>${esc(u.name)}${u.is_admin ? ' ⭐' : ''}<small>${u.coins} fichas</small></div>
      <div><button class="ghost" data-coins="${u.id}" data-n="${esc(u.name)}">± fichas</button> <button class="ghost" data-pin="${u.id}" data-n="${esc(u.name)}">PIN</button></div></div>`).join('')}</div>
    <button class="ghost" data-act="logout" style="width:100%">Cerrar sesión (${esc(S.user.name)})</button>`);
  // partidos que ya empezaron y siguen sin resultado
  const all = (await api('GET', '/api/matches?scope=upcoming')).filter((m) => m.locked);
  document.getElementById('pending').innerHTML = all.length ? all.map((m) => `<div class="row" data-mid="${m.id}"><div>${esc(m.home)} vs ${esc(m.away)}<small>${esc(m.comp)}</small></div>
    <div><input class="field" style="width:48px;padding:6px;display:inline" data-r="h" type="number" min="0"> <input class="field" style="width:48px;padding:6px;display:inline" data-r="a" type="number" min="0">
    <button class="ghost" data-act="result">OK</button></div></div>`).join('') : '<p class="help">No hay partidos esperando resultado.</p>';
}

async function render() {
  if (!S.token) return renderAuth();
  if (!S.user) {
    try { S.user = await api('GET', '/api/me'); } catch { return renderAuth(); }
  }
  if (S.tab === 'ranking') return renderRanking();
  if (S.tab === 'more') return renderMore();
  renderMatches();
  loadMatches();
}

async function loadMatches() {
  S.loading = true;
  try {
    const q = new URLSearchParams({ scope: S.scope }); if (S.comp) q.set('comp', S.comp);
    [S.matches, S.comps] = await Promise.all([api('GET', `/api/matches?${q}`), api('GET', '/api/competitions')]);
    S.user = await api('GET', '/api/me');
  } catch (e) { toast(e.message, true); }
  S.loading = false;
  if (S.tab === 'matches' && !document.activeElement?.matches?.('input')) renderMatches();
}

// ---------- eventos ----------
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'authForm') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('POST', S.authMode === 'register' ? '/api/register' : '/api/login', f);
    S.token = r.token; S.user = r.user; store.set('token', r.token); render();
  } catch (err) { document.getElementById('authErr').textContent = err.message; }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, input.switch'); if (!t) return;
  const card = t.closest('.card');
  try {
    if (t.dataset.auth) { S.authMode = t.dataset.auth; return renderAuth(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; return render(); }
    if (t.dataset.scope) { S.scope = t.dataset.scope; S.matches = []; renderMatches(); return loadMatches(); }
    if (t.dataset.comp !== undefined && t.classList.contains('chip')) { S.comp = t.dataset.comp; S.matches = []; renderMatches(); return loadMatches(); }
    if (t.dataset.rank) { S.rankBy = t.dataset.rank; return renderRanking(); }
    if (t.dataset.pick && card) { card.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b === t)); return; }
    if (t.dataset.q && card) {
      const inp = card.querySelector('[name=stake]');
      inp.value = t.dataset.q === 'max' ? S.user.coins + (Number(card.dataset.old) || 0) : t.dataset.q; return;
    }
    if (t.dataset.act === 'save' && card) return saveCard(card, t);
    if (t.dataset.act === 'plays' && card) return showPlays(card, t);
    if (t.dataset.act === 'logout') return logout();
    if (t.dataset.compToggle) { await api('PATCH', `/api/admin/competitions/${t.dataset.compToggle}`, { enabled: t.checked }); return toast('Listo'); }
    if (t.dataset.act === 'sync') {
      t.disabled = true; t.textContent = 'Buscando partidos…';
      const r = await api('POST', '/api/admin/sync');
      const errs = r.report.filter((x) => x.error);
      toast(`${r.report.reduce((s, x) => s + (x.matches || 0), 0)} partidos en ${r.report.length} torneos` + (errs.length ? ` (${errs.length} con error)` : ''), !!errs.length);
      return renderMore();
    }
    if (t.dataset.act === 'addComp') {
      const name = document.getElementById('newComp').value.trim(); if (!name) return;
      await api('POST', '/api/admin/competitions', { name }); toast('Torneo creado'); return renderMore();
    }
    if (t.dataset.act === 'addMatch') {
      const v = (id) => document.getElementById(id).value;
      await api('POST', '/api/admin/matches', { comp_id: v('mComp'), home: v('mHome'), away: v('mAway'), kickoff: new Date(v('mWhen')).toISOString() });
      toast('Partido agregado'); return renderMore();
    }
    if (t.dataset.act === 'result') {
      const row = t.closest('[data-mid]'); const g = (k) => parseInt(row.querySelector(`[data-r=${k}]`).value, 10);
      await api('POST', `/api/admin/matches/${row.dataset.mid}/result`, { home: g('h'), away: g('a') });
      toast('Resultado cargado y fichas repartidas'); return renderMore();
    }
    if (t.dataset.coins) {
      const n = parseInt(prompt(`Fichas a sumar (o restar con -) a ${t.dataset.n}:`, '100'), 10);
      if (Number.isInteger(n)) { await api('POST', `/api/admin/users/${t.dataset.coins}/coins`, { delta: n }); renderMore(); }
      return;
    }
    if (t.dataset.pin) {
      const pin = prompt(`Nuevo PIN para ${t.dataset.n} (4 a 8 números):`);
      if (pin) { await api('POST', `/api/admin/users/${t.dataset.pin}/pin`, { pin }); toast('PIN cambiado'); }
    }
  } catch (err) { toast(err.message, true); if (t.disabled) renderMore(); }
});

async function saveCard(card, btn) {
  const id = card.dataset.id;
  const h = card.querySelector('[name=h]').value, a = card.querySelector('[name=a]').value;
  const stake = parseInt(card.querySelector('[name=stake]').value, 10);
  const pick = card.querySelector('.pick.on')?.dataset.pick;
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
  try {
    S.user = await api('PUT', `/api/matches/${id}/play`, body);
    toast('¡Jugada guardada!');
    await loadMatches();
  } catch (err) { toast(err.message, true); btn.disabled = false; }
}

async function showPlays(card, btn) {
  const box = card.querySelector('.plays');
  if (!box.hidden) { box.hidden = true; return; }
  const rows = await api('GET', `/api/matches/${card.dataset.id}/plays`);
  const pn = (r) => (r.pick === 'L' ? 'Local' : r.pick === 'V' ? 'Visit.' : 'Empate');
  box.innerHTML = rows.length ? rows.map((r) => `<div><span>${esc(r.name)}</span><span>${r.home != null ? `${r.home}-${r.away}` : '—'}${r.pick ? ` · ${r.stake}🪙 ${pn(r)}` : ''}${r.points != null ? ` · <span class="pts-${r.points}">${r.points} pt</span>` : ''}${r.payout != null && r.payout !== r.stake ? ` · ${r.payout > r.stake ? '<span class=win>+' + (r.payout - r.stake) + '</span>' : '<span class=lose>-' + r.stake + '</span>'}` : ''}</span></div>`).join('') : '<div>Nadie jugó este partido</div>';
  box.hidden = false;
}

// refrescar al volver a la app (resultados nuevos) y cada minuto si está abierta en Partidos
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.tab === 'matches') loadMatches(); });
setInterval(() => { if (!document.hidden && S.token && S.tab === 'matches' && !document.activeElement?.matches?.('input')) loadMatches(); }, 60000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
