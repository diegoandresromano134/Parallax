/* ==========================================================================
   PARALLAX · Vista: Control de Accesos
   Registro de ingresos y egresos a las instalaciones de las personas
   autorizadas por cada locatario (seguridad edilicia e imputación de uso).
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, icon } = PLX;
  const esc = util.esc;
  const PUNTOS = ['Recepción', 'Cochera', 'Acceso de servicio'];
  const PAGE = 40;

  const NOTA = `<div class="note">${icon('shield', 'i-sm')}<div>El registro de accesos tiene por finalidad la <strong>seguridad de las instalaciones</strong> y la imputación del uso de la infraestructura a cada locatario. Cada locatario organiza su actividad con plena autonomía y designa por sí mismo a las personas autorizadas a ingresar.</div></div>`;

  function siguienteCredencial() {
    const max = store.all('personas')
      .map((p) => Number(String(p.credencial).replace(/\D/g, '')) || 0)
      .reduce((a, b) => Math.max(a, b), 1000);
    return `CR-${max + 1}`;
  }

  /* ---------- Formularios ---------- */
  PLX.forms.ingreso = (preset = {}) => {
    const locOpts = h.locOptions();
    if (!locOpts.length) return ui.toast('Primero registrá un locatario.', 'warn');
    const locId = preset.locatarioId || locOpts[0].value;
    const personaOpts = (id) => h.personaOptions(id).concat([{ value: '__visita', label: 'Visita sin credencial' }]);

    ui.modal({
      title: 'Registrar ingreso',
      sub: 'Ingreso a las instalaciones de una persona autorizada o visita.',
      submitLabel: 'Registrar ingreso',
      body: ui.form([
        { name: 'locatarioId', label: 'Locatario', type: 'select', required: true, options: locOpts, span: 2 },
        { name: 'personaId', label: 'Persona', type: 'select', required: true, options: personaOpts(locId) },
        { name: 'nombreVisita', label: 'Nombre de la visita', maxlength: 120, hint: 'Solo para visitas sin credencial.' },
        { name: 'ingreso', label: 'Fecha y hora de ingreso', type: 'datetime-local', required: true },
        { name: 'punto', label: 'Punto de acceso', type: 'select', options: PUNTOS },
        { name: 'nota', label: 'Observaciones', span: 2, maxlength: 200 }
      ], { locatarioId: locId, ingreso: util.toLocalInput(new Date()), punto: 'Recepción' }),
      onMount(d, form) {
        const sel = form.elements.personaId;
        const visita = form.elements.nombreVisita;
        const sync = () => {
          const esVisita = sel.value === '__visita';
          visita.closest('.field').style.opacity = esVisita ? '1' : '0.45';
          visita.required = esVisita;
        };
        form.elements.locatarioId.addEventListener('change', (e) => {
          sel.innerHTML = personaOpts(e.target.value).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
          sync();
        });
        sel.addEventListener('change', sync);
        sync();
      },
      onSubmit(data) {
        const cuando = new Date(data.ingreso);
        if (cuando > new Date(Date.now() + 5 * 60000)) {
          ui.toast('El ingreso no puede registrarse en el futuro.', 'warn');
          return false;
        }
        if (data.personaId === '__visita') {
          store.insert('accesos', {
            personaId: null, locatarioId: data.locatarioId, nombre: `${data.nombreVisita} (visita)`, credencial: '',
            ingreso: cuando.toISOString(), egreso: null, punto: data.punto, nota: data.nota
          }, 'acc');
          ui.toast(`Ingreso registrado: ${data.nombreVisita}.`);
          return;
        }
        const p = store.get('personas', data.personaId);
        const r = h.registrarIngreso(p, cuando, { punto: data.punto, nota: data.nota });
        if (!r.ok) { ui.toast(r.motivo, 'warn'); return false; }
        ui.toast(`Ingreso registrado: ${p.nombre} (${util.fmtTime(r.acceso.ingreso)}).`);
      }
    });
  };

  PLX.forms.acceso = (id) => {
    const a = store.get('accesos', id);
    ui.modal({
      title: 'Editar registro de acceso',
      sub: `${esc(a.nombre)} · ${esc(h.locName(a.locatarioId))}`,
      body: ui.form([
        { name: 'ingreso', label: 'Ingreso', type: 'datetime-local', required: true },
        { name: 'egreso', label: 'Egreso', type: 'datetime-local', hint: 'Vacío si la persona continúa en el espacio.' },
        { name: 'punto', label: 'Punto de acceso', type: 'select', options: PUNTOS },
        { name: 'nota', label: 'Observaciones', maxlength: 200 }
      ], { ingreso: util.toLocalInput(a.ingreso), egreso: a.egreso ? util.toLocalInput(a.egreso) : '', punto: a.punto, nota: a.nota }),
      onSubmit(data) {
        const ing = new Date(data.ingreso);
        const egr = data.egreso ? new Date(data.egreso) : null;
        if (egr && egr < ing) { ui.toast('El egreso no puede ser anterior al ingreso.', 'warn'); return false; }
        store.update('accesos', a.id, { ingreso: ing.toISOString(), egreso: egr ? egr.toISOString() : null, punto: data.punto, nota: data.nota });
        ui.toast('Registro actualizado.');
      }
    });
  };

  PLX.forms.persona = (id, preset = {}) => {
    const p = id ? store.get('personas', id) : null;
    const locOpts = h.locOptions();
    if (!locOpts.length) return ui.toast('Primero registrá un locatario.', 'warn');
    ui.modal({
      title: p ? p.nombre : 'Nueva persona autorizada',
      sub: 'Persona designada por el locatario para ingresar a las instalaciones.',
      body: ui.form([
        { name: 'nombre', label: 'Nombre y apellido', required: true, maxlength: 120 },
        { name: 'locatarioId', label: 'Locatario que la autoriza', type: 'select', required: true, options: locOpts },
        { name: 'credencial', label: 'Nº de credencial', required: true, maxlength: 20, cls: 'mono' },
        { name: 'documento', label: 'Documento (opcional)', maxlength: 20 },
        { name: 'habilitada', label: 'Credencial habilitada', type: 'switch' },
        { name: 'notas', label: 'Notas', span: 2, maxlength: 200 }
      ], p || Object.assign({ credencial: siguienteCredencial(), habilitada: true }, preset)),
      onSubmit(data) {
        data.credencial = data.credencial.toUpperCase();
        const dup = store.all('personas').find((x) => x.credencial.toUpperCase() === data.credencial && (!p || x.id !== p.id));
        if (dup) { ui.toast(`La credencial ${data.credencial} ya está asignada a ${dup.nombre}.`, 'warn'); return false; }
        if (p) store.update('personas', p.id, data);
        else store.insert('personas', data, 'per');
        ui.toast(p ? 'Persona actualizada.' : `Credencial ${data.credencial} asignada a ${data.nombre}.`);
      }
    });
  };

  /* ---------- Render ---------- */
  function filtrarAccesos(st) {
    const q = util.normalize(st.q);
    return store.all('accesos')
      .filter((a) => {
        const d = util.localDateOfIso(a.ingreso);
        if (st.desde && d < st.desde) return false;
        if (st.hasta && d > st.hasta) return false;
        if (st.loc && a.locatarioId !== st.loc) return false;
        if (q && !util.normalize(`${a.nombre} ${a.credencial}`).includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.ingreso.localeCompare(a.ingreso));
  }

  function tabRegistro(st) {
    const hoy = util.todayStr();
    st.desde = st.desde == null ? util.addDays(hoy, -6) : st.desde;
    st.hasta = st.hasta == null ? hoy : st.hasta;
    st.limit = st.limit || PAGE;
    const presentes = h.presentes();
    const rows = filtrarAccesos(st);
    const ms = util.sum(rows, (a) => (a.egreso ? new Date(a.egreso) : Date.now()) - new Date(a.ingreso));
    const personas = new Set(rows.map((a) => a.personaId || a.nombre)).size;

    return `
      <div class="scanner">
        <span class="scan-icon">${icon('scan', 'i-lg')}</span>
        <div>
          <div class="lbl">Lector de credenciales · alterna automáticamente ingreso y egreso</div>
          <input class="input" id="scan-cred" placeholder="Escaneá o escribí la credencial (p. ej. CR-1001)" autocomplete="off" data-enter="scan" aria-label="Número de credencial">
        </div>
        <button class="btn btn-outline-cyan" data-action="scan">${icon('check', 'i-sm')} Registrar</button>
      </div>

      <section class="pcard" style="margin-bottom:16px">
        <header class="pcard-head">
          <div>
            <h2 class="pcard-title">${icon('users', 'i-sm')} En el espacio ahora</h2>
            <p class="pcard-sub">${presentes.length} ${presentes.length === 1 ? 'ingreso abierto' : 'ingresos abiertos'}</p>
          </div>
          ${presentes.length > 1 ? `<button class="btn btn-xs" data-action="egreso-todos">${icon('logout', 'i-sm')} Cerrar todos al finalizar el día</button>` : ''}
        </header>
        <div class="pcard-body">
          ${presentes.length ? `<div class="present-grid">${presentes.map((a) => `
            <div class="present">
              <span class="avatar">${esc(util.initials(a.nombre))}</span>
              <div class="grow">
                <div class="title">${esc(a.nombre)}</div>
                <div class="meta">${esc(h.locName(a.locatarioId))} · ${util.fmtTime(a.ingreso)} · ${util.fmtDuration(Date.now() - new Date(a.ingreso))}</div>
              </div>
              ${ui.iconBtn('egreso', 'logout', `Registrar egreso de ${a.nombre}`, `data-id="${a.id}"`)}
            </div>`).join('')}</div>` : ui.empty('No hay ingresos abiertos.', 'users')}
        </div>
      </section>

      <section class="pcard">
        <header class="pcard-head">
          <div>
            <h2 class="pcard-title">${icon('clock', 'i-sm')} Historial de accesos</h2>
            <p class="pcard-sub">${rows.length} registros · ${util.num(util.round2(ms / 3600000))} h de permanencia · ${personas} personas</p>
          </div>
          <button class="btn btn-xs" data-action="export-accesos">${icon('download', 'i-sm')} CSV</button>
        </header>
        <div class="pcard-body" style="padding-bottom:0">
          <div class="toolbar">
            <label class="small muted" for="acc-desde">Desde</label>
            <input class="input" id="acc-desde" type="date" value="${esc(st.desde)}" data-change="desde">
            <label class="small muted" for="acc-hasta">Hasta</label>
            <input class="input" id="acc-hasta" type="date" value="${esc(st.hasta)}" data-change="hasta">
            <select class="select" data-change="loc" aria-label="Filtrar por locatario">
              <option value="">Todos los locatarios</option>
              ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.loc ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select>
            <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-accesos" type="search" placeholder="Persona o credencial" value="${esc(st.q || '')}" data-input="q"></div>
          </div>
        </div>
        ${ui.table({
          rows: rows.slice(0, st.limit),
          empty: 'Sin accesos en el rango seleccionado.',
          emptyIcon: 'badge',
          cols: [
            { label: 'Persona', primary: true, cell: (a) => `<div class="cell-flex"><span class="avatar">${esc(util.initials(a.nombre))}</span><div><span class="strong">${esc(a.nombre)}</span><span class="sub mono">${esc(a.credencial || 'Visita')}</span></div></div>` },
            { label: 'Locatario', cell: (a) => esc(h.locName(a.locatarioId)) },
            { label: 'Fecha', cell: (a) => `<span class="mono small">${util.fmtDate(util.localDateOfIso(a.ingreso))}</span>` },
            { label: 'Ingreso', cls: 'num', cell: (a) => util.fmtTime(a.ingreso) },
            { label: 'Egreso', cls: 'num', cell: (a) => (a.egreso ? util.fmtTime(a.egreso) : ui.badge('En el espacio', 'cyan', true)) },
            { label: 'Permanencia', cls: 'num', cell: (a) => util.fmtDuration((a.egreso ? new Date(a.egreso) : Date.now()) - new Date(a.ingreso)) },
            { label: 'Punto', cell: (a) => `<span class="small text-2">${esc(a.punto || '')}</span>` },
            {
              label: '', cls: 'actions', cell: (a) =>
                (a.egreso ? '' : ui.iconBtn('egreso', 'logout', 'Registrar egreso', `data-id="${a.id}"`)) +
                ui.iconBtn('editar-acceso', 'edit', 'Editar registro', `data-id="${a.id}"`) +
                ui.iconBtn('eliminar-acceso', 'trash', 'Eliminar registro', `data-id="${a.id}"`)
            }
          ]
        })}
        ${rows.length > st.limit ? `<div class="more-row"><button class="btn btn-sm" data-action="mas">Mostrar más (${rows.length - st.limit} restantes)</button></div>` : ''}
      </section>`;
  }

  function tabPersonas(st) {
    const q = util.normalize(st.q);
    const ultimos = {};
    store.all('accesos').forEach((a) => {
      if (a.personaId && (!ultimos[a.personaId] || a.ingreso > ultimos[a.personaId])) ultimos[a.personaId] = a.ingreso;
    });
    const rows = store.all('personas')
      .filter((p) => (!st.loc || p.locatarioId === st.loc) && (!q || util.normalize(`${p.nombre} ${p.credencial}`).includes(q)))
      .sort((a, b) => h.locName(a.locatarioId).localeCompare(h.locName(b.locatarioId)) || a.nombre.localeCompare(b.nombre));

    return `
      <div class="toolbar">
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-personas" type="search" placeholder="Buscar por nombre o credencial" value="${esc(st.q || '')}" data-input="q"></div>
        <select class="select" data-change="loc" aria-label="Filtrar por locatario">
          <option value="">Todos los locatarios</option>
          ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.loc ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </div>
      <section class="pcard">
        ${ui.table({
          rows,
          empty: 'No hay personas autorizadas que coincidan.',
          emptyIcon: 'users',
          cols: [
            { label: 'Persona', primary: true, cell: (p) => `<div class="cell-flex"><span class="avatar">${esc(util.initials(p.nombre))}</span><span class="strong">${esc(p.nombre)}</span></div>` },
            { label: 'Credencial', cell: (p) => `<span class="mono">${esc(p.credencial)}</span>` },
            { label: 'Locatario', cell: (p) => esc(h.locName(p.locatarioId)) },
            { label: 'Estado', cell: (p) => (p.habilitada ? ui.badge('Habilitada', 'cyan', true) : ui.badge('Inhabilitada', 'magenta', true)) },
            { label: 'Último ingreso', cell: (p) => `<span class="small text-2">${ultimos[p.id] ? `${util.fmtDateTime(ultimos[p.id])}` : '—'}</span>` },
            {
              label: '', cls: 'actions', cell: (p) =>
                ui.iconBtn('editar-persona', 'edit', 'Editar persona', `data-id="${p.id}"`) +
                ui.iconBtn('toggle-persona', p.habilitada ? 'minus' : 'check', p.habilitada ? 'Inhabilitar credencial' : 'Habilitar credencial', `data-id="${p.id}"`) +
                ui.iconBtn('eliminar-persona', 'trash', 'Eliminar persona', `data-id="${p.id}"`)
            }
          ]
        })}
      </section>`;
  }

  PLX.views.accesos = {
    title: 'Control de Accesos',

    render(ctx) {
      const tab = ctx.sub === 'personas' ? 'personas' : 'registro';
      const st = (ctx.state[tab] = ctx.state[tab] || {});
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Control de Accesos</h1>
            <p class="page-sub">Registro de ingresos y egresos a las instalaciones de las personas autorizadas por cada locatario.</p>
          </div>
          <div class="page-actions">
            ${tab === 'registro'
              ? `<button class="btn btn-primary btn-sm" data-action="nuevo-ingreso">${icon('login', 'i-sm')} Registrar ingreso</button>`
              : `<button class="btn btn-primary btn-sm" data-action="nueva-persona">${icon('user-plus', 'i-sm')} Nueva persona autorizada</button>`}
          </div>
        </div>
        ${ui.tabs([
          { id: 'registro', label: 'Registro de accesos', href: '#/accesos' },
          { id: 'personas', label: 'Personas autorizadas', href: '#/accesos/personas', n: store.all('personas').length }
        ], tab)}
        ${tab === 'registro' ? tabRegistro(st) : tabPersonas(st)}
        <div style="margin-top:16px">${NOTA}</div>`;
    },

    inputs: {
      q(el, e, ctx) {
        const tab = ctx.sub === 'personas' ? 'personas' : 'registro';
        ctx.state[tab].q = el.value;
        ctx.state[tab].limit = PAGE;
        ctx.render();
      }
    },

    changes: {
      desde(el, e, ctx) { ctx.state.registro.desde = el.value; ctx.render(); },
      hasta(el, e, ctx) { ctx.state.registro.hasta = el.value; ctx.render(); },
      loc(el, e, ctx) {
        const tab = ctx.sub === 'personas' ? 'personas' : 'registro';
        ctx.state[tab].loc = el.value;
        ctx.render();
      }
    },

    actions: {
      'nuevo-ingreso': () => PLX.forms.ingreso(),
      'nueva-persona': (el, e, ctx) => PLX.forms.persona(null, ctx.state.personas && ctx.state.personas.loc ? { locatarioId: ctx.state.personas.loc } : {}),
      scan() {
        const input = document.getElementById('scan-cred');
        const r = h.alternarCredencial(input.value);
        if (!r.ok) {
          ui.toast(r.motivo, 'warn');
          input.select();
          return;
        }
        ui.toast(`${r.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado · ${r.persona.nombre} (${h.locName(r.persona.locatarioId)})`);
        input.value = '';
        setTimeout(() => { const i = document.getElementById('scan-cred'); if (i) i.focus(); }, 50);
      },
      egreso(el) {
        const r = h.registrarEgreso(el.dataset.id);
        ui.toast(r.ok ? `Egreso registrado: ${r.acceso.nombre}.` : r.motivo, r.ok ? 'ok' : 'warn');
      },
      async 'egreso-todos'() {
        const abiertos = h.presentes();
        const ok = await ui.confirm({ title: 'Cerrar ingresos abiertos', message: `Se registrará el egreso, con la hora actual, de <strong>${abiertos.length}</strong> personas.`, confirmLabel: 'Registrar egresos' });
        if (!ok) return;
        const now = new Date().toISOString();
        store.batch((db) => db.accesos.forEach((a) => { if (!a.egreso) a.egreso = now; }));
        ui.toast(`${abiertos.length} egresos registrados.`);
      },
      'editar-acceso': (el) => PLX.forms.acceso(el.dataset.id),
      async 'eliminar-acceso'(el) {
        const a = store.get('accesos', el.dataset.id);
        const ok = await ui.confirm({ title: 'Eliminar registro', message: `Se eliminará el acceso de <strong>${esc(a.nombre)}</strong> del ${util.fmtDateTime(a.ingreso)}.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('accesos', a.id); ui.toast('Registro eliminado.'); }
      },
      mas(el, e, ctx) { ctx.state.registro.limit += PAGE; ctx.render(); },
      'editar-persona': (el) => PLX.forms.persona(el.dataset.id),
      'toggle-persona'(el) {
        const p = store.get('personas', el.dataset.id);
        store.update('personas', p.id, { habilitada: !p.habilitada });
        ui.toast(`Credencial ${p.credencial} ${p.habilitada ? 'habilitada' : 'inhabilitada'}.`);
      },
      async 'eliminar-persona'(el) {
        const p = store.get('personas', el.dataset.id);
        const n = store.where('accesos', (a) => a.personaId === p.id).length;
        const ok = await ui.confirm({
          title: 'Eliminar persona autorizada',
          message: `Se eliminará a <strong>${esc(p.nombre)}</strong> (${esc(p.credencial)}).${n ? ` Sus ${n} registros de acceso se conservan en el historial.` : ''}`,
          confirmLabel: 'Eliminar', danger: true
        });
        if (ok) { store.remove('personas', p.id); ui.toast('Persona eliminada.'); }
      },
      'export-accesos'(el, e, ctx) {
        const rows = [['Fecha', 'Persona', 'Credencial', 'Locatario', 'Ingreso', 'Egreso', 'Permanencia (h)', 'Punto', 'Observaciones']];
        filtrarAccesos(ctx.state.registro).forEach((a) => {
          const ms = (a.egreso ? new Date(a.egreso) : Date.now()) - new Date(a.ingreso);
          rows.push([util.fmtDate(util.localDateOfIso(a.ingreso)), a.nombre, a.credencial, h.locName(a.locatarioId), util.fmtTime(a.ingreso), a.egreso ? util.fmtTime(a.egreso) : '', util.csvNum(ms / 3600000), a.punto, a.nota]);
        });
        util.download(`parallax-accesos-${util.todayStr()}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Historial de accesos exportado.');
      }
    }
  };
})(window);
