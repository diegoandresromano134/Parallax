/* ==========================================================================
   PARALLAX · Panel de Gestoría — enrutador y orquestación
   ---------------------------------------------------------------------------
   Rutas (hash):  #inicio · #legajos[-personas] · #inventario · #checkin[-historial]
                  #contratos[-modalidades] · #consumos · #facturacion
                  #consultas · #configuracion
   Requiere sesión de administración (ver assets/js/core/backend.js).
   Cada vista expone: { title, render(ctx), actions, changes, inputs }
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, backend } = PLX;
  const doc = document;
  const $ = (s) => doc.querySelector(s);

  const ALIAS = { accesos: 'checkin', locatarios: 'legajos' };
  const views = PLX.views;
  const viewEl = $('#view');
  const state = {}; // estado en memoria por vista (filtros, búsqueda, período)
  let current = null;
  let routeName = '';
  let sub = '';

  function parseHash() {
    // Rutas con nombre simple (#contratos, #contratos-locatarios); acepta también el formato #/a/b
    const h = (location.hash || '#inicio').replace(/^#\/?/, '');
    const [path] = h.split('?');
    const parts = path.split(/[/-]/).filter(Boolean);
    const name = parts[0] || 'inicio';
    return { name: ALIAS[name] || name, sub: parts[1] || '' };
  }

  function ctx() {
    return {
      sub,
      state: (state[routeName] = state[routeName] || {}),
      render,
      go: (hash) => { location.hash = hash; }
    };
  }

  /** Renderiza la vista actual preservando foco y cursor de campos de búsqueda. */
  function render() {
    if (!current) return;
    const active = doc.activeElement;
    const keepId = active && viewEl.contains(active) && active.id ? active.id : null;
    const selStart = keepId && 'selectionStart' in active ? active.selectionStart : null;
    const scrollY = root.scrollY;

    viewEl.innerHTML = current.render(ctx());

    if (keepId) {
      const el = doc.getElementById(keepId);
      if (el) {
        el.focus({ preventScroll: true });
        if (selStart != null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selStart); } catch (e) { /* tipos sin selección */ }
        }
      }
    }
    root.scrollTo(0, scrollY);
    updateChrome();
  }

  let pending = 0;
  function scheduleRender() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      render();
    });
  }

  function navigate() {
    const r = parseHash();
    const next = views[r.name] ? r.name : 'inicio';
    const changedView = next !== routeName;
    routeName = next;
    sub = r.sub;
    current = views[routeName];
    doc.title = `${current.title} · PARALLAX Gestoría`;
    $('#page-crumb').textContent = current.title;
    doc.querySelectorAll('.side-link').forEach((a) => {
      const on = a.dataset.route === routeName;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    doc.body.classList.remove('side-open');
    ui.close();
    viewEl.innerHTML = current.render(ctx());
    updateChrome();
    if (changedView) {
      root.scrollTo(0, 0);
      viewEl.focus({ preventScroll: true });
    }
  }

  /* ---------- Indicadores globales ---------- */
  function updateChrome() {
    if (!backend.user) return;
    const presentes = store.all('accesos').filter((a) => !a.egreso).length;
    const nuevas = store.all('consultas').filter((c) => c.estado === 'nueva').length;
    $('#live-presentes').textContent = presentes;
    const cp = $('#count-presentes');
    cp.textContent = presentes;
    cp.hidden = !presentes;
    const deudores = store.all('locatarios').filter((l) => PLX.reglas.cuenta.estado(store.db, l.id).vencido > 0.5).length + store.all('pagos').filter((p) => p.estado === 'informado').length;
    const ck = $('#count-cobros');
    ck.textContent = deudores;
    ck.hidden = !deudores;
    const cc = $('#count-consultas');
    cc.textContent = nuevas;
    cc.hidden = !nuevas;
  }

  function tick() {
    const d = new Date();
    $('#clock').textContent = `${util.fmtDayShort(util.todayStr(d))} · ${util.pad(d.getHours())}:${util.pad(d.getMinutes())}`;
  }
  tick();
  setInterval(tick, 15000);

  function envPill() {
    const pill = $('#env-pill');
    if (backend.mode === 'servidor') {
      pill.innerHTML = '<span class="dot"></span><span>Conectado al servidor · datos compartidos</span>';
    } else if (!store.persistent) {
      pill.innerHTML = '<span class="dot" style="background:var(--magenta)"></span><span>Almacenamiento del navegador no disponible: los cambios no se conservarán al recargar.</span>';
    } else {
      pill.innerHTML = '<span class="dot" style="background:var(--magenta)"></span><span>Modo demostración · datos en este navegador</span>';
    }
    const u = backend.user;
    $('#user-name').textContent = u ? (u.nombre || u.usuario) : '';
  }

  /* ---------- Delegación de eventos ---------- */
  viewEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a || !viewEl.contains(a)) return;
    const fn = current.actions && current.actions[a.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(a, e, ctx());
    }
  });

  viewEl.addEventListener('change', (e) => {
    const a = e.target.closest('[data-change]');
    if (!a) return;
    const fn = current.changes && current.changes[a.dataset.change];
    if (fn) fn(a, e, ctx());
  });

  // Los formularios de las vistas nunca recargan la página
  viewEl.addEventListener('submit', (e) => e.preventDefault());

  const debounced = {};
  viewEl.addEventListener('input', (e) => {
    const a = e.target.closest('[data-input]');
    if (!a) return;
    const name = a.dataset.input;
    const fn = current.inputs && current.inputs[name];
    if (!fn) return;
    clearTimeout(debounced[name]);
    debounced[name] = setTimeout(() => fn(a, e, ctx()), 160);
  });

  viewEl.addEventListener('keydown', (e) => {
    const a = e.target.closest('[data-enter]');
    if (!a || e.key !== 'Enter') return;
    const fn = current.actions && current.actions[a.dataset.enter];
    if (fn) {
      e.preventDefault();
      fn(a, e, ctx());
    }
  });

  doc.addEventListener('click', (e) => {
    const g = e.target.closest('[data-action-global]');
    if (!g) return;
    const act = g.dataset.actionGlobal;
    if (act === 'open-side') doc.body.classList.add('side-open');
    if (act === 'close-side') doc.body.classList.remove('side-open');
    if (act === 'logout') backend.logout();
  });

  /* ---------- Reactividad ---------- */
  store.on((source) => {
    scheduleRender();
    if (source === 'external') updateChrome();
  });
  // Refresco periódico (permanencias en curso, «hace X min»)
  setInterval(() => {
    if (!doc.hidden && !$('#modal').open) scheduleRender();
  }, 60000);

  root.addEventListener('hashchange', navigate);
  PLX.app = { render: scheduleRender, state };

  /* ---------- Arranque: sesión de administración y datos ---------- */
  viewEl.innerHTML = '<div class="empty" style="padding:80px 0">Cargando…</div>';
  backend.boot({ rol: 'admin', seed: PLX.seed, onSyncError: (m) => ui.toast(m, 'warn') })
    .then((user) => {
      if (!user) return;
      doc.body.classList.add('is-ready');
      envPill();
      navigate();
      // Cambios hechos desde otros dispositivos (servidor)
      if (backend.mode === 'servidor') setInterval(() => { if (!doc.hidden && !$('#modal').open) backend.poll(); }, 20000);
    })
    .catch((e) => {
      console.error(e);
      viewEl.innerHTML = `<div class="empty" style="padding:80px 0">No se pudieron cargar los datos: ${util.esc(e.message)}</div>`;
    });
})(window);
