/* ==========================================================================
   PARALLAX · Sitio público
   Navegación, efectos de profundidad (parallax), revelado y formulario de
   contacto conectado al Panel de Gestoría (bandeja «Consultas»).
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------
     Configuración editable del sitio
     · contactEndpoint: URL de una API propia que reciba las consultas
       (POST JSON). Si queda vacía, la consulta se guarda en la base local
       y aparece en el Panel de Gestoría de este mismo navegador.
     · canales: datos de contacto visibles; los vacíos no se muestran.
     ------------------------------------------------------------------ */
  const SITE_CONFIG = {
    contactEndpoint: '',
    canales: {
      email: '',
      telefono: '',
      whatsapp: '',
      direccion: '',
      horario: 'Lunes a viernes, de 8 a 20 h'
    }
  };

  const { util, store, domain, icon } = root.PLX;
  const doc = document;
  const $ = (s, ctx = doc) => ctx.querySelector(s);
  const $$ = (s, ctx = doc) => Array.from(ctx.querySelectorAll(s));
  const reduceMotion = root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  doc.documentElement.classList.add('js');
  store.init();

  /* ---------- Header y navegación ---------- */
  const header = $('.site-header');
  const toggle = $('.nav-toggle');
  const onScroll = () => header.classList.toggle('is-scrolled', root.scrollY > 24);
  onScroll();
  root.addEventListener('scroll', onScroll, { passive: true });

  function setNav(open) {
    doc.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    toggle.innerHTML = icon(open ? 'x' : 'menu');
  }
  toggle.addEventListener('click', () => setNav(!doc.body.classList.contains('nav-open')));
  $$('#site-nav a').forEach((a) => a.addEventListener('click', () => setNav(false)));
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

  // Enlace activo según la sección visible
  const navLinks = $$('[data-nav]');
  const sections = navLinks.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in root) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`));
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach((s) => io.observe(s));
  }

  /* ---------- Revelado progresivo ---------- */
  const reveals = $$('.reveal');
  // Escalonado dentro de cada grupo
  $$('.services, .plans, .steps').forEach((g) => {
    $$('.reveal', g).forEach((el, i) => el.style.setProperty('--d', `${(i % 4) * 0.08}s`));
  });
  $$('.hero .reveal').forEach((el, i) => el.style.setProperty('--d', `${0.15 + i * 0.1}s`));
  if ('IntersectionObserver' in root && !reduceMotion) {
    const ro = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('is-visible');
            ro.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    reveals.forEach((el) => ro.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- Parallax: capas con profundidad (puntero + scroll) ---------- */
  const depthEls = $$('[data-depth]');
  const stack = $('[data-tilt]');
  let px = 0, py = 0, tx = 0, ty = 0, sy = root.scrollY, raf = 0;

  function frame() {
    tx += (px - tx) * 0.06;
    ty += (py - ty) * 0.06;
    const heroH = root.innerHeight;
    const inHero = sy < heroH * 1.2;
    if (inHero) {
      depthEls.forEach((el) => {
        const d = parseFloat(el.dataset.depth) || 0;
        el.style.transform = `translate3d(${(tx * d * 22).toFixed(2)}px, ${(ty * d * 22 + sy * d * 0.12).toFixed(2)}px, 0)`;
      });
    }
    if (stack) {
      stack.style.transform = `rotateX(${56 - ty * 6}deg) rotateZ(${-40 + tx * 8}deg)`;
    }
    raf = Math.abs(px - tx) > 0.001 || Math.abs(py - ty) > 0.001 ? requestAnimationFrame(frame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  if (!reduceMotion) {
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      px = (e.clientX / root.innerWidth) * 2 - 1;
      py = (e.clientY / root.innerHeight) * 2 - 1;
      kick();
    }, { passive: true });
    root.addEventListener('scroll', () => { sy = root.scrollY; kick(); }, { passive: true });
    kick();
  }

  /* ---------- Spotlight en tarjetas ---------- */
  $$('[data-spot]').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  /* ---------- Campo de partículas con profundidad ---------- */
  (function particles() {
    const canvas = $('#fx-canvas');
    if (!canvas || reduceMotion) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, pts = [], running = true, last = 0;
    const COLORS = ['63,230,245', '224,76,240', '200,210,225'];

    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(110, (w * h) / 16000));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.2 + Math.random() * 0.8, // profundidad
        c: COLORS[Math.random() < 0.45 ? 0 : Math.random() < 0.6 ? 1 : 2],
        vx: (Math.random() - 0.5) * 0.12,
        vy: -0.05 - Math.random() * 0.12
      }));
    }

    function draw(t) {
      if (!running) return;
      if (t - last < 28) { requestAnimationFrame(draw); return; } // ~35 fps
      last = t;
      ctx.clearRect(0, 0, w, h);
      const ox = tx * 18, oy = ty * 18 - (root.scrollY * 0.05);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += p.vx * p.z;
        p.y += p.vy * p.z;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        const x = p.x + ox * p.z, y = ((p.y + oy * p.z) % (h + 20) + h + 20) % (h + 20) - 10;
        const r = 0.5 + p.z * 1.3;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.c},${0.18 + p.z * 0.5})`;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        p._x = x; p._y = y;
      }
      // Líneas tenues entre partículas cercanas del primer plano
      ctx.lineWidth = 0.6;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        if (a.z < 0.6) continue;
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          if (b.z < 0.6) continue;
          const dx = a._x - b._x, dy = a._y - b._y, d2 = dx * dx + dy * dy;
          if (d2 < 14000) {
            ctx.strokeStyle = `rgba(${a.c},${0.12 * (1 - d2 / 14000)})`;
            ctx.beginPath();
            ctx.moveTo(a._x, a._y);
            ctx.lineTo(b._x, b._y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }

    resize();
    root.addEventListener('resize', util.debounce(resize, 200));
    doc.addEventListener('visibilitychange', () => {
      running = !doc.hidden;
      if (running) requestAnimationFrame(draw);
    });
    requestAnimationFrame(draw);
  })();

  /* ---------- Canales de contacto ---------- */
  (function channels() {
    const c = SITE_CONFIG.canales;
    const ul = $('#contact-channels');
    const items = [];
    if (c.email) items.push(`<li><a href="mailto:${util.esc(c.email)}">${icon('mail', 'i-sm')} ${util.esc(c.email)}</a></li>`);
    if (c.telefono) items.push(`<li><a href="tel:${util.esc(c.telefono.replace(/\s/g, ''))}">${icon('phone', 'i-sm')} ${util.esc(c.telefono)}</a></li>`);
    if (c.whatsapp) items.push(`<li><a href="https://wa.me/${util.esc(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">${icon('phone', 'i-sm')} WhatsApp</a></li>`);
    if (c.direccion) items.push(`<li>${icon('map-pin', 'i-sm')} ${util.esc(c.direccion)}</li>`);
    if (c.horario) items.push(`<li>${icon('clock', 'i-sm')} ${util.esc(c.horario)}</li>`);
    if (items.length) {
      ul.innerHTML = items.join('');
      ul.hidden = false;
    }
  })();

  /* ---------- Formulario de contacto ---------- */
  const form = $('#contact-form');
  const selInteres = $('#cf-interes');
  domain.INTERESES.forEach((i) => selInteres.insertAdjacentHTML('beforeend', `<option>${util.esc(i)}</option>`));

  // Botones «Consultar» de modalidades y Asesoría → preseleccionan el interés
  $$('[data-interes]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      selInteres.value = btn.dataset.interes;
      selInteres.removeAttribute('aria-invalid');
      $('#contacto').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => $('#cf-nombre').focus({ preventScroll: true }), reduceMotion ? 0 : 700);
    });
  });

  const errBox = $('#cf-error');
  function showError(msg) {
    errBox.textContent = msg;
    errBox.hidden = !msg;
  }

  function validate(data) {
    const errors = [];
    const mark = (name, bad) => {
      const el = form.elements[name];
      if (el) el.setAttribute('aria-invalid', bad ? 'true' : 'false');
      return bad;
    };
    if (mark('nombre', data.nombre.length < 3)) errors.push('Ingresá tu nombre y apellido.');
    if (mark('email', !util.isEmail(data.email))) errors.push('Ingresá un email válido.');
    if (mark('interes', !data.interes)) errors.push('Seleccioná qué te interesa.');
    if (mark('mensaje', data.mensaje.length < 10)) errors.push('Contanos un poco más en el mensaje (mínimo 10 caracteres).');
    if (!form.elements.consentimiento.checked) errors.push('Necesitamos tu autorización para contactarte.');
    return errors;
  }

  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      nombre: String(fd.get('nombre') || '').trim(),
      empresa: String(fd.get('empresa') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      telefono: String(fd.get('telefono') || '').trim(),
      interes: String(fd.get('interes') || ''),
      puestos: parseInt(fd.get('puestos'), 10) || null,
      mensaje: String(fd.get('mensaje') || '').trim()
    };

    // Campo trampa: si un bot lo completa, se simula éxito sin registrar nada
    if (String(fd.get('web') || '').trim()) return success(data, 'OK');

    const errors = validate(data);
    if (errors.length) {
      showError(errors[0]);
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }
    showError('');
    form.classList.add('is-sending');

    const consulta = Object.assign({}, data, {
      fecha: new Date().toISOString(),
      estado: 'nueva',
      origen: 'sitio'
    });

    try {
      if (SITE_CONFIG.contactEndpoint) {
        const res = await fetch(SITE_CONFIG.contactEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(consulta)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      const rec = store.insert('consultas', consulta, 'cta');
      success(data, rec.id.slice(-6).toUpperCase());
    } catch (err) {
      console.error(err);
      showError('No pudimos enviar tu consulta. Por favor, intentá nuevamente en unos minutos.');
    } finally {
      form.classList.remove('is-sending');
    }
  });

  function success(data, ref) {
    $('#cs-nombre').textContent = data.nombre.split(' ')[0] || '';
    $('#cs-ref').textContent = `CTA-${ref}`;
    form.hidden = true;
    const ok = $('#contact-success');
    ok.hidden = false;
    ok.focus();
  }

  $('#contact-again').addEventListener('click', () => {
    form.reset();
    $$('[aria-invalid]', form).forEach((el) => el.setAttribute('aria-invalid', 'false'));
    $('#contact-success').hidden = true;
    form.hidden = false;
    $('#cf-nombre').focus();
  });

  /* ---------- Varios ---------- */
  $('#year').textContent = new Date().getFullYear();
})(window);
