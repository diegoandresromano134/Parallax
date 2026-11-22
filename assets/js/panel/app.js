/* ==========================================================================
   PARALLAX · Panel de Gestoría — enrutador y orquestación
   ---------------------------------------------------------------------------
   Rutas (hash):  #inicio · #contratos[-locatarios|-modalidades]
                  #accesos[-personas] · #consumos[-catalogo]
                  #facturacion · #consultas · #configuracion
   Cada vista expone: { title, render(ctx), actions, changes, inputs }
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui } = PLX;
  const doc = document;
  const $ = (s) => doc.querySelector(s);

  store.init({ seed: PLX.seed });

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
    return { name: parts[0] || 'inicio', sub: parts[1] || '' };
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
    const presentes = store.all('accesos').filter((a) => !a.egreso).length;
    const nuevas = store.all('consultas').filter((c) => c.estado === 'nueva').length;
    $('#live-presentes').textContent = presentes;
    const cp = $('#count-presentes');
    cp.textContent = presentes;
    cp.hidden = !presentes;
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

  if (!store.persistent) {
    $('#env-pill').innerHTML = '<span class="dot" style="background:var(--magenta)"></span><span>Almacenamiento del navegador no disponible: los cambios no se conservarán al recargar.</span>';
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
  navigate();

  PLX.app = { render: scheduleRender, state };
})(window);
