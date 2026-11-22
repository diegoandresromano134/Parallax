/* ==========================================================================
   PARALLAX · Vista: Legajos de clientes
   Ficha de cada cliente (persona o empresa): datos del titular, edad,
   contrato, documentos adjuntos (contrato firmado), personas autorizadas y
   acceso al Área de Miembros.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, domain, icon, backend } = PLX;
  const esc = util.esc;

  function siguienteCredencial() {
    const max = store.all('personas').map((p) => Number(String(p.credencial).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 1000);
    return `CR-${max + 1}`;
  }
  const edadTxt = (l) => {
    const e = util.edad(l.nacimiento);
    return e == null ? '—' : `${e} años`;
  };

  /* ---------- Formulario del legajo ---------- */
  PLX.forms.legajo = (id, preset = {}) => {
    const l = id ? store.get('locatarios', id) : null;
    const v = l
      ? Object.assign({}, l)
      : Object.assign({ tipo: 'profesional', condicionIva: 'Monotributo', principal: false, fechaContrato: util.todayStr(), habilitarTitular: true }, preset);

    ui.modal({
      title: l ? `Legajo ${l.numeroCliente || ''}` : 'Nuevo legajo',
      sub: 'Datos del cliente y de su titular o representante.',
      size: 'wide',
      submitLabel: l ? 'Guardar cambios' : 'Crear legajo',
      body: ui.form([
        { type: 'section', label: 'Cliente' },
        { name: 'tipo', label: 'Tipo de cliente', type: 'select', options: domain.TIPOS_LOCATARIO.map((t) => ({ value: t.id, label: t.nombre })) },
        { name: 'numeroCliente', label: 'Número de cliente', cls: 'mono', maxlength: 20, placeholder: 'Se asigna automáticamente', hint: l ? '' : 'Dejalo vacío para asignar el siguiente.' },
        { name: 'nombreComercial', label: 'Nombre comercial', maxlength: 120, hint: 'Para personas se completa con nombre y apellido.' },
        { name: 'razonSocial', label: 'Razón social', maxlength: 160 },
        { name: 'cuit', label: 'CUIT', placeholder: '20-12345678-6', maxlength: 13, cls: 'mono', attrs: 'data-validate="cuit" inputmode="numeric"' },
        { name: 'condicionIva', label: 'Condición frente al IVA', type: 'select', options: domain.CONDICIONES_IVA },
        { type: 'section', label: 'Titular o representante' },
        { name: 'nombre', label: 'Nombre', maxlength: 80 },
        { name: 'apellido', label: 'Apellido', maxlength: 80 },
        { name: 'documento', label: 'Documento (DNI)', maxlength: 12, cls: 'mono', attrs: 'inputmode="numeric"' },
        { name: 'nacimiento', label: 'Fecha de nacimiento', type: 'date', hint: '<span id="edad-calc">Edad: —</span>' },
        { name: 'telefono', label: 'Teléfono', type: 'tel', maxlength: 40 },
        { name: 'email', label: 'Email', type: 'email', maxlength: 160 },
        { name: 'domicilio', label: 'Domicilio', maxlength: 200, span: 2 },
        { type: 'section', label: 'Contrato' },
        { name: 'fechaContrato', label: 'Fecha de contrato', type: 'date', hint: 'Se usa como inicio sugerido al crear el contrato.' },
        { name: 'principal', label: 'Cuenta principal', type: 'switch', hint: 'Se destaca en listados y resúmenes.' },
        ...(l ? [] : [{ name: 'habilitarTitular', label: 'Generar credencial de ingreso para el titular', type: 'checkbox', span: 2 }]),
        { name: 'notas', label: 'Notas internas', type: 'textarea', span: 2, hint: 'No se muestran en el Área de Miembros.' }
      ], v),
      onMount(d, form) {
        const calc = () => {
          const e = util.edad(form.elements.nacimiento.value);
          d.querySelector('#edad-calc').textContent = `Edad: ${e == null ? '—' : `${e} años`}`;
        };
        const tipo = () => {
          const persona = form.elements.tipo.value === 'profesional';
          form.elements.nombre.required = persona;
          form.elements.apellido.required = persona;
          form.elements.nombreComercial.required = !persona;
          form.elements.nombreComercial.closest('.field').querySelector('label').innerHTML = `Nombre comercial${persona ? '' : '<span class="req">*</span>'}`;
          ['nombre', 'apellido'].forEach((n) => { form.elements[n].closest('.field').querySelector('label').innerHTML = `${n === 'nombre' ? 'Nombre' : 'Apellido'}${persona ? '<span class="req">*</span>' : ''}`; });
        };
        form.elements.nacimiento.addEventListener('input', calc);
        form.elements.tipo.addEventListener('change', tipo);
        calc();
        tipo();
      },
      onSubmit(data, form) {
        const dni = String(data.documento || '').replace(/\D/g, '');
        if (dni && (dni.length < 7 || dni.length > 8)) {
          ui.toast('El documento debe tener 7 u 8 dígitos.', 'warn');
          form.elements.documento.focus();
          return false;
        }
        if (data.nacimiento && util.edad(data.nacimiento) == null) {
          ui.toast('Revisá la fecha de nacimiento.', 'warn');
          return false;
        }
        const persona = data.tipo === 'profesional';
        const nombreCompleto = [data.nombre, data.apellido].filter(Boolean).join(' ');
        const rec = {
          tipo: data.tipo,
          nombreComercial: data.nombreComercial || (persona ? nombreCompleto : ''),
          razonSocial: data.razonSocial || (persona ? nombreCompleto : ''),
          cuit: util.fmtCuit(data.cuit),
          condicionIva: data.condicionIva,
          nombre: data.nombre, apellido: data.apellido,
          documento: dni ? util.fmtDni(dni) : '',
          nacimiento: data.nacimiento, telefono: data.telefono, email: data.email, domicilio: data.domicilio,
          fechaContrato: data.fechaContrato, principal: !!data.principal, notas: data.notas
        };
        if (!rec.nombreComercial) { ui.toast('Completá el nombre comercial o el nombre del titular.', 'warn'); return false; }
        const num = String(data.numeroCliente || '').trim().toUpperCase();
        if (num && store.all('locatarios').some((x) => String(x.numeroCliente).toUpperCase() === num && (!l || x.id !== l.id))) {
          ui.toast(`El número de cliente ${num} ya está asignado.`, 'warn');
          return false;
        }
        if (l) {
          rec.numeroCliente = num || l.numeroCliente;
          store.update('locatarios', l.id, rec);
          ui.toast(`Legajo ${rec.numeroCliente} actualizado.`);
          return;
        }
        rec.numeroCliente = num || store.nextNumeroCliente();
        const nuevo = store.insert('locatarios', rec, 'loc');
        if (data.habilitarTitular && nombreCompleto) {
          store.insert('personas', { locatarioId: nuevo.id, nombre: nombreCompleto, credencial: siguienteCredencial(), titular: true, habilitada: true }, 'per');
        }
        ui.toast(`Legajo ${rec.numeroCliente} creado: ${rec.nombreComercial}.`);
        if (preset.onCreated) preset.onCreated(nuevo);
        else setTimeout(() => ficha(nuevo.id), 250);
      }
    });
  };
  PLX.forms.locatario = PLX.forms.legajo; // compatibilidad

  /* ---------- Personas autorizadas ---------- */
  PLX.forms.persona = (id, preset = {}) => {
    const p = id ? store.get('personas', id) : null;
    const locOpts = h.locOptions();
    if (!locOpts.length) return ui.toast('Primero creá un legajo.', 'warn');
    ui.modal({
      title: p ? p.nombre : 'Nueva persona autorizada',
      sub: 'Persona designada por el cliente para ingresar a las instalaciones.',
      body: ui.form([
        { name: 'nombre', label: 'Nombre y apellido', required: true, maxlength: 120 },
        { name: 'locatarioId', label: 'Cliente que la autoriza', type: 'select', required: true, options: locOpts },
        { name: 'credencial', label: 'Nº de credencial', required: true, maxlength: 20, cls: 'mono' },
        { name: 'documento', label: 'Documento (opcional)', maxlength: 20 },
        { name: 'habilitada', label: 'Credencial habilitada', type: 'switch' },
        { name: 'titular', label: 'Es el titular del legajo', type: 'switch' },
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

  /* ---------- Acceso al Área de Miembros ---------- */
  function refrescarUsuarios() {
    const s = PLX.app.state.legajos;
    if (s && s.legajos) s.legajos._usuariosAt = 0;
    PLX.app.render();
  }

  async function formAcceso(locId, existente) {
    const l = store.get('locatarios', locId);
    const pass = backend.generarPassword();
    ui.modal({
      title: existente ? 'Acceso al Área de Miembros' : 'Crear acceso al Área de Miembros',
      sub: `${esc(l.numeroCliente)} · ${esc(l.nombreComercial)}`,
      size: 'narrow',
      submitLabel: existente ? 'Guardar' : 'Crear acceso',
      body: ui.form([
        { name: 'usuario', label: 'Usuario', required: true, span: 2, cls: 'mono', maxlength: 60, hint: 'Sugerido: número de cliente o email.' },
        { name: 'password', label: existente ? 'Nueva contraseña (opcional)' : 'Contraseña inicial', span: 2, cls: 'mono', maxlength: 64, required: !existente, hint: 'Mínimo 8 caracteres. Entregásela al cliente; podrá cambiarla al ingresar.' },
        { name: 'activo', label: 'Acceso habilitado', type: 'switch', span: 2 }
      ], { usuario: existente ? existente.usuario : (l.numeroCliente || l.email || ''), password: existente ? '' : pass, activo: existente ? existente.activo : true }) +
        `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-xs" data-maction="generar">${icon('refresh', 'i-sm')} Generar otra contraseña</button></div>`,
      onAction: {
        generar: (el) => {
          const f = el.closest('form');
          f.elements.password.value = backend.generarPassword();
          f.elements.password.type = 'text';
        }
      },
      onSubmit(data) {
        backend.users.save({ id: existente && existente.id, usuario: data.usuario, password: data.password || null, rol: 'miembro', locatarioId: l.id, nombre: l.nombreComercial, activo: !!data.activo })
          .then(() => {
            ui.modal({
              title: 'Acceso listo',
              size: 'narrow',
              cancelLabel: 'Cerrar',
              body: `<p class="text-2">Datos para entregar a <strong>${esc(l.nombreComercial)}</strong>:</p>
                <div class="calc-line" style="margin-top:12px;flex-direction:column;align-items:flex-start;gap:6px">
                  <span>Usuario: <strong class="mono">${esc(data.usuario)}</strong></span>
                  ${data.password ? `<span>Contraseña: <strong class="mono">${esc(data.password)}</strong></span>` : '<span class="muted small">La contraseña no cambió.</span>'}
                  <span class="small muted">Ingreso: ${esc(new URL('ingresar.html', root.location.href).href)}</span>
                </div>
                <p class="small muted" style="margin-top:12px">Por seguridad, la contraseña no vuelve a mostrarse.</p>`
            });
            refrescarUsuarios();
          })
          .catch((e) => ui.toast(e.message, 'warn'));
        return false;
      }
    });
  }

  /* ---------- Documentos ---------- */
  async function abrirDocumento(doc, descargar = false) {
    try {
      const url = await backend.files.url(doc);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      if (descargar) a.download = doc.nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      ui.toast(e.message, 'warn');
    }
  }

  /* ---------- Ficha completa ---------- */
  async function ficha(locId) {
    const l = store.get('locatarios', locId);
    if (!l) return;
    let usuarios = [];
    try { usuarios = await backend.users.list(); } catch (e) { /* sin acceso */ }
    const acceso = usuarios.find((u) => u.locatarioId === l.id && u.rol === 'miembro');
    const contratos = store.where('contratos', (c) => c.locatarioId === l.id).sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
    const docs = store.where('documentos', (d) => d.locatarioId === l.id).sort((a, b) => b.subidoEn.localeCompare(a.subidoEn));
    const personas = store.where('personas', (p) => p.locatarioId === l.id);
    const pend = h.datosPendientes(l);
    const dato = (k, v, mono) => `<div><dt>${k}</dt><dd class="${mono ? 'mono' : ''}">${v || '<span class="muted">—</span>'}</dd></div>`;

    ui.modal({
      title: `Legajo ${l.numeroCliente || ''} · ${l.nombreComercial}`,
      sub: `${l.tipo === 'empresa' ? 'Empresa' : 'Persona'}${l.principal ? ' · Cuenta principal' : ''}${pend.length ? ` · <span style="color:#f0a0fa">Pendiente: ${pend.join(', ')}</span>` : ''}`,
      size: 'wide',
      cancelLabel: 'Cerrar',
      noAutofocus: true,
      footLeft: `<button type="button" class="btn btn-sm" data-maction="editar">${icon('edit', 'i-sm')} Editar legajo</button>`,
      body: `
        <div class="ficha">
          <section class="ficha-sec">
            <h3 class="ficha-title">${icon('user', 'i-sm')} Datos del legajo</h3>
            <dl class="loc-meta ficha-grid">
              ${dato('Nombre', esc(l.nombre))}
              ${dato('Apellido', esc(l.apellido))}
              ${dato('Documento', esc(l.documento), true)}
              ${dato('CUIT', esc(l.cuit), true)}
              ${dato('Fecha de nacimiento', l.nacimiento ? util.fmtDate(l.nacimiento) : '', true)}
              ${dato('Edad', edadTxt(l))}
              ${dato('Teléfono', esc(l.telefono))}
              ${dato('Email', l.email ? `<a href="mailto:${esc(l.email)}" style="color:var(--cyan)">${esc(l.email)}</a>` : '')}
              ${dato('Fecha de contrato', l.fechaContrato ? util.fmtDate(l.fechaContrato) : '', true)}
              ${dato('Razón social', esc(l.razonSocial))}
              ${dato('Condición IVA', esc(l.condicionIva))}
              ${dato('Domicilio', esc(l.domicilio))}
            </dl>
            ${l.notas ? `<p class="small muted" style="margin-top:10px">${esc(l.notas)}</p>` : ''}
          </section>

          <section class="ficha-sec">
            <div class="ficha-head">
              <h3 class="ficha-title">${icon('file-check', 'i-sm')} Contrato firmado y documentos</h3>
            </div>
            ${docs.length ? `<ul class="doc-list">${docs.map((d) => `
              <li>
                <span class="doc-ico">${icon(d.tipo && d.tipo.startsWith('image/') ? 'eye' : 'contract', 'i-sm')}</span>
                <div class="grow"><strong>${esc(d.nombre)}</strong><span class="sub">${esc(d.categoria)} · ${util.fmtBytes(d.tamano)} · ${util.fmtDate(util.localDateOfIso(d.subidoEn))}${d.visibleMiembro === false ? ' · solo administración' : ''}</span></div>
                <button type="button" class="btn btn-xs" data-maction="ver-doc" data-id="${d.id}">${icon('eye', 'i-sm')} Ver</button>
                <button type="button" class="btn btn-xs btn-ghost" data-maction="bajar-doc" data-id="${d.id}" aria-label="Descargar">${icon('download', 'i-sm')}</button>
                <button type="button" class="btn btn-xs btn-ghost" data-maction="borrar-doc" data-id="${d.id}" aria-label="Eliminar">${icon('trash', 'i-sm')}</button>
              </li>`).join('')}</ul>` : `<p class="small muted">Todavía no hay documentos adjuntos.</p>`}
            <div class="upload">
              <select class="select" id="doc-cat" aria-label="Tipo de documento">${domain.CATEGORIAS_DOC.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
              <select class="select" id="doc-contrato" aria-label="Contrato relacionado"><option value="">Sin contrato relacionado</option>${contratos.map((c) => `<option value="${c.id}">${esc(c.numero)}</option>`).join('')}</select>
              <label class="check"><input type="checkbox" id="doc-visible" checked><span>Visible en el Área de Miembros</span></label>
              <label class="btn btn-sm btn-outline-cyan upload-btn">${icon('upload', 'i-sm')} Adjuntar archivo<input type="file" id="doc-file" accept=".pdf,image/*,.doc,.docx" hidden></label>
              <span class="small muted">PDF, imagen o Word · hasta 15 MB</span>
            </div>
          </section>

          <section class="ficha-sec">
            <div class="ficha-head">
              <h3 class="ficha-title">${icon('contract', 'i-sm')} Contratos</h3>
              <button type="button" class="btn btn-xs" data-maction="nuevo-contrato">${icon('plus', 'i-sm')} Nuevo contrato</button>
            </div>
            ${contratos.length ? `<ul class="doc-list">${contratos.map((c) => `
              <li>
                <span class="doc-ico">${icon('contract', 'i-sm')}</span>
                <div class="grow"><strong class="mono">${esc(c.numero)}</strong><span class="sub">${esc(h.planName(c.planId))} · ${util.money0(c.montoMensual)} / mes · ${util.fmtDate(c.fechaInicio)} → ${c.fechaFin ? util.fmtDate(c.fechaFin) : 'indeterminado'} · ${(c.recursos || []).length} recursos</span></div>
                ${h.contratoBadge(c)}
                <button type="button" class="btn btn-xs" data-maction="editar-contrato" data-id="${c.id}">${icon('edit', 'i-sm')}</button>
              </li>`).join('')}</ul>` : '<p class="small muted">Sin contratos.</p>'}
          </section>

          <div class="grid grid-2" style="gap:14px">
            <section class="ficha-sec">
              <div class="ficha-head">
                <h3 class="ficha-title">${icon('login', 'i-sm')} Área de Miembros</h3>
              </div>
              ${acceso
                ? `<p class="small">Usuario <strong class="mono">${esc(acceso.usuario)}</strong> · ${acceso.activo ? ui.badge('Habilitado', 'cyan', true) : ui.badge('Deshabilitado', 'magenta', true)}</p>
                   <p class="small muted" style="margin-top:6px">${acceso.ultimoIngreso ? `Último ingreso: ${util.fmtDateTime(acceso.ultimoIngreso)}` : 'Todavía no ingresó.'}</p>
                   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                     <button type="button" class="btn btn-xs" data-maction="acceso" data-uid="${acceso.id}">${icon('edit', 'i-sm')} Usuario y contraseña</button>
                     <button type="button" class="btn btn-xs btn-ghost" data-maction="quitar-acceso" data-uid="${acceso.id}">${icon('trash', 'i-sm')} Quitar acceso</button>
                   </div>`
                : `<p class="small muted">Sin usuario para ingresar al Área de Miembros.</p>
                   <button type="button" class="btn btn-xs btn-outline-cyan" style="margin-top:10px" data-maction="acceso">${icon('user-plus', 'i-sm')} Crear usuario y contraseña</button>`}
            </section>
            <section class="ficha-sec">
              <div class="ficha-head">
                <h3 class="ficha-title">${icon('badge', 'i-sm')} Personas autorizadas</h3>
                <button type="button" class="btn btn-xs" data-maction="nueva-persona">${icon('plus', 'i-sm')}</button>
              </div>
              ${personas.length ? `<ul class="mini-list">${personas.map((p) => `<li><span>${esc(p.nombre)}${p.titular ? ' <span class="muted small">(titular)</span>' : ''}</span><span class="mono small">${esc(p.credencial)}</span></li>`).join('')}</ul>` : '<p class="small muted">Sin personas autorizadas.</p>'}
            </section>
          </div>
        </div>`,
      onMount(d) {
        const input = d.querySelector('#doc-file');
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const btn = d.querySelector('.upload-btn');
          btn.classList.add('is-busy');
          try {
            await backend.files.upload(file, {
              locatarioId: l.id,
              categoria: d.querySelector('#doc-cat').value,
              contratoId: d.querySelector('#doc-contrato').value || null,
              visibleMiembro: d.querySelector('#doc-visible').checked
            });
            ui.toast(`«${file.name}» adjuntado al legajo.`);
            ficha(l.id);
          } catch (e) {
            ui.toast(e.message || 'No se pudo adjuntar el archivo.', 'warn');
          } finally {
            btn.classList.remove('is-busy');
            input.value = '';
          }
        });
      },
      onAction: {
        editar: () => PLX.forms.legajo(l.id),
        'nuevo-contrato': () => PLX.forms.contrato(null, { locatarioId: l.id, fechaInicio: l.fechaContrato || util.todayStr() }),
        'editar-contrato': (el) => PLX.forms.contrato(el.dataset.id),
        'nueva-persona': () => PLX.forms.persona(null, { locatarioId: l.id }),
        'ver-doc': (el) => abrirDocumento(store.get('documentos', el.dataset.id)),
        'bajar-doc': (el) => abrirDocumento(store.get('documentos', el.dataset.id), true),
        'borrar-doc': async (el) => {
          const doc = store.get('documentos', el.dataset.id);
          const ok = await ui.confirm({ title: 'Eliminar documento', message: `Se eliminará <strong>${esc(doc.nombre)}</strong> del legajo.`, confirmLabel: 'Eliminar', danger: true });
          if (!ok) return ficha(l.id);
          try { await backend.files.remove(doc); ui.toast('Documento eliminado.'); } catch (e) { ui.toast(e.message, 'warn'); }
          ficha(l.id);
        },
        acceso: (el) => formAcceso(l.id, el.dataset.uid ? usuarios.find((u) => u.id === el.dataset.uid) : null),
        'quitar-acceso': async (el) => {
          const ok = await ui.confirm({ title: 'Quitar acceso', message: `${esc(l.nombreComercial)} no podrá ingresar al Área de Miembros.`, confirmLabel: 'Quitar acceso', danger: true });
          if (ok) {
            try { await backend.users.remove(el.dataset.uid); ui.toast('Acceso eliminado.'); refrescarUsuarios(); } catch (e) { ui.toast(e.message, 'warn'); }
          }
          ficha(l.id);
        }
      }
    });
  }

  /* ---------- Render ---------- */
  function tabLegajos(st) {
    const q = util.normalize(st.q);
    const asig = h.asignaciones();
    const rows = store.all('locatarios')
      .filter((l) => !q || util.normalize(`${l.numeroCliente} ${l.nombreComercial} ${l.razonSocial} ${l.nombre} ${l.apellido} ${l.documento} ${l.cuit} ${l.email}`).includes(q))
      .filter((l) => !st.tipo || l.tipo === st.tipo)
      .sort((a, b) => String(a.numeroCliente || '').localeCompare(String(b.numeroCliente || '')));
    const usuarios = st._usuarios || [];
    const conAcceso = new Set(usuarios.filter((u) => u.rol === 'miembro' && u.activo).map((u) => u.locatarioId));

    return `
      <div class="toolbar">
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-legajos" type="search" placeholder="Buscar por N° de cliente, nombre, DNI, CUIT o email" value="${esc(st.q || '')}" data-input="q"></div>
        <select class="select" data-change="tipo" aria-label="Filtrar por tipo">
          <option value="">Personas y empresas</option>
          ${domain.TIPOS_LOCATARIO.map((t) => `<option value="${t.id}"${st.tipo === t.id ? ' selected' : ''}>${t.nombre}</option>`).join('')}
        </select>
        <span class="grow"></span>
        <button class="btn btn-sm" data-action="export">${icon('download', 'i-sm')} CSV</button>
      </div>
      <section class="pcard">
        ${ui.table({
          rows,
          empty: 'No hay legajos que coincidan.',
          emptyIcon: 'user',
          rowAttr: (l) => `data-row="${l.id}"`,
          cols: [
            { label: 'N° cliente', cell: (l) => `<span class="strong mono">${esc(l.numeroCliente || '—')}</span>` },
            { label: 'Cliente', primary: true, cell: (l) => `<button type="button" class="link-btn" data-action="ficha" data-id="${l.id}"><span class="strong">${esc(l.nombreComercial)}</span></button><span class="sub">${l.tipo === 'empresa' ? 'Empresa' : 'Persona'}${l.razonSocial && l.razonSocial !== l.nombreComercial ? ` · ${esc(l.razonSocial)}` : ''}${l.principal ? ' · cuenta principal' : ''}</span>` },
            { label: 'Titular', cell: (l) => (h.titular(l) ? `${esc(h.titular(l))}<span class="sub mono">${esc(l.documento || 'DNI pendiente')}</span>` : '<span class="muted small">Pendiente</span>') },
            { label: 'Edad', cls: 'num', cell: (l) => edadTxt(l) },
            { label: 'Contacto', cell: (l) => `${esc(l.telefono || '—')}<span class="sub">${esc(l.email || '')}</span>` },
            { label: 'Contrato', cell: (l) => {
              const c = h.contratoActivo(l.id);
              return `<span class="mono small">${l.fechaContrato ? util.fmtDate(l.fechaContrato) : '—'}</span><span class="sub nowrap">${c ? esc(c.numero) : 'Sin contrato vigente'}</span>`;
            } },
            { label: 'Docs', cls: 'num', cell: (l) => { const n = store.where('documentos', (d) => d.locatarioId === l.id).length; return n ? `${icon('file-check', 'i-sm')} ${n}` : '<span class="muted">0</span>'; } },
            { label: 'Área de Miembros', cell: (l) => (conAcceso.has(l.id) ? ui.badge('Con acceso', 'cyan', true) : ui.badge('Sin acceso', 'outline')) },
            { label: '', cls: 'actions', cell: (l) => ui.iconBtn('ficha', 'eye', 'Ver legajo completo', `data-id="${l.id}"`) + ui.iconBtn('editar', 'edit', 'Editar legajo', `data-id="${l.id}"`) + ui.iconBtn('eliminar', 'trash', 'Eliminar legajo', `data-id="${l.id}"`) }
          ]
        })}
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
      .sort((a, b) => String((h.loc(a.locatarioId) || {}).numeroCliente).localeCompare(String((h.loc(b.locatarioId) || {}).numeroCliente)) || a.nombre.localeCompare(b.nombre));
    return `
      <div class="toolbar">
        <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-personas" type="search" placeholder="Buscar por nombre o credencial" value="${esc(st.q || '')}" data-input="q"></div>
        <select class="select" data-change="loc" aria-label="Filtrar por cliente">
          <option value="">Todos los clientes</option>
          ${h.locOptions().map((o) => `<option value="${o.value}"${o.value === st.loc ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </div>
      <section class="pcard">
        ${ui.table({
          rows,
          empty: 'No hay personas autorizadas que coincidan.',
          emptyIcon: 'users',
          cols: [
            { label: 'Persona', primary: true, cell: (p) => `<div class="cell-flex"><span class="avatar">${esc(util.initials(p.nombre))}</span><div><span class="strong">${esc(p.nombre)}</span>${p.titular ? '<span class="sub">Titular</span>' : ''}</div></div>` },
            { label: 'Credencial', cell: (p) => `<span class="mono">${esc(p.credencial)}</span>` },
            { label: 'Cliente', cell: (p) => { const l = h.loc(p.locatarioId); return l ? `<span class="mono small">${esc(l.numeroCliente)}</span> ${esc(l.nombreComercial)}` : '—'; } },
            { label: 'Estado', cell: (p) => (p.habilitada ? ui.badge('Habilitada', 'cyan', true) : ui.badge('Inhabilitada', 'magenta', true)) },
            { label: 'Último ingreso', cell: (p) => `<span class="small text-2">${ultimos[p.id] ? util.fmtDateTime(ultimos[p.id]) : '—'}</span>` },
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

  PLX.views.legajos = {
    title: 'Legajos',

    render(ctx) {
      const tab = ctx.sub === 'personas' ? 'personas' : 'legajos';
      const st = (ctx.state[tab] = ctx.state[tab] || {});
      if (tab === 'legajos' && (!st._usuariosAt || Date.now() - st._usuariosAt > 30000)) {
        // Lista de accesos al Área de Miembros (asincrónica, se refresca cada 30 s)
        st._usuariosAt = Date.now();
        backend.users.list().then((u) => { st._usuarios = u; ctx.render(); }).catch(() => {});
      }
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Legajos</h1>
            <p class="page-sub">Ficha de cada cliente: titular, documentación, contrato firmado y acceso al Área de Miembros.</p>
          </div>
          <div class="page-actions">
            ${tab === 'legajos'
              ? `<button class="btn btn-primary btn-sm" data-action="nuevo">${icon('plus', 'i-sm')} Nuevo legajo</button>`
              : `<button class="btn btn-primary btn-sm" data-action="nueva-persona">${icon('user-plus', 'i-sm')} Nueva persona autorizada</button>`}
          </div>
        </div>
        ${ui.tabs([
          { id: 'legajos', label: 'Legajos', href: '#legajos', n: store.all('locatarios').length },
          { id: 'personas', label: 'Personas autorizadas', href: '#legajos-personas', n: store.all('personas').length }
        ], tab)}
        ${tab === 'legajos' ? tabLegajos(st) : tabPersonas(st)}
        <div class="note" style="margin-top:16px">${icon('shield', 'i-sm')}<div>Los datos personales de los legajos se usan solo para administrar el vínculo comercial con cada cliente. Cada cliente organiza su actividad con plena autonomía y designa por sí mismo a las personas autorizadas a ingresar.</div></div>`;
    },

    inputs: {
      q(el, e, ctx) {
        const tab = ctx.sub === 'personas' ? 'personas' : 'legajos';
        ctx.state[tab].q = el.value;
        ctx.render();
      }
    },
    changes: {
      tipo(el, e, ctx) { ctx.state.legajos.tipo = el.value; ctx.render(); },
      loc(el, e, ctx) { ctx.state.personas.loc = el.value; ctx.render(); }
    },
    actions: {
      nuevo: () => PLX.forms.legajo(),
      ficha: (el) => ficha(el.dataset.id),
      editar: (el) => PLX.forms.legajo(el.dataset.id),
      async eliminar(el) {
        const l = store.get('locatarios', el.dataset.id);
        const usos = ['contratos', 'consumos', 'accesos', 'resumenes', 'documentos'].reduce((n, col) => n + store.where(col, (x) => x.locatarioId === l.id).length, 0);
        if (usos) { ui.toast(`${l.nombreComercial} tiene contratos, registros o documentos asociados; no puede eliminarse.`, 'warn'); return; }
        const ok = await ui.confirm({ title: 'Eliminar legajo', message: `Se eliminará el legajo <strong>${esc(l.numeroCliente)} · ${esc(l.nombreComercial)}</strong> y sus personas autorizadas.`, confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        store.where('personas', (p) => p.locatarioId === l.id).forEach((p) => store.remove('personas', p.id));
        store.remove('locatarios', l.id);
        ui.toast('Legajo eliminado.');
      },
      'nueva-persona': (el, e, ctx) => PLX.forms.persona(null, ctx.state.personas && ctx.state.personas.loc ? { locatarioId: ctx.state.personas.loc } : {}),
      'editar-persona': (el) => PLX.forms.persona(el.dataset.id),
      'toggle-persona'(el) {
        const p = store.get('personas', el.dataset.id);
        store.update('personas', p.id, { habilitada: !p.habilitada });
        ui.toast(`Credencial ${p.credencial} ${p.habilitada ? 'habilitada' : 'inhabilitada'}.`);
      },
      async 'eliminar-persona'(el) {
        const p = store.get('personas', el.dataset.id);
        const ok = await ui.confirm({ title: 'Eliminar persona autorizada', message: `Se eliminará a <strong>${esc(p.nombre)}</strong> (${esc(p.credencial)}). Su historial de check-in se conserva.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('personas', p.id); ui.toast('Persona eliminada.'); }
      },
      export() {
        const rows = [['N° cliente', 'Tipo', 'Nombre comercial', 'Razón social', 'CUIT', 'Condición IVA', 'Nombre', 'Apellido', 'Documento', 'Fecha de nacimiento', 'Edad', 'Teléfono', 'Email', 'Domicilio', 'Fecha de contrato']];
        store.all('locatarios').forEach((l) => rows.push([l.numeroCliente, l.tipo === 'empresa' ? 'Empresa' : 'Persona', l.nombreComercial, l.razonSocial, l.cuit, l.condicionIva, l.nombre, l.apellido, l.documento, l.nacimiento ? util.fmtDate(l.nacimiento) : '', util.edad(l.nacimiento) ?? '', l.telefono, l.email, l.domicilio, l.fechaContrato ? util.fmtDate(l.fechaContrato) : '']));
        util.download(`parallax-legajos-${util.todayStr()}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Legajos exportados.');
      }
    }
  };

  PLX.legajos = { ficha };
})(window);
