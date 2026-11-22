/* ==========================================================================
   PARALLAX · Vista: Inventario
   Todo lo que PARALLAX alquila, presta o cobra: espacios, equipos numerados,
   mobiliario, papelería, insumos y horas. Se carga a mano y se usa en los
   contratos (recursos incluidos), en el check-in (préstamos y pedidos) y en
   la facturación (excedentes a fin de mes).
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = root.PLX;
  const { util, store, ui, h, domain, icon } = PLX;
  const esc = util.esc;

  const AYUDA_TIPOS = domain.TIPOS_RECURSO.map((t) => `<strong>${esc(t.nombre)}:</strong> ${esc(t.ayuda)}`).join('<br>');

  /* ---------- Formularios ---------- */
  PLX.forms.recurso = (id, preset = {}) => {
    const r = id ? store.get('insumos', id) : null;
    ui.modal({
      title: r ? h.insLabel(r) : 'Nuevo recurso',
      sub: 'Espacio, equipo, mueble, insumo u hora que se puede asignar, prestar o cobrar.',
      submitLabel: r ? 'Guardar cambios' : 'Agregar al inventario',
      body: ui.form([
        { name: 'nombre', label: 'Nombre', required: true, span: 2, maxlength: 120, placeholder: 'Ej.: Computadora portátil, Resma A4, Sala de reuniones' },
        { name: 'categoria', label: 'Categoría', type: 'select', options: domain.CATEGORIAS.map((c) => ({ value: c.id, label: c.nombre })) },
        { name: 'tipo', label: 'Tipo', type: 'select', options: domain.TIPOS_RECURSO.map((t) => ({ value: t.id, label: t.nombre })) },
        { type: 'html', span: 2, html: `<p class="small muted" style="line-height:1.6">${AYUDA_TIPOS}</p>` },
        { name: 'codigo', label: 'Código o número', cls: 'mono', maxlength: 20, placeholder: 'Ej.: PC-03, ESC-12, OF-02', hint: 'Obligatorio para unidades numeradas.' },
        { name: 'unidad', label: 'Se cobra por', type: 'select', options: domain.UNIDADES },
        { name: 'precio', label: 'Precio (ARS, neto)', type: 'number', min: 0, step: 0.01, required: true },
        { name: 'stock', label: 'Stock disponible', type: 'number', min: 0, step: 1, hint: 'Solo para consumibles. Se descuenta en cada check-in.' },
        { name: 'ubicacion', label: 'Ubicación', maxlength: 120, span: 2, placeholder: 'Ej.: Piso 1 · armario de equipos' },
        { name: 'descripcion', label: 'Descripción', type: 'textarea', span: 2 },
        { name: 'mantenimiento', label: 'En mantenimiento (no disponible para asignar)', type: 'switch', span: 2 },
        { name: 'activo', label: 'Disponible para contratos, check-in y consumos', type: 'switch', span: 2 }
      ], Object.assign({}, r || Object.assign({ categoria: 'utileria', tipo: 'unidad', unidad: 'día', activo: true }, preset), { mantenimiento: r ? r.estado === 'mantenimiento' : false })),
      onMount(d, form) {
        const sync = () => {
          const t = form.elements.tipo.value;
          form.elements.codigo.required = t === 'unidad';
          form.elements.stock.closest('.field').style.opacity = t === 'consumible' ? '1' : '0.45';
          form.elements.mantenimiento.closest('.field').style.display = t === 'unidad' ? '' : 'none';
        };
        form.elements.tipo.addEventListener('change', sync);
        sync();
      },
      onSubmit(data, form) {
        const codigo = String(data.codigo || '').trim().toUpperCase();
        if (codigo && store.all('insumos').some((x) => String(x.codigo || '').toUpperCase() === codigo && (!r || x.id !== r.id))) {
          ui.toast(`El código ${codigo} ya existe en el inventario.`, 'warn');
          form.elements.codigo.focus();
          return false;
        }
        const rec = {
          nombre: data.nombre, categoria: data.categoria, tipo: data.tipo, codigo, unidad: data.unidad,
          precio: data.precio, stock: data.tipo === 'consumible' && data.stock != null ? data.stock : null,
          ubicacion: data.ubicacion, descripcion: data.descripcion,
          estado: data.tipo === 'unidad' && data.mantenimiento ? 'mantenimiento' : 'disponible', activo: !!data.activo
        };
        if (r) store.update('insumos', r.id, rec);
        else store.insert('insumos', rec, 'ins');
        ui.toast(r ? 'Recurso actualizado.' : `${h.insLabel(rec)} agregado al inventario.`);
      }
    });
  };

  PLX.forms.lote = () => {
    ui.modal({
      title: 'Cargar varias unidades',
      sub: 'Crea unidades numeradas iguales de una vez (por ejemplo, 6 computadoras PC-01 a PC-06).',
      submitLabel: 'Crear unidades',
      body: ui.form([
        { name: 'nombre', label: 'Nombre', required: true, span: 2, maxlength: 120, placeholder: 'Ej.: Computadora portátil' },
        { name: 'categoria', label: 'Categoría', type: 'select', options: domain.CATEGORIAS.map((c) => ({ value: c.id, label: c.nombre })) },
        { name: 'prefijo', label: 'Prefijo del código', required: true, cls: 'mono', maxlength: 8, placeholder: 'PC' },
        { name: 'cantidad', label: 'Cantidad de unidades', type: 'number', min: 1, max: 200, step: 1, required: true },
        { name: 'desde', label: 'Numerar desde', type: 'number', min: 1, step: 1, required: true },
        { name: 'unidad', label: 'Se cobra por', type: 'select', options: domain.UNIDADES },
        { name: 'precio', label: 'Precio (ARS, neto)', type: 'number', min: 0, step: 0.01, required: true },
        { name: 'ubicacion', label: 'Ubicación', span: 2, maxlength: 120 },
        { type: 'html', span: 2, html: '<div class="calc-line"><span>Se crearán</span><strong id="lote-prev">—</strong></div>' }
      ], { categoria: 'utileria', cantidad: 4, desde: 1, unidad: 'día' }),
      onMount(d, form) {
        const prev = () => {
          const pre = String(form.elements.prefijo.value || '').trim().toUpperCase();
          const n = Number(form.elements.cantidad.value) || 0;
          const desde = Number(form.elements.desde.value) || 1;
          const cod = (k) => `${pre}-${String(k).padStart(2, '0')}`;
          d.querySelector('#lote-prev').textContent = pre && n ? (n === 1 ? cod(desde) : `${cod(desde)} … ${cod(desde + n - 1)}`) : '—';
        };
        form.elements.prefijo.addEventListener('input', () => {
          const pre = String(form.elements.prefijo.value || '').trim().toUpperCase();
          const usados = store.all('insumos').map((i) => String(i.codigo || '')).filter((c) => c.startsWith(`${pre}-`)).map((c) => Number(c.split('-').pop()) || 0);
          form.elements.desde.value = usados.length ? Math.max(...usados) + 1 : 1;
          prev();
        });
        ['cantidad', 'desde'].forEach((n) => form.elements[n].addEventListener('input', prev));
        prev();
      },
      onSubmit(data) {
        const pre = String(data.prefijo).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!pre) { ui.toast('Indicá un prefijo con letras o números.', 'warn'); return false; }
        const codigos = [];
        for (let k = 0; k < data.cantidad; k++) codigos.push(`${pre}-${String(data.desde + k).padStart(2, '0')}`);
        const existentes = new Set(store.all('insumos').map((i) => String(i.codigo || '').toUpperCase()));
        const choque = codigos.find((c) => existentes.has(c));
        if (choque) { ui.toast(`El código ${choque} ya existe. Cambiá «Numerar desde».`, 'warn'); return false; }
        codigos.forEach((codigo) => store.insert('insumos', {
          nombre: data.nombre, categoria: data.categoria, tipo: 'unidad', codigo, unidad: data.unidad, precio: data.precio,
          stock: null, ubicacion: data.ubicacion, descripcion: '', estado: 'disponible', activo: true
        }, 'ins'));
        ui.toast(`${codigos.length} unidades creadas (${codigos[0]} a ${codigos[codigos.length - 1]}).`);
      }
    });
  };

  /* ---------- Render ---------- */
  function filtrar(st, asig, uso) {
    const q = util.normalize(st.q);
    return store.all('insumos')
      .filter((i) => !st.cat || i.categoria === st.cat)
      .filter((i) => !st.tipo || i.tipo === st.tipo)
      .filter((i) => {
        if (!st.estado) return true;
        const e = h.estadoUnidad(i, asig, uso);
        return e && e.id === st.estado;
      })
      .filter((i) => !q || util.normalize(`${i.codigo} ${i.nombre} ${i.ubicacion} ${i.descripcion}`).includes(q))
      .sort((a, b) => domain.CATEGORIAS.findIndex((c) => c.id === a.categoria) - domain.CATEGORIAS.findIndex((c) => c.id === b.categoria)
        || a.nombre.localeCompare(b.nombre) || String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
  }

  PLX.views.inventario = {
    title: 'Inventario',

    render(ctx) {
      const st = ctx.state;
      const all = store.all('insumos');
      const asig = h.asignaciones();
      const uso = h.enUso();
      const unidades = all.filter((i) => i.tipo === 'unidad');
      const cuenta = (id) => unidades.filter((i) => (h.estadoUnidad(i, asig, uso) || {}).id === id).length;
      const rows = filtrar(st, asig, uso);
      const porCat = {};
      all.forEach((i) => (porCat[i.categoria] = (porCat[i.categoria] || 0) + 1));

      const head = `
        <div class="page-head">
          <div>
            <h1 class="page-title">Inventario</h1>
            <p class="page-sub">Todo lo que se puede asignar, prestar o cobrar: espacios, equipos, mobiliario, papelería, insumos y horas.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-sm" data-action="lote">${icon('layers', 'i-sm')} Cargar varias unidades</button>
            <button class="btn btn-primary btn-sm" data-action="nuevo">${icon('plus', 'i-sm')} Nuevo recurso</button>
          </div>
        </div>`;

      if (!all.length) {
        return `${head}
          <section class="pcard">
            <div class="empty" style="padding:56px 20px">
              ${icon('layers')}
              <span>El inventario está vacío. Cargá cada recurso a mano o empezá con un inventario de ejemplo y ajustalo.</span>
              <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px">
                <button class="btn btn-primary btn-sm" data-action="nuevo">${icon('plus', 'i-sm')} Nuevo recurso</button>
                <button class="btn btn-sm" data-action="ejemplo">${icon('spark', 'i-sm')} Cargar inventario de ejemplo</button>
              </div>
            </div>
          </section>`;
      }

      return `${head}
        <div class="grid grid-kpi">
          ${ui.kpi({ label: 'Unidades numeradas', value: unidades.length, hint: `${all.length - unidades.length} consumibles y servicios por tiempo`, ic: 'layers' })}
          ${ui.kpi({ label: 'Disponibles', value: cuenta('disponible'), hint: 'Listas para asignar o prestar', ic: 'check' })}
          ${ui.kpi({ label: 'Asignadas por contrato', value: cuenta('asignada'), hint: 'Incluidas en abonos vigentes', ic: 'contract' })}
          ${ui.kpi({ label: 'En uso ahora', value: cuenta('en-uso'), hint: 'Prestadas en check-ins abiertos', ic: 'badge', tone: 'magenta' })}
          ${ui.kpi({ label: 'En mantenimiento', value: cuenta('mantenimiento'), hint: 'Fuera de servicio', ic: 'alert', tone: 'magenta' })}
        </div>

        <div class="chips" role="group" aria-label="Filtrar por categoría">
          <button type="button" class="chip${!st.cat ? ' is-on' : ''}" data-action="cat" data-cat="">Todo <strong>${all.length}</strong></button>
          ${domain.CATEGORIAS.map((c) => `<button type="button" class="chip${st.cat === c.id ? ' is-on' : ''}" data-action="cat" data-cat="${c.id}">${esc(c.nombre)} <strong>${porCat[c.id] || 0}</strong></button>`).join('')}
        </div>

        <div class="toolbar">
          <div class="search">${icon('search', 'i-sm')}<input class="input" id="q-inventario" type="search" placeholder="Buscar por código, nombre o ubicación" value="${esc(st.q || '')}" data-input="q"></div>
          <select class="select" data-change="tipo" aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            ${domain.TIPOS_RECURSO.map((t) => `<option value="${t.id}"${st.tipo === t.id ? ' selected' : ''}>${t.nombre}</option>`).join('')}
          </select>
          <select class="select" data-change="estado" aria-label="Filtrar por estado">
            <option value="">Cualquier estado</option>
            ${[['disponible', 'Disponibles'], ['asignada', 'Asignadas por contrato'], ['en-uso', 'En uso ahora'], ['mantenimiento', 'En mantenimiento']].map(([v, l]) => `<option value="${v}"${st.estado === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <span class="grow"></span>
          <button class="btn btn-sm" data-action="export">${icon('download', 'i-sm')} CSV</button>
        </div>

        <section class="pcard">
          ${ui.table({
            rows,
            empty: 'No hay recursos que coincidan con el filtro.',
            emptyIcon: 'layers',
            cols: [
              { label: 'Código', cell: (i) => (i.codigo ? `<span class="strong mono nowrap">${esc(i.codigo)}</span>` : '<span class="muted">—</span>') },
              { label: 'Recurso', primary: true, cell: (i) => `<span class="strong">${esc(i.nombre)}</span><span class="sub">${esc(i.ubicacion || i.descripcion || '')}</span>` },
              { label: 'Categoría', cell: (i) => ui.badge(domain.catNombre(i.categoria), 'outline') },
              { label: 'Tipo', cell: (i) => `<span class="small text-2">${esc(domain.tipoNombre(i.tipo))}</span>` },
              { label: 'Precio', cls: 'num', cell: (i) => `${util.money(i.precio)}<span class="sub">por ${esc(i.unidad)}</span>` },
              { label: 'Stock', cls: 'num', cell: (i) => (i.tipo === 'consumible' && typeof i.stock === 'number' ? `<span class="${i.stock <= 3 ? 'is-low' : ''}">${util.num(i.stock)}</span>` : '<span class="muted">—</span>') },
              {
                label: 'Estado', cell: (i) => {
                  if (!i.activo) return ui.badge('Pausado', 'outline');
                  const e = h.estadoUnidad(i, asig, uso);
                  if (!e) return '<span class="muted small">—</span>';
                  const quien = e.contrato ? h.locName(e.contrato.locatarioId) : e.acceso ? e.acceso.nombre : '';
                  return `${ui.badge(e.nombre, e.tone, true)}${quien ? `<span class="sub">${esc(quien)}</span>` : ''}`;
                }
              },
              {
                label: '', cls: 'actions', cell: (i) =>
                  ui.iconBtn('editar', 'edit', 'Editar recurso', `data-id="${i.id}"`) +
                  (i.tipo === 'unidad' ? ui.iconBtn('mant', i.estado === 'mantenimiento' ? 'check' : 'alert', i.estado === 'mantenimiento' ? 'Marcar disponible' : 'Enviar a mantenimiento', `data-id="${i.id}"`) : '') +
                  ui.iconBtn('eliminar', 'trash', 'Eliminar recurso', `data-id="${i.id}"`)
              }
            ]
          })}
        </section>
        <div class="note" style="margin-top:16px">${icon('info', 'i-sm')}<div><strong>Cómo se usa el inventario.</strong> En cada contrato elegís qué unidades quedan asignadas (oficina, escritorio, locker) y qué cantidades mensuales incluye el abono (horas de sala, resmas, hojas). En el check-in se registra lo que cada persona solicita. A fin de mes, la facturación descuenta lo incluido y cobra solo el excedente.</div></div>`;
    },

    inputs: { q(el, e, ctx) { ctx.state.q = el.value; ctx.render(); } },
    changes: {
      tipo(el, e, ctx) { ctx.state.tipo = el.value; ctx.render(); },
      estado(el, e, ctx) { ctx.state.estado = el.value; ctx.render(); }
    },
    actions: {
      nuevo: (el, e, ctx) => PLX.forms.recurso(null, ctx.state.cat ? { categoria: ctx.state.cat } : {}),
      lote: () => PLX.forms.lote(),
      editar: (el) => PLX.forms.recurso(el.dataset.id),
      cat(el, e, ctx) { ctx.state.cat = el.dataset.cat; ctx.render(); },
      mant(el) {
        const i = store.get('insumos', el.dataset.id);
        const mant = i.estado !== 'mantenimiento';
        store.update('insumos', i.id, { estado: mant ? 'mantenimiento' : 'disponible' });
        ui.toast(`${h.insLabel(i)}: ${mant ? 'en mantenimiento' : 'disponible'}.`);
      },
      async eliminar(el) {
        const i = store.get('insumos', el.dataset.id);
        const usado = store.where('consumos', (c) => c.insumoId === i.id).length
          || store.all('contratos').some((c) => (c.recursos || []).some((r) => r.insumoId === i.id))
          || store.all('accesos').some((a) => a.espacioId === i.id || (a.items || []).some((it) => it.insumoId === i.id));
        if (usado) { ui.toast(`${h.insLabel(i)} figura en contratos, check-ins o consumos: pausalo en lugar de eliminarlo.`, 'warn'); return; }
        const ok = await ui.confirm({ title: 'Eliminar recurso', message: `Se eliminará <strong>${esc(h.insLabel(i))}</strong> del inventario.`, confirmLabel: 'Eliminar', danger: true });
        if (ok) { store.remove('insumos', i.id); ui.toast('Recurso eliminado.'); }
      },
      async ejemplo() {
        const ok = await ui.confirm({ title: 'Cargar inventario de ejemplo', message: 'Se agregan espacios, computadoras, monitores, mobiliario, papelería, insumos y horas con precios orientativos. Después podés editarlos o borrarlos.', confirmLabel: 'Cargar ejemplo' });
        if (!ok) return;
        PLX.seedInventario().forEach((r) => store.insert('insumos', r));
        ui.toast('Inventario de ejemplo cargado.');
      },
      export(el, e, ctx) {
        const asig = h.asignaciones(), uso = h.enUso();
        const rows = [['Código', 'Nombre', 'Categoría', 'Tipo', 'Se cobra por', 'Precio', 'Stock', 'Ubicación', 'Estado']];
        filtrar(ctx.state, asig, uso).forEach((i) => {
          const est = h.estadoUnidad(i, asig, uso);
          rows.push([i.codigo, i.nombre, domain.catNombre(i.categoria), domain.tipoNombre(i.tipo), i.unidad, util.csvNum(i.precio), i.stock ?? '', i.ubicacion, i.activo ? (est ? est.nombre : '') : 'Pausado']);
        });
        util.download(`parallax-inventario-${util.todayStr()}.csv`, util.toCsv(rows), 'text/csv;charset=utf-8');
        ui.toast('Inventario exportado.');
      }
    }
  };
})(window);
