/* ==========================================================================
   PARALLAX · Vista: Configuración (prestador, facturación, cuentas, datos)
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, domain, icon, backend } = PLX;
  const esc = util.esc;

  PLX.views.configuracion = {
    title: 'Configuración',

    render(ctx) {
      const st = ctx.state;
      if (!st._adminsAt || Date.now() - st._adminsAt > 30000) {
        st._adminsAt = Date.now();
        backend.users.list().then((u) => { st._admins = u.filter((x) => x.rol === 'admin'); ctx.render(); }).catch(() => {});
      }
      const admins = st._admins || [];
      const cfg = store.config();
      const p = cfg.prestador;
      const db = store.db;
      const counts = [
        ['Legajos', db.locatarios.length], ['Contratos', db.contratos.length], ['Personas autorizadas', db.personas.length],
        ['Inventario', db.insumos.length], ['Check-ins', db.accesos.length], ['Consumos', db.consumos.length],
        ['Resúmenes emitidos', db.resumenes.length], ['Documentos', db.documentos.length], ['Consultas', db.consultas.length]
      ];
      const kb = Math.round(new Blob([JSON.stringify(db)]).size / 1024);

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Configuración</h1>
            <p class="page-sub">Datos del prestador, parámetros de facturación, plan de cuentas y respaldo de la información.</p>
          </div>
        </div>

        <div class="grid grid-2">
          <section class="pcard">
            <header class="pcard-head"><h2 class="pcard-title">${icon('office', 'i-sm')} Datos del prestador</h2></header>
            <form class="pcard-body" id="form-prestador" novalidate>
              ${ui.form([
                { name: 'nombre', label: 'Nombre comercial', required: true },
                { name: 'razonSocial', label: 'Razón social' },
                { name: 'cuit', label: 'CUIT', cls: 'mono', attrs: 'data-validate="cuit" inputmode="numeric"', maxlength: 13 },
                { name: 'condicionIva', label: 'Condición frente al IVA', type: 'select', options: domain.CONDICIONES_IVA },
                { name: 'domicilio', label: 'Domicilio', span: 2 },
                { name: 'email', label: 'Email administrativo', type: 'email', span: 2 }
              ], p)}
              <div style="margin-top:16px;display:flex;justify-content:flex-end">
                <button class="btn btn-primary btn-sm" data-action="guardar-prestador">${icon('check', 'i-sm')} Guardar</button>
              </div>
            </form>
          </section>

          <section class="pcard">
            <header class="pcard-head"><h2 class="pcard-title">${icon('receipt', 'i-sm')} Facturación y cuentas contables</h2></header>
            <form class="pcard-body" id="form-facturacion" novalidate>
              ${ui.form([
                { name: 'ivaAlicuota', label: 'Alícuota de IVA (%)', type: 'select', options: ['21', '10.5', '27', '0'], value: String(cfg.ivaAlicuota) },
                { name: 'prorrateo', label: 'Prorratear abonos por días', type: 'switch', value: cfg.prorrateo, hint: 'Cuando un contrato inicia o finaliza dentro del mes.' },
                { type: 'section', label: 'Plan de cuentas' },
                { name: 'c_abonos', label: 'Abonos de Membresía', value: cfg.cuentas.abonos, cls: 'mono' },
                ...domain.CATEGORIAS.map((c) => ({ name: `c_${c.id}`, label: c.nombre, value: cfg.cuentas[c.id], cls: 'mono' }))
              ])}
              <div style="margin-top:16px;display:flex;justify-content:flex-end">
                <button class="btn btn-primary btn-sm" data-action="guardar-facturacion">${icon('check', 'i-sm')} Guardar</button>
              </div>
            </form>
          </section>
        </div>

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head">
            <div>
              <h2 class="pcard-title">${icon('shield', 'i-sm')} Usuarios de administración</h2>
              <p class="pcard-sub">${backend.mode === 'servidor' ? 'Contraseñas cifradas en el servidor.' : 'Modo demostración: el inicio de sesión es ilustrativo y solo vale en este navegador.'}</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-xs" data-action="mi-password">${icon('edit', 'i-sm')} Cambiar mi contraseña</button>
              <button class="btn btn-xs btn-outline-cyan" data-action="nuevo-admin">${icon('user-plus', 'i-sm')} Nuevo administrador</button>
            </div>
          </header>
          <div class="pcard-body flush">
            ${ui.table({
              rows: admins,
              empty: 'Cargando usuarios…',
              emptyIcon: 'user',
              cols: [
                { label: 'Usuario', primary: true, cell: (u) => `<span class="strong mono">${esc(u.usuario)}</span>${backend.user && backend.user.id === u.id ? '<span class="sub">Sesión actual</span>' : ''}` },
                { label: 'Nombre', cell: (u) => esc(u.nombre || '—') },
                { label: 'Último ingreso', cell: (u) => `<span class="small text-2">${u.ultimoIngreso ? util.fmtDateTime(u.ultimoIngreso) : '—'}</span>` },
                { label: 'Estado', cell: (u) => (u.activo ? ui.badge('Habilitado', 'cyan', true) : ui.badge('Deshabilitado', 'magenta', true)) },
                { label: '', cls: 'actions', cell: (u) => (backend.user && backend.user.id === u.id ? '' : ui.iconBtn('quitar-admin', 'trash', 'Eliminar administrador', `data-id="${u.id}"`)) }
              ]
            })}
          </div>
        </section>

        <section class="pcard" style="margin-top:16px">
          <header class="pcard-head">
            <div>
              <h2 class="pcard-title">${icon('database', 'i-sm')} Datos y respaldo</h2>
              <p class="pcard-sub">${backend.mode === 'servidor' ? `Información guardada en el servidor · ${kb} KB` : store.persistent ? `Modo demostración · información guardada en este navegador · ${kb} KB` : 'El navegador no permite guardar datos: los cambios se pierden al recargar.'}</p>
            </div>
          </header>
          <div class="pcard-body">
            <div class="chips">${counts.map(([l, n]) => `<span class="chip">${l} <strong>${n}</strong></span>`).join('')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button class="btn btn-sm" data-action="backup">${icon('download', 'i-sm')} Descargar respaldo (JSON)</button>
              <label class="btn btn-sm" style="cursor:pointer">${icon('upload', 'i-sm')} Restaurar respaldo<input type="file" accept="application/json,.json" data-change="restore" hidden></label>
              <button class="btn btn-sm btn-danger" data-action="vaciar">${icon('refresh', 'i-sm')} Comenzar sin datos de demostración</button>
              <button class="btn btn-sm btn-ghost" data-action="demo">${icon('spark', 'i-sm')} Restablecer demostración</button>
            </div>
            <div class="note" style="margin-top:16px">${icon('info', 'i-sm')}<div>«Comenzar sin datos de demostración» conserva la configuración, las modalidades de abono y el inventario, y elimina legajos, contratos, personas, check-ins, consumos, resúmenes, documentos y consultas. ${backend.mode === 'servidor' ? 'Los usuarios y contraseñas no se modifican.' : 'Para operar con varios dispositivos y contraseñas seguras, poné en marcha el servidor incluido (ver README).'}</div></div>
          </div>
        </section>`;
    },

    actions: {
      'guardar-prestador'() {
        const form = document.getElementById('form-prestador');
        if (!ui.validate(form)) return;
        const d = ui.read(form);
        d.cuit = util.fmtCuit(d.cuit);
        store.setConfig({ prestador: d });
        ui.toast('Datos del prestador guardados.');
      },
      'guardar-facturacion'() {
        const form = document.getElementById('form-facturacion');
        if (!ui.validate(form)) return;
        const d = ui.read(form);
        const cuentas = { abonos: d.c_abonos };
        domain.CATEGORIAS.forEach((c) => (cuentas[c.id] = d[`c_${c.id}`]));
        store.setConfig({ ivaAlicuota: Number(d.ivaAlicuota), prorrateo: !!d.prorrateo, cuentas });
        ui.toast('Parámetros de facturación guardados.');
      },
      'mi-password'() {
        ui.modal({
          title: 'Cambiar mi contraseña',
          size: 'narrow',
          submitLabel: 'Cambiar contraseña',
          body: ui.form([
            { name: 'actual', label: 'Contraseña actual', type: 'password', required: true, span: 2 },
            { name: 'nueva', label: 'Nueva contraseña', type: 'password', required: true, span: 2, hint: 'Mínimo 8 caracteres.' },
            { name: 'repetir', label: 'Repetir nueva contraseña', type: 'password', required: true, span: 2 }
          ]),
          onSubmit(d) {
            if (d.nueva !== d.repetir) { ui.toast('Las contraseñas nuevas no coinciden.', 'warn'); return false; }
            backend.changePassword(d.actual, d.nueva).then(() => { ui.close(); ui.toast('Contraseña actualizada.'); }).catch((e) => ui.toast(e.message, 'warn'));
            return false;
          }
        });
      },
      'nuevo-admin'(el, e, ctx) {
        ui.modal({
          title: 'Nuevo administrador',
          size: 'narrow',
          submitLabel: 'Crear usuario',
          body: ui.form([
            { name: 'usuario', label: 'Usuario', required: true, span: 2, cls: 'mono', maxlength: 60 },
            { name: 'nombre', label: 'Nombre', span: 2, maxlength: 120 },
            { name: 'password', label: 'Contraseña inicial', required: true, span: 2, cls: 'mono', value: backend.generarPassword(12), hint: 'Mínimo 8 caracteres. Copiala antes de guardar.' }
          ]),
          onSubmit(d) {
            backend.users.save({ usuario: d.usuario, nombre: d.nombre, password: d.password, rol: 'admin', activo: true })
              .then(() => { ui.close(); ui.toast(`Administrador «${d.usuario}» creado.`); ctx.state._adminsAt = 0; ctx.render(); })
              .catch((err) => ui.toast(err.message, 'warn'));
            return false;
          }
        });
      },
      async 'quitar-admin'(el, e, ctx) {
        const ok = await ui.confirm({ title: 'Eliminar administrador', message: 'Ese usuario no podrá volver a ingresar al Panel de Gestoría.', confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        try { await backend.users.remove(el.dataset.id); ui.toast('Administrador eliminado.'); ctx.state._adminsAt = 0; ctx.render(); } catch (err) { ui.toast(err.message, 'warn'); }
      },
      backup() {
        util.download(`parallax-respaldo-${util.todayStr()}.json`, store.exportJSON(), 'application/json');
        ui.toast('Respaldo descargado.');
      },
      async vaciar() {
        const ok = await ui.confirm({ title: 'Comenzar sin datos de demostración', message: 'Se eliminarán locatarios, contratos, personas autorizadas, accesos, consumos, resúmenes y consultas. Te recomendamos descargar un respaldo antes.', confirmLabel: 'Vaciar datos', danger: true });
        if (ok) { store.clearOperational(); ui.toast('Base lista para operar.'); }
      },
      async demo() {
        const ok = await ui.confirm({ title: 'Restablecer demostración', message: 'Se reemplazarán todos los datos actuales por los datos de demostración.', confirmLabel: 'Restablecer', danger: true });
        if (ok) { store.reset(PLX.seed); ui.toast('Datos de demostración restablecidos.'); }
      }
    },

    changes: {
      restore(el) {
        const file = el.files && el.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const ok = await ui.confirm({ title: 'Restaurar respaldo', message: `Se reemplazarán los datos actuales por el contenido de <strong>${esc(file.name)}</strong>.`, confirmLabel: 'Restaurar', danger: true });
          if (!ok) return;
          try {
            store.importJSON(String(reader.result));
            ui.toast('Respaldo restaurado.');
          } catch (err) {
            ui.toast(err.message || 'No se pudo leer el archivo.', 'warn');
          }
        };
        reader.readAsText(file);
        el.value = '';
      }
    }
  };
})(window);
