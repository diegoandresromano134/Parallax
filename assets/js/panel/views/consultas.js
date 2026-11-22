/* ==========================================================================
   PARALLAX · Vista: Consultas recibidas desde el sitio público
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, icon } = PLX;
  const esc = util.esc;

  const ESTADOS = {
    nueva: { label: 'Nueva', tone: 'magenta' },
    respondida: { label: 'Respondida', tone: 'cyan' },
    convertida: { label: 'Locatario creado', tone: 'grad' },
    archivada: { label: 'Archivada', tone: 'outline' }
  };

  function card(c) {
    const e = ESTADOS[c.estado] || ESTADOS.nueva;
    const asunto = encodeURIComponent('PARALLAX · Tu consulta');
    const cuerpo = encodeURIComponent(`Hola ${c.nombre.split(' ')[0]},\n\nGracias por contactarte con PARALLAX.\n\n`);
    return `
      <article class="pcard consulta${c.estado === 'nueva' ? ' is-new' : ''}">
        <div class="consulta-head">
          <span class="avatar">${esc(util.initials(c.nombre))}</span>
          <div class="grow">
            <h3>${esc(c.nombre)}</h3>
            <span class="small text-2">${esc(c.empresa || 'Sin empresa indicada')}</span>
          </div>
          ${ui.badge(c.interes || 'Consulta general', 'outline')}
          ${ui.badge(e.label, e.tone, true)}
        </div>
        <p class="consulta-msg">${esc(c.mensaje)}</p>
        <div class="consulta-meta">
          <span>${icon('mail', 'i-sm')} ${esc(c.email)}</span>
          ${c.telefono ? `<span>${icon('phone', 'i-sm')} ${esc(c.telefono)}</span>` : ''}
          ${c.puestos ? `<span>${icon('users', 'i-sm')} ${c.puestos} ${c.puestos === 1 ? 'puesto' : 'puestos'}</span>` : ''}
          <span>${icon('clock', 'i-sm')} ${util.fmtDateTime(c.fecha)} · ${util.relTime(c.fecha)}</span>
        </div>
        <div class="consulta-actions">
          <a class="btn btn-xs btn-outline-cyan" href="mailto:${esc(c.email)}?subject=${asunto}&body=${cuerpo}" data-action="responder" data-id="${c.id}">${icon('reply', 'i-sm')} Responder por email</a>
          ${c.estado !== 'respondida' && c.estado !== 'convertida' ? `<button class="btn btn-xs" data-action="estado" data-estado="respondida" data-id="${c.id}">${icon('check', 'i-sm')} Marcar respondida</button>` : ''}
          ${c.estado !== 'convertida' ? `<button class="btn btn-xs" data-action="convertir" data-id="${c.id}">${icon('user-plus', 'i-sm')} Crear locatario</button>` : ''}
          ${c.estado !== 'archivada' ? `<button class="btn btn-xs btn-ghost" data-action="estado" data-estado="archivada" data-id="${c.id}">${icon('archive', 'i-sm')} Archivar</button>` : `<button class="btn btn-xs btn-ghost" data-action="estado" data-estado="nueva" data-id="${c.id}">${icon('refresh', 'i-sm')} Reabrir</button>`}
          <button class="btn btn-xs btn-ghost" data-action="eliminar" data-id="${c.id}" aria-label="Eliminar consulta">${icon('trash', 'i-sm')}</button>
        </div>
      </article>`;
  }

  PLX.views.consultas = {
    title: 'Consultas del sitio',

    render(ctx) {
      const st = ctx.state;
      st.filtro = st.filtro || 'abiertas';
      const all = store.all('consultas').slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
      const by = {
        abiertas: all.filter((c) => c.estado === 'nueva'),
        respondidas: all.filter((c) => c.estado === 'respondida' || c.estado === 'convertida'),
        archivadas: all.filter((c) => c.estado === 'archivada'),
        todas: all
      };
      const list = by[st.filtro] || all;
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Consultas del sitio</h1>
            <p class="page-sub">Consultas enviadas desde el formulario de contacto del sitio público de PARALLAX.</p>
          </div>
          <div class="page-actions">
            <a class="btn btn-sm" href="index.html#contacto" target="_blank" rel="noopener">${icon('external', 'i-sm')} Abrir formulario público</a>
          </div>
        </div>
        <nav class="tabs" role="tablist">
          ${[['abiertas', 'Nuevas'], ['respondidas', 'Respondidas'], ['archivadas', 'Archivadas'], ['todas', 'Todas']]
            .map(([id, l]) => `<button type="button" class="tab${st.filtro === id ? ' is-active' : ''}" role="tab" aria-selected="${st.filtro === id}" data-action="filtro" data-f="${id}">${l} <span class="n">${by[id].length}</span></button>`).join('')}
        </nav>
        ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<section class="pcard">${ui.empty('No hay consultas en esta bandeja.', 'inbox')}</section>`}
        ${!store.persistent ? '' : `<p class="small muted" style="margin-top:16px">Las consultas enviadas desde el sitio en este navegador aparecen aquí al instante, incluso con el panel abierto en otra pestaña. Para recibirlas desde cualquier dispositivo, configurá un servicio de recepción en <span class="mono">assets/js/landing.js</span> (SITE_CONFIG.contactEndpoint).</p>`}`;
    },

    actions: {
      filtro(el, e, ctx) { ctx.state.filtro = el.dataset.f; ctx.render(); },
      responder(el) {
        // Deja abrir el cliente de correo y marca la consulta como respondida
        const c = store.get('consultas', el.dataset.id);
        if (c && c.estado === 'nueva') setTimeout(() => store.update('consultas', c.id, { estado: 'respondida' }), 300);
        root.location.href = el.getAttribute('href');
      },
      estado(el) {
        store.update('consultas', el.dataset.id, { estado: el.dataset.estado });
        ui.toast(`Consulta ${ESTADOS[el.dataset.estado].label.toLowerCase()}.`);
      },
      convertir(el) {
        const c = store.get('consultas', el.dataset.id);
        PLX.forms.locatario(null, {
          nombreComercial: c.empresa || c.nombre,
          tipo: c.puestos && c.puestos > 1 ? 'empresa' : 'profesional',
          contactoNombre: c.nombre,
          contactoEmail: c.email,
          contactoTelefono: c.telefono,
          notas: `Alta desde consulta del sitio (${util.fmtDate(util.localDateOfIso(c.fecha))}). Interés: ${c.interes || '—'}${c.puestos ? ` · ${c.puestos} puestos` : ''}.`,
          onCreated: (loc) => {
            store.update('consultas', c.id, { estado: 'convertida', locatarioId: loc.id });
            setTimeout(() => ui.toast('Ahora podés crear su contrato desde Gestoría de Contratos.'), 500);
          }
        });
      },
      async eliminar(el) {
        const c = store.get('consultas', el.dataset.id);
        const ok = await ui.confirm({ title: 'Eliminar consulta', message: `Se eliminará la consulta de <strong>${esc(c.nombre)}</strong>.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('consultas', c.id); ui.toast('Consulta eliminada.'); }
      }
    }
  };
})(window);
