/* ==========================================================================
   PARALLAX · Ingreso (miembros y administración)
   ========================================================================== */
(function (root) {
  'use strict';

  const { backend, util } = root.PLX;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(root.location.search);
  const form = $('#login-form');
  const err = $('#lg-error');
  const msg = $('#auth-msg');
  const submit = $('#lg-submit');

  function destino(user) {
    const sig = params.get('siguiente');
    if (user.rol === 'admin') return sig === 'miembros.html' ? 'gestoria.html' : (sig && /^[a-z]+\.html$/.test(sig) && sig !== 'ingresar.html' ? sig : 'gestoria.html');
    return 'miembros.html';
  }

  function aviso(texto) {
    msg.textContent = texto;
    msg.hidden = !texto;
  }

  if (params.get('expirada')) aviso('Tu sesión terminó. Ingresá nuevamente para continuar.');

  backend.detect().then((mode) => {
    if (mode === 'demo') $('#auth-demo').hidden = false;
    const u = backend.user;
    if (u) {
      aviso(`Ya iniciaste sesión como ${u.nombre || u.usuario}.`);
      msg.insertAdjacentHTML('beforeend', ` <a href="${destino(u)}">Continuar</a> · <button type="button" class="link-inline" id="otra-cuenta">Usar otra cuenta</button>`);
      $('#otra-cuenta').addEventListener('click', () => backend.logout());
    }
  });

  $('#toggle-pass').addEventListener('click', () => {
    const p = $('#lg-pass');
    const ver = p.type === 'password';
    p.type = ver ? 'text' : 'password';
    $('#toggle-pass').setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  document.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
    const admin = b.dataset.fill === 'admin';
    $('#lg-usuario').value = admin ? backend.DEMO_ADMIN.usuario : 'CL-0005';
    $('#lg-pass').value = admin ? backend.DEMO_ADMIN.password : backend.DEMO_MIEMBRO_PASS;
    submit.focus();
  }));

  form.addEventListener('input', () => { err.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('#lg-usuario').value.trim();
    const password = $('#lg-pass').value;
    if (!usuario || !password) {
      err.textContent = 'Ingresá tu usuario y tu contraseña.';
      err.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Ingresando…';
    try {
      const user = await backend.login(usuario, password);
      root.location.href = destino(user);
    } catch (ex) {
      err.textContent = ex.message || 'No pudimos iniciar sesión.';
      err.hidden = false;
      $('#lg-pass').select();
    } finally {
      submit.disabled = false;
      submit.innerHTML = `Ingresar <svg class="i"><use href="#i-arrow-right"/></svg>`;
    }
  });

  // Recordar el último usuario (solo el nombre de usuario, nunca la contraseña)
  try {
    const last = root.localStorage.getItem('parallax.ultimoUsuario');
    if (last && !$('#lg-usuario').value) $('#lg-usuario').value = last;
    form.addEventListener('submit', () => { try { root.localStorage.setItem('parallax.ultimoUsuario', $('#lg-usuario').value.trim()); } catch (e) { /* nada */ } });
  } catch (e) { /* almacenamiento no disponible */ }

  void util;
})(window);
