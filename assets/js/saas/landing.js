/* ==========================================================================
   PARALLAX Suite · Landing de ventas
   Navegación, revelado, profundidad y los tres diálogos: demostración,
   prueba gratuita (alta de un nuevo tenant) e ingreso.
   ========================================================================== */
(function (root) {
  'use strict';

  const S = root.PLX_SAAS;
  const doc = document;
  const $ = (s, c = doc) => c.querySelector(s);
  const $$ = (s, c = doc) => Array.from(c.querySelectorAll(s));
  const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PANEL = 'suite-panel.html';

  $('#year').textContent = new Date().getFullYear();

  /* ---------- Cabecera y menú ---------- */
  const header = $('.site-header');
  const toggle = $('.nav-toggle');
  const setNav = (open) => {
    doc.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setNav(!doc.body.classList.contains('nav-open')));
  $$('#site-nav a').forEach((a) => a.addEventListener('click', () => setNav(false)));
  const onScroll = () => header.classList.toggle('is-scrolled', root.scrollY > 24);
  root.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const links = $$('[data-nav]');
  const secs = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in root) {
    const spy = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (e.isIntersecting) links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${e.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach((s) => spy.observe(s));
  }

  /* ---------- Revelado al hacer scroll ---------- */
  const reveals = $$('.reveal');
  $$('.hero .reveal').forEach((el, i) => el.style.setProperty('--d', `${0.1 + i * 0.1}s`));
  $$('.services, .plans, .pillars, .steps').forEach((g) => $$('.reveal', g).forEach((el, i) => el.style.setProperty('--d', `${(i % 4) * 0.08}s`)));
  if ('IntersectionObserver' in root && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } }), { threshold: 0.12 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('is-visible'));

  /* ---------- Profundidad con el puntero y brillo en tarjetas ---------- */
  if (!reduce) {
    const layers = $$('[data-depth]');
    let tx = 0, ty = 0, raf = 0;
    root.addEventListener('pointermove', (e) => {
      tx = e.clientX / root.innerWidth - 0.5;
      ty = e.clientY / root.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        layers.forEach((el) => { const d = Number(el.dataset.depth) || 0; el.style.translate = `${tx * d * 22}px ${ty * d * 22}px`; });
      });
    }, { passive: true });
  }
  $$('[data-spot]').forEach((c) => c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`);
    c.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  /* ---------- Diálogos ---------- */
  const dlgs = { demo: $('#dlg-demo'), reg: $('#dlg-reg'), login: $('#dlg-login') };
  function abrir(nombre) {
    Object.values(dlgs).forEach((d) => { if (d.open) d.close(); });
    const d = dlgs[nombre];
    if (!d) return;
    if (nombre === 'demo') cargarDemo();
    d.showModal();
    const first = $('input, button.demo-card', d);
    if (first) first.focus();
  }
  doc.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); setNav(false); abrir(o.dataset.open); return; }
    const c = e.target.closest('[data-close]');
    if (c) { c.closest('dialog').close(); return; }
    if (e.target.tagName === 'DIALOG') e.target.close();
  });

  /* Demostración: cuentas de ejemplo */
  const TAGS = {
    activa: ['cyan', 'Activa'], trial: ['grad', 'Trial'], impaga: ['magenta', 'Impaga']
  };
  async function cargarDemo() {
    const box = $('#demo-list');
    const lista = (await S.ensureDemo()).filter((t) => t.demo);
    box.innerHTML = lista.map((t) => {
      const ef = S.efectivo(t);
      const [tono, txt] = TAGS[ef.estado];
      return `<button type="button" class="demo-card" data-tenant="${esc(t.id)}">
        <strong>${esc(t.nombre)}</strong>
        <span class="tags"><span class="tag ${t.plan === 'ejecutivo' ? 'cyan' : ''}">${t.plan === 'ejecutivo' ? 'Plan Ejecutivo' : 'Plan Base'}</span><span class="tag ${tono}">${txt}</span></span>
        <small>${esc(t.nota || '')}</small>
      </button>`;
    }).join('') + `<p class="tiny muted">Para ingresar con email: <span class="mono">base@nodonorte.example</span> · contraseña <span class="mono">${esc(S.DEMO_PASS)}</span> (idem las otras cuentas).</p>`;
  }
  $('#demo-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tenant]');
    if (!b) return;
    S.entrar(b.dataset.tenant);
    root.location.href = PANEL;
  });

  /* Alta de un nuevo coworking (prueba gratuita) */
  const formReg = $('#form-reg');
  formReg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#rg-err');
    err.hidden = true;
    const f = new FormData(formReg);
    const btn = $('button[type=submit]', formReg);
    btn.disabled = true;
    try {
      await S.registrar({ coworking: f.get('coworking'), duenio: f.get('duenio'), email: f.get('email'), password: f.get('password') });
      root.location.href = PANEL;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  /* Ingreso */
  const formLogin = $('#form-login');
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#lg-err');
    err.hidden = true;
    const f = new FormData(formLogin);
    const btn = $('button[type=submit]', formLogin);
    btn.disabled = true;
    try {
      await S.ingresar(f.get('email'), f.get('password'));
      root.location.href = PANEL;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  /* Si ya hay una sesión, el botón de ingreso lleva directo al panel */
  if (S.tenant()) {
    const t = S.tenant();
    const b = $('#btn-ingresar');
    b.href = PANEL;
    b.removeAttribute('data-open');
    b.innerHTML = `<svg class="i i-sm" aria-hidden="true"><use href="#i-login"/></svg> Ir a ${esc(t.nombre)}`;
  }

  if (root.location.hash === '#acceso') abrir('login');
  S.ensureDemo();
})(window);
