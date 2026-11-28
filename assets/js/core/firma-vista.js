/* ==========================================================================
   PARALLAX · Constancia de firma de un contrato (vista compartida)
   Muestra estado, huella SHA-256, verificación de integridad, datos de cada
   firma y el registro de eventos encadenado. La usan el Panel de Gestoría
   y el Área de Miembros.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});
  const { util, reglas } = PLX;
  const esc = (s) => util.esc(s);

  const EVENTOS = {
    'documento-generado': 'Documento generado',
    'enviado-a-firma': 'Enviado a firma',
    'visto-por-cliente': 'Abierto por el cliente',
    'firmado-por-cliente': 'Firmado por el cliente',
    'firmado-por-prestador': 'Firmado por PARALLAX',
    'envio-anulado': 'Envío anulado',
    'pdf-con-firma-digital': 'PDF con firma digital adjuntado'
  };

  function dispositivo(ua) {
    if (!ua) return '—';
    const so = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Otro';
    const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return `${so}${nav ? ` · ${nav}` : ''}`;
  }

  const check = (ok, si, no) => (ok === null ? '' : `<li class="${ok ? 'ok' : 'bad'}">${PLX.icon(ok ? 'check' : 'alert', 'i-sm')} ${ok ? si : no}</li>`);

  const vista = {
    EVENTOS,
    dispositivo,

    /** HTML de la constancia. opts: { admin: bool, db } */
    constancia(c, opts = {}) {
      const f = c.firma;
      if (!f) return '';
      const est = reglas.firma.ESTADOS[reglas.firma.estado(c)];
      const v = reglas.firma.verificar(c);
      const dato = (k, val, mono) => `<div><dt>${k}</dt><dd class="${mono ? 'mono' : ''}">${val || '<span class="muted">—</span>'}</dd></div>`;
      const cambio = opts.admin && opts.db && reglas.firma.desactualizado(opts.db, c);

      return `
        <div class="ficha">
          <section class="ficha-sec">
            <div class="ficha-head">
              <h3 class="ficha-title">${PLX.icon('shield', 'i-sm')} Constancia de firma</h3>
              ${PLX.ui ? PLX.ui.badge(est.nombre, est.tono, true) : esc(est.nombre)}
            </div>
            <dl class="loc-meta ficha-grid">
              ${dato('Contrato', esc(c.numero), true)}
              ${dato('Versión del documento', f.version ? String(f.version) : '—', true)}
              ${dato('Código de verificación', f.codigo ? `<strong>${esc(f.codigo)}</strong>` : '', true)}
              ${dato('Generado', f.documento ? util.fmtDateTime(f.documento.generadoEn) : '', true)}
            </dl>
            ${f.documento ? `<p class="small muted" style="margin:14px 0 4px">Huella SHA-256 del texto del contrato</p><p class="hash">${esc(f.documento.hash)}</p>` : ''}
            <ul class="verif" style="margin-top:12px">
              ${check(v.documento, 'El texto coincide con su huella: no fue modificado desde que se generó.', 'El texto NO coincide con su huella: fue modificado.')}
              ${check(v.cadena, 'El registro de eventos está íntegro (cada evento está encadenado al anterior).', 'El registro de eventos fue alterado.')}
              ${check(v.imagen, 'La firma manuscrita coincide con su huella.', 'La firma manuscrita fue alterada.')}
            </ul>
            ${cambio ? `<div class="note is-magenta" style="margin-top:12px">${PLX.icon('alert', 'i-sm')}<div>Los datos del contrato o de la configuración cambiaron después del envío. La versión enviada sigue siendo la que vale tal como se firmó; si querés que rijan los cambios, enviá una nueva versión a firmar.</div></div>` : ''}
          </section>

          <div class="grid grid-2" style="gap:14px">
            <section class="ficha-sec">
              <h3 class="ficha-title">${PLX.icon('user', 'i-sm')} Firma del cliente</h3>
              ${f.cliente ? `
                <dl class="loc-meta">
                  ${dato('Nombre', esc(f.cliente.nombre))}
                  ${dato('DNI', esc(util.fmtDni(f.cliente.dni)), true)}
                  ${dato('Fecha y hora', util.fmtDateTime(f.cliente.fecha), true)}
                  ${dato('Usuario', esc(f.cliente.actor), true)}
                  ${dato('IP', esc(f.cliente.ip || (opts.admin ? 'Solo se registra con el servidor' : '—')), true)}
                  ${dato('Dispositivo', esc(dispositivo(f.cliente.ua)))}
                </dl>
                ${f.cliente.imagen ? `<img class="firma-img" src="${esc(f.cliente.imagen)}" alt="Firma manuscrita de ${esc(f.cliente.nombre)}" style="margin-top:12px">` : ''}
                <p class="small muted" style="margin-top:10px">${esc(f.cliente.metodo)}</p>`
                : '<p class="small muted">Todavía no firmó.</p>'}
            </section>
            <section class="ficha-sec">
              <h3 class="ficha-title">${PLX.icon('office', 'i-sm')} Firma de PARALLAX</h3>
              ${f.prestador ? `<dl class="loc-meta">${dato('Firmó', esc(f.prestador.nombre))}${dato('Fecha y hora', util.fmtDateTime(f.prestador.fecha), true)}${dato('Usuario', esc(f.prestador.actor), true)}</dl>` : '<p class="small muted">Pendiente.</p>'}
              ${f.digital ? `<div class="note" style="margin-top:12px">${PLX.icon('file-check', 'i-sm')}<div><strong>PDF con firma digital:</strong> ${esc(f.digital.nombre)}<br><span class="hash">${esc(f.digital.hash)}</span></div></div>` : ''}
            </section>
          </div>

          <section class="ficha-sec">
            <h3 class="ficha-title">${PLX.icon('clock', 'i-sm')} Registro de eventos</h3>
            <div class="table-wrap"><table class="eventos">
              <thead><tr><th>Fecha y hora</th><th>Evento</th><th>Usuario</th><th>IP</th><th>Huella</th></tr></thead>
              <tbody>${(f.eventos || []).map((e) => `<tr><td class="mono">${util.fmtDateTime(e.fecha)}</td><td>${esc(EVENTOS[e.tipo] || e.tipo)}</td><td class="mono">${esc(e.actor || '—')}</td><td class="mono">${esc(e.ip || '—')}</td><td class="mono" title="${esc(e.hash)}">${esc(e.hash.slice(0, 12))}…</td></tr>`).join('')}</tbody>
            </table></div>
          </section>

          ${f.documento ? `<section class="ficha-sec">
            <h3 class="ficha-title">${PLX.icon('contract', 'i-sm')} Texto firmado</h3>
            <div class="contrato-texto">${esc(f.documento.texto)}</div>
          </section>` : ''}
        </div>`;
    },

    /** Constancia en JSON para conservar o presentar como prueba. */
    json(c) {
      return JSON.stringify({ formato: 'parallax.constancia-firma.v1', contrato: c.numero, firma: c.firma, verificacion: reglas.firma.verificar(c), generado: new Date().toISOString() }, null, 2);
    }
  };

  PLX.firmaVista = vista;
})(window);
