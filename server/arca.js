/* ==========================================================================
   PARALLAX · Factura electrónica ARCA (WSAA + WSFEv1)
   ---------------------------------------------------------------------------
   Solicita el CAE de cada resumen emitido usando los servicios web de ARCA.
   Requisitos (una sola vez, con la clave fiscal de PARALLAX):
     1. Generar clave privada y pedido de certificado (CSR) con openssl.
     2. Subir el CSR en «Administración de Certificados Digitales» y descargar
        el certificado.
     3. Asociar el certificado al servicio «wsfe» desde el
        «Administrador de Relaciones de Clave Fiscal».
     4. Dar de alta un punto de venta para «Factura electrónica · Web Services».
   Primero se prueba en homologación (testing); después, en producción.

   Variables de entorno:
     ARCA_CUIT            CUIT de PARALLAX (sin guiones)
     ARCA_CERT            Ruta al certificado (.crt / .pem)
     ARCA_KEY             Ruta a la clave privada (.key)
     ARCA_PUNTO_VENTA     Número de punto de venta habilitado para web services
     ARCA_PRODUCCION      «1» para producción (por defecto: homologación)
   Requiere el programa openssl instalado en el servidor (firma del pedido).
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const reglas = require('../assets/js/core/reglas.js');

const PROD = process.env.ARCA_PRODUCCION === '1';
const URLS = {
  wsaa: process.env.ARCA_WSAA_URL || (PROD ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms' : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms'),
  wsfe: process.env.ARCA_WSFE_URL || (PROD ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx')
};
const QR_BASE = process.env.ARCA_QR_URL || 'https://www.afip.gob.ar/fe/qr/';
const CFG = {
  cuit: String(process.env.ARCA_CUIT || '').replace(/\D/g, ''),
  cert: process.env.ARCA_CERT || '',
  key: process.env.ARCA_KEY || '',
  ptoVta: Number(process.env.ARCA_PUNTO_VENTA) || 0
};

function estado() {
  const faltan = [];
  if (CFG.cuit.length !== 11) faltan.push('ARCA_CUIT');
  if (!CFG.cert || !fs.existsSync(CFG.cert)) faltan.push('ARCA_CERT');
  if (!CFG.key || !fs.existsSync(CFG.key)) faltan.push('ARCA_KEY');
  if (!CFG.ptoVta) faltan.push('ARCA_PUNTO_VENTA');
  return { configurado: !faltan.length, faltan, entorno: PROD ? 'produccion' : 'homologacion', cuit: CFG.cuit || null, puntoVenta: CFG.ptoVta || null };
}

/* ---------- SOAP ---------- */
function post(url, soapAction, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('ARCA no respondió a tiempo.')));
    req.on('error', reject);
    req.end(body);
  });
}
const tag = (xml, name) => {
  const m = String(xml).match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
  return m ? m[1].trim() : '';
};
const todos = (xml, name) => Array.from(String(xml).matchAll(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g')), (m) => m[1]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const yyyymmdd = (s) => String(s).slice(0, 10).replace(/-/g, '');
const num = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

/* ---------- WSAA: ticket de acceso ---------- */
let ticket = null;
async function login() {
  if (ticket && ticket.exp > Date.now() + 120000) return ticket;
  const now = Date.now();
  const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now / 1000)}</uniqueId><generationTime>${new Date(now - 600000).toISOString()}</generationTime><expirationTime>${new Date(now + 600000).toISOString()}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallax-arca-'));
  let cms;
  try {
    const traPath = path.join(dir, 'tra.xml');
    fs.writeFileSync(traPath, tra);
    cms = execFileSync('openssl', ['cms', '-sign', '-in', traPath, '-signer', CFG.cert, '-inkey', CFG.key, '-nodetach', '-outform', 'DER', '-binary']).toString('base64');
  } catch (e) {
    throw new Error('No se pudo firmar el pedido de acceso. Revisá el certificado, la clave y que openssl esté instalado.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const xml = await post(URLS.wsaa, '', `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`);
  const ret = decode(tag(xml, 'loginCmsReturn'));
  if (!ret) throw new Error(decode(tag(xml, 'faultstring')) || 'Respuesta inválida del servicio de autenticación.');
  ticket = { token: tag(ret, 'token'), sign: tag(ret, 'sign'), exp: Date.parse(tag(ret, 'expirationTime')) || now + 3600000 };
  return ticket;
}

/* ---------- WSFEv1 ---------- */
const NS = 'http://ar.gov.afip.dif.FEV1/';
const sobre = (inner) => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soapenv:Header/><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;
const auth = (t) => `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${CFG.cuit}</ar:Cuit></ar:Auth>`;
function errores(xml) {
  const errs = todos(xml, 'Err').map((e) => `${tag(e, 'Code')}: ${decode(tag(e, 'Msg'))}`);
  if (errs.length) throw new Error(errs.join(' · '));
  const fault = tag(xml, 'faultstring');
  if (fault) throw new Error(decode(fault));
}

async function ultimoAutorizado(t, tipo) {
  const xml = await post(URLS.wsfe, `${NS}FECompUltimoAutorizado`, sobre(`<ar:FECompUltimoAutorizado>${auth(t)}<ar:PtoVta>${CFG.ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`));
  errores(xml);
  return Number(tag(xml, 'CbteNro')) || 0;
}

function pedidoCAE(t, f, nro) {
  const iva = f.tipo === 11 ? '' : `<ar:Iva><ar:AlicIva><ar:Id>${f.alicuotaId}</ar:Id><ar:BaseImp>${num(f.neto)}</ar:BaseImp><ar:Importe>${num(f.iva)}</ar:Importe></ar:AlicIva></ar:Iva>`;
  return sobre(`<ar:FECAESolicitar>${auth(t)}<ar:FeCAEReq>
    <ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${CFG.ptoVta}</ar:PtoVta><ar:CbteTipo>${f.tipo}</ar:CbteTipo></ar:FeCabReq>
    <ar:FeDetReq><ar:FECAEDetRequest>
      <ar:Concepto>${f.concepto}</ar:Concepto><ar:DocTipo>${f.docTipo}</ar:DocTipo><ar:DocNro>${esc(f.docNro)}</ar:DocNro>
      <ar:CbteDesde>${nro}</ar:CbteDesde><ar:CbteHasta>${nro}</ar:CbteHasta><ar:CbteFch>${yyyymmdd(f.fecha)}</ar:CbteFch>
      <ar:ImpTotal>${num(f.total)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${num(f.neto)}</ar:ImpNeto>
      <ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${num(f.iva)}</ar:ImpIVA>
      <ar:FchServDesde>${yyyymmdd(f.servDesde)}</ar:FchServDesde><ar:FchServHasta>${yyyymmdd(f.servHasta)}</ar:FchServHasta><ar:FchVtoPago>${yyyymmdd(f.vtoPago)}</ar:FchVtoPago>
      <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
      <ar:CondicionIVAReceptorId>${f.condicionIvaReceptor}</ar:CondicionIVAReceptorId>
      ${iva}
    </ar:FECAEDetRequest></ar:FeDetReq>
  </ar:FeCAEReq></ar:FECAESolicitar>`);
}

/** Solicita el CAE para un resumen emitido y devuelve el registro de la factura. */
async function facturar(db, resumen, { id }) {
  const est = estado();
  if (!est.configurado) throw new Error(`Falta configurar en el servidor: ${est.faltan.join(', ')}.`);
  const f = reglas.factura.armar(db, resumen);
  if (f.avisos.length && f.tipo === 1 && f.docTipo !== 80) throw new Error(f.avisos[0]);
  const t = await login();
  const nro = (await ultimoAutorizado(t, f.tipo)) + 1;
  const xml = await post(URLS.wsfe, `${NS}FECAESolicitar`, pedidoCAE(t, f, nro));
  errores(xml);
  const resultado = tag(xml, 'Resultado');
  const obs = todos(xml, 'Obs').map((o) => `${tag(o, 'Code')}: ${decode(tag(o, 'Msg'))}`);
  if (resultado !== 'A') throw new Error(obs.join(' · ') || 'Comprobante rechazado.');
  const factura = Object.assign({}, f, {
    id, resumenId: resumen.id, locatarioId: resumen.locatarioId, puntoVenta: CFG.ptoVta, numero: nro,
    cae: tag(xml, 'CAE'), caeVto: tag(xml, 'CAEFchVto'), estado: 'autorizada', entorno: est.entorno,
    observaciones: obs, creadoEn: new Date().toISOString()
  });
  delete factura.avisos;
  factura.qr = reglas.factura.qr(QR_BASE, factura, CFG.cuit);
  return factura;
}

module.exports = { estado, facturar, _pedidoCAE: pedidoCAE };
