/* ==========================================================================
   PARALLAX · Utilidades compartidas (formato, fechas, CSV, descargas)
   Scripts clásicos (sin módulos ES) para funcionar también abriendo el
   archivo localmente con doble clic.
   ========================================================================== */
(function (root) {
  'use strict';

  const PLX = (root.PLX = root.PLX || {});

  const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  const pad = (n) => String(n).padStart(2, '0');
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  const fmtMoney = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const fmtMoney0 = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  const fmtCompact = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });

  const util = {
    MESES,
    pad,
    round2,

    money: (n) => fmtMoney.format(round2(n || 0)),
    money0: (n) => fmtMoney0.format(Math.round(n || 0)),
    num: (n) => fmtNum.format(n || 0),
    compact: (n) => fmtCompact.format(n || 0),
    /** Número con coma decimal y sin separador de miles (CSV para planillas es-AR). */
    csvNum: (n) => round2(n || 0).toFixed(2).replace('.', ','),

    /* ---------- Fechas ---------- */
    todayStr(d = new Date()) {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    periodOf(d = new Date()) {
      if (typeof d === 'string') return d.slice(0, 7);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    },
    parseDate(s) {
      if (!s) return null;
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    },
    addDays(s, n) {
      const d = util.parseDate(s);
      d.setDate(d.getDate() + n);
      return util.todayStr(d);
    },
    diffDays(a, b) {
      // b - a en días calendario
      const da = util.parseDate(a), db = util.parseDate(b);
      return Math.round((db - da) / 86400000);
    },
    daysInMonth(y, m1) {
      return new Date(y, m1, 0).getDate();
    },
    periodRange(p) {
      const [y, m] = p.split('-').map(Number);
      const days = util.daysInMonth(y, m);
      return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(days)}`, days };
    },
    shiftPeriod(p, delta) {
      const [y, m] = p.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return util.periodOf(d);
    },
    periodLabel(p, short = false) {
      const [y, m] = p.split('-').map(Number);
      const name = MESES[m - 1];
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      return short ? `${cap.slice(0, 3)} ${y}` : `${cap} ${y}`;
    },
    fmtDate(s) {
      if (!s) return '—';
      const d = util.parseDate(s);
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    },
    fmtDateLong(s) {
      const d = typeof s === 'string' ? util.parseDate(s) : s;
      return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    },
    fmtDayShort(s) {
      const d = util.parseDate(s);
      return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
    },
    fmtDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    fmtTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    /** Valor para <input type="datetime-local"> */
    toLocalInput(d = new Date()) {
      const x = typeof d === 'string' ? new Date(d) : d;
      return `${util.todayStr(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
    },
    fromLocalInput(v) {
      return v ? new Date(v).toISOString() : null;
    },
    localDateOfIso(iso) {
      return util.todayStr(new Date(iso));
    },
    fmtDuration(ms) {
      if (ms == null || ms < 0) return '—';
      const mins = Math.round(ms / 60000);
      const h = Math.floor(mins / 60), m = mins % 60;
      if (h === 0) return `${m} min`;
      return m ? `${h} h ${pad(m)} min` : `${h} h`;
    },
    relTime(iso) {
      const diff = Date.now() - new Date(iso).getTime();
      const min = Math.round(diff / 60000);
      if (min < 1) return 'recién';
      if (min < 60) return `hace ${min} min`;
      const h = Math.round(min / 60);
      if (h < 24) return `hace ${h} h`;
      const d = Math.round(h / 24);
      return d === 1 ? 'ayer' : `hace ${d} días`;
    },

    /** Edad en años cumplidos a partir de una fecha AAAA-MM-DD. */
    edad(nacimiento, hoy = new Date()) {
      if (!nacimiento) return null;
      const n = util.parseDate(nacimiento);
      let e = hoy.getFullYear() - n.getFullYear();
      const m = hoy.getMonth() - n.getMonth();
      if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) e--;
      return e >= 0 && e < 130 ? e : null;
    },
    /** Plural de una unidad de medida: hora → horas, unidad → unidades. */
    plural(u, n) {
      if (Number(n) === 1 || !u) return u || '';
      if (u === 'unidad') return 'unidades';
      if (u === 'mes') return 'meses';
      if (u === 'kg') return 'kg';
      return /[aeiouáéíóú]$/i.test(u) ? `${u}s` : `${u}es`;
    },
    fmtBytes(b) {
      if (b == null) return '';
      if (b < 1024) return `${b} B`;
      if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
      return `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
    },

    /** Huella SHA-256 (la misma función que usa el servidor). */
    sha256(x) { return root.PLX.reglas.sha256(x); },

    /* ---------- Texto ---------- */
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    normalize(s) {
      return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    },
    initials(name) {
      return String(name || '?')
        .split(/\s+/).filter(Boolean).slice(0, 2)
        .map((w) => w[0].toUpperCase()).join('');
    },
    uid(prefix = 'id') {
      return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    },
    isEmail(s) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
    },
    /** Valida CUIT/CUIL argentino (formato y dígito verificador). Vacío = válido (dato pendiente). */
    isCuit(s) {
      const v = String(s || '').replace(/\D/g, '');
      if (!v) return true;
      if (v.length !== 11) return false;
      const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      const sum = w.reduce((acc, k, i) => acc + k * Number(v[i]), 0);
      let dv = 11 - (sum % 11);
      if (dv === 11) dv = 0;
      if (dv === 10) dv = 9;
      return dv === Number(v[10]);
    },
    fmtDni(s) {
      const v = String(s || '').replace(/\D/g, '');
      if (v.length < 7 || v.length > 8) return s || '';
      return v.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    },
    fmtCuit(s) {
      const v = String(s || '').replace(/\D/g, '');
      return v.length === 11 ? `${v.slice(0, 2)}-${v.slice(2, 10)}-${v.slice(10)}` : s || '';
    },

    /* ---------- Exportación ---------- */
    /** CSV con separador «;» y BOM UTF-8 (abre directo en planillas configuradas en es-AR). */
    toCsv(rows, sep = ';') {
      const cell = (v) => {
        const s = v == null ? '' : String(v);
        return /[";\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      return '﻿' + rows.map((r) => r.map(cell).join(sep)).join('\r\n');
    },
    download(filename, content, mime = 'text/plain;charset=utf-8') {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    },
    slug(s) {
      return util.normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    },

    /* ---------- Varios ---------- */
    debounce(fn, ms = 200) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    },
    /** PRNG determinista (mulberry32) para datos de demostración reproducibles. */
    rng(seed = 1) {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    groupBy(arr, keyFn) {
      return arr.reduce((acc, x) => {
        const k = keyFn(x);
        (acc[k] = acc[k] || []).push(x);
        return acc;
      }, {});
    },
    sum(arr, fn = (x) => x) {
      return arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
    }
  };

  PLX.util = util;
})(window);
