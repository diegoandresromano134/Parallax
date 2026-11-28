# PARALLAX · Coworking corporativo

Aplicación web de PARALLAX, coworking de alto nivel dedicado a la provisión de infraestructura y servicios compartidos corporativos. Tiene tres interfaces:

| Interfaz | Archivo | Para quién |
|---|---|---|
| **Sitio público** | `index.html` | Personas y profesionales que todavía no conocen el coworking |
| **Área de Miembros** | `ingresar.html` → `miembros.html` | Clientes de PARALLAX, que ingresan con usuario y contraseña, como en un club |
| **Panel de Gestoría** | `ingresar.html` → `gestoria.html` | Equipo de administración de PARALLAX |

## Dos formas de usarla

### 1. Demostración (sin instalar nada)

Abrí `index.html` en el navegador. Todo funciona, pero los datos quedan **solo en ese navegador** y el inicio de sesión es ilustrativo (no es seguro). Usuarios de prueba:

| Rol | Usuario | Contraseña |
|---|---|---|
| Administración | `admin` | `parallax` |
| Miembro | `CL-0005` (o cualquier número de cliente de la demo) | `demo1234` |

### 2. Servidor (uso real)

Hace falta [Node.js](https://nodejs.org) 18 o superior. No requiere instalar dependencias.

```bash
PARALLAX_ADMIN_PASSWORD='una-clave-segura' npm start
# o bien: node server/server.js
```

Después entrá a `http://localhost:3000`. Si no definís `PARALLAX_ADMIN_PASSWORD`, el servidor crea el usuario `admin` con una contraseña aleatoria y la muestra **una sola vez** en la consola.

Con el servidor en marcha:

- Las contraseñas se guardan cifradas (scrypt) y la sesión viaja en una cookie `HttpOnly`.
- Los datos son los mismos para todos los dispositivos: recepción, administración y miembros.
- Cada miembro recibe solo su propia información y sus propios documentos.
- Los contratos firmados y demás archivos adjuntos se guardan en el servidor.
- Las consultas del sitio público llegan al panel desde cualquier dispositivo.
- Los intentos de ingreso tienen límite, para frenar ataques de fuerza bruta.

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `PORT` | Puerto | `3000` |
| `PARALLAX_DATA_DIR` | Carpeta de datos (base, usuarios, archivos) | `./data` |
| `PARALLAX_ADMIN_USER` | Usuario administrador inicial | `admin` |
| `PARALLAX_ADMIN_PASSWORD` | Contraseña inicial del administrador | se genera y se muestra en la consola |
| `PARALLAX_COOKIE_SECURE` | `1` para marcar la cookie como segura (obligatorio con HTTPS) | — |
| `ARCA_CUIT` · `ARCA_CERT` · `ARCA_KEY` · `ARCA_PUNTO_VENTA` | Factura electrónica (ver más abajo) | — |
| `ARCA_PRODUCCION` | `1` para facturar en producción | homologación |

**Para publicarla en internet** sirve cualquier proveedor que ejecute Node.js (un VPS, Render, Railway, Fly.io, etc.). Hay tres requisitos:

1. Servirla por **HTTPS** y definir `PARALLAX_COOKIE_SECURE=1`.
2. Que la carpeta `PARALLAX_DATA_DIR` esté en un **disco persistente**.
3. Hacer **copias de seguridad** de esa carpeta. También podés descargar un respaldo desde *Configuración → Datos y respaldo*.

La carpeta `data/` está excluida del repositorio a propósito: ahí viven los datos personales y las contraseñas cifradas.

## Panel de Gestoría

El menú sigue el orden de trabajo diario.

### Operación diaria

1. **Legajos.** La ficha de cada cliente (persona o empresa) incluye:
   - número de cliente automático (`CL-0001`);
   - nombre, apellido, documento y CUIT;
   - fecha de nacimiento, con la **edad calculada sola**;
   - teléfono, email y fecha de contrato.

   Desde la ficha también podés:
   - **adjuntar el contrato firmado** y otros documentos (PDF, imagen o Word, hasta 15 MB);
   - ver los contratos del cliente;
   - administrar sus **personas autorizadas** con credencial;
   - crear su **usuario y contraseña para el Área de Miembros**.
2. **Inventario.** Todo lo que PARALLAX alquila, presta o cobra, cargado a mano:
   - espacios: oficinas, escritorios, salas;
   - equipos numerados: computadoras, monitores, proyectores;
   - mobiliario: sillas, lockers;
   - papelería: resmas, hojas impresas;
   - otros insumos y horas adicionales.

   Cada recurso tiene precio y unidad de cobro: día, mes, hora, resma, hoja, etc. Hay tres tipos:
   - **Unidad numerada**: se asigna o se presta y se devuelve.
   - **Consumible**: se entrega y no vuelve, con stock opcional.
   - **Por tiempo**: horas o bloques.

   «Cargar varias unidades» crea, por ejemplo, `PC-01` a `PC-06` de una vez. El estado de cada unidad se ve en vivo: disponible, asignada por contrato, en uso o en mantenimiento.
3. **Check-in / Check-out.** Es la planilla del Control de Accesos.
   - **Al entrar:** escribís el número de cliente o la credencial. Se registra quién ingresó y a qué hora, se le asigna un espacio (por ejemplo `ESC-07`) y se anota lo que solicita (por ejemplo `PC-03` o 2 resmas).
   - **Al salir:** el check-out muestra cada recurso prestado para marcarlo como *Devuelto completo*, *Faltante* o *Con daños*. Podés agregar un detalle y, si corresponde, un cargo por reposición.
   - **Si algo falta:** el registro queda *Con observaciones* hasta resolverlo.
   - **Consumos:** lo solicitado se carga solo como consumo del cliente.

### Gestoría

- **Gestoría de Contratos.** Contratos de locación de servicios (Abonos de Membresía). Cada contrato elige del inventario:
  - las **unidades asignadas** (oficina, escritorio, locker);
  - las **cantidades incluidas por mes** (horas de sala, resmas, hojas).
- **Gestoría de Consumos.** Todos los consumos del período, con un medidor de *usado / incluido* por cliente.
- **Gastos y Facturación.** Consolida, por cliente y por mes:
  - el abono, con prorrateo si el contrato empieza o termina en el mes;
  - los consumos y **excedentes**: se descuenta primero lo incluido en el abono y se factura solo lo que se usó de más;
  - el IVA.

  Emite resúmenes numerados (`RG-AAAAMM-NNNN`) y exporta en CSV (separador `;` y coma decimal) o JSON para el programa contable. El resumen no reemplaza la factura electrónica.

### Comunicación y Sistema

- **Consultas y solicitudes.** Reúne:
  - las consultas del formulario del sitio, que con un clic se convierten en un legajo;
  - las solicitudes que envían los miembros (reservas de sala, insumos, etc.).
- **Configuración.** Datos del prestador, alícuota de IVA, plan de cuentas, usuarios de administración, cambio de contraseña, respaldo y restauración.

### Firma electrónica de contratos

Desde *Gestoría de Contratos*, en la columna **Firma**, se abre el panel de cada contrato.

1. **Enviar a firmar.** Se genera el texto del contrato con los datos actuales y se calcula su **huella SHA-256**. Con ella se arma un **código de verificación** de 12 caracteres. El contrato queda pendiente de firma.
2. **Avisar al cliente.** El mensaje se manda por WhatsApp o email; el cliente ve un aviso al ingresar al Área de Miembros.
3. **Firma del cliente.** El cliente lee el contrato completo, dibuja su firma, confirma nombre y DNI, acepta las cláusulas y **reingresa su contraseña**.
4. **Constancia del servidor.** El servidor registra la fecha y hora, la IP y el dispositivo.
5. **Contrafirma.** PARALLAX firma desde el mismo panel y el contrato queda *Firmado por ambas partes*.
6. **Verificación.** Al abrir el panel se recalcula la huella del texto, la cadena de eventos y la huella de la firma. Si alguien alterara el texto, se ve en rojo.
7. **Firma digital opcional.** Se puede adjuntar el **PDF firmado digitalmente**, por ejemplo con la firma digital remota gratuita de [firmar.gob.ar](https://firmar.gob.ar). Queda registrado con su propia huella.

Si el contrato cambia después de enviarlo, el panel lo avisa y permite **enviar una nueva versión**. La anterior queda anulada en el registro.

### Cobros

- **Configuración** (*Configuración → Cobros y medios de pago*):
  - medios de pago aceptados;
  - banco, titular, CBU y alias;
  - día de vencimiento;
  - **interés por mora** (% mensual, calculado por día);
  - días de gracia, recargo fijo y días para suspender servicios.
- **Cuenta corriente** por cliente: resúmenes emitidos, vencimiento, pagos, intereses y saldo.
  - Cada pago se imputa primero a intereses y después a capital (art. 903 del Código Civil y Comercial).
  - Desde la cuenta del cliente se envía el **aviso de deuda** por WhatsApp o email.
- **Pagos informados:** el miembro informa su pago desde el Área de Miembros, con comprobante opcional. Administración lo confirma o lo rechaza.

### Reservas de salas

- Hay un **calendario semanal por sala**.
  - Los miembros reservan solos y ven los horarios ocupados por otros como «Ocupado», sin nombres.
  - Administración ve todo y puede reservar para cualquier cliente.
- Cada reserva se carga como consumo. **Las horas de sala incluidas en el contrato se descuentan solas** y se cobra solo el excedente.
- Las reglas se configuran en *Configuración → Salas y reservas*:
  - horario de apertura y cierre;
  - bloques de 15, 30 o 60 minutos;
  - duración máxima;
  - días habilitados;
  - **cancelación sin cargo hasta N horas antes**; si se cancela más tarde, se mantiene el cargo.

### Factura electrónica ARCA

Desde *Gastos y Facturación → Resúmenes emitidos → Facturar en ARCA*, el servidor pide el **CAE** a ARCA por los servicios web oficiales (WSAA + WSFEv1).

- **Tipo de comprobante:**
  - Factura **A** si PARALLAX y el cliente son Responsables Inscriptos;
  - Factura **B** para Monotributo, Exento o Consumidor Final;
  - Factura **C** si PARALLAX no es Responsable Inscripto.
- **Datos que envía:**
  - concepto «Servicios», con el período facturado y la fecha de vencimiento;
  - la **condición frente al IVA del receptor** (`CondicionIVAReceptorId`), obligatoria según la RG 5616;
  - el detalle del IVA.
- **Al autorizarse:** guarda el CAE, su vencimiento y el **código QR** del comprobante.

Configuración, una sola vez, con la clave fiscal de PARALLAX:

1. Generar la clave y el pedido de certificado:
   `openssl genrsa -out parallax.key 2048`
   `openssl req -new -key parallax.key -subj "/C=AR/O=PARALLAX/CN=parallax/serialNumber=CUIT 30XXXXXXXXX" -out parallax.csr`
2. En ARCA, ir a **Administración de Certificados Digitales**: subir el CSR y descargar el certificado (`.crt`).
3. En el **Administrador de Relaciones de Clave Fiscal**, asociar el certificado al servicio **wsfe**.
4. Crear un **punto de venta** del tipo *Factura Electrónica · Web Services*.
5. Iniciar el servidor con `ARCA_CUIT`, `ARCA_CERT`, `ARCA_KEY` y `ARCA_PUNTO_VENTA`. Primero se prueba en homologación, con el certificado de testing. Después se pasa a producción con `ARCA_PRODUCCION=1`.

El servidor necesita `openssl` instalado. Sin servidor (demo), el botón **simula** el comprobante: muestra los datos que se enviarían, pero no pide CAE y no tiene validez.

## Área de Miembros

Cada miembro ingresa con el usuario y la contraseña que le genera la administración desde su legajo. Al ingresar ve:

- **Mi membresía:** credencial digital con su número de cliente, si está en el espacio y qué tiene que devolver, su contrato, lo que incluye su abono, cuánto le queda del mes y el estimado del mes.
- **Consumos:** lo que usó en cada período, con lo incluido y los excedentes.
- **Resúmenes:** los resúmenes de gastos emitidos.
- **Documentos:** su contrato firmado y la documentación compartida.
- **Solicitudes:** pedidos a recepción, que llegan al panel.
- **Mis datos:** su legajo; puede actualizar su teléfono y su email, y cambiar su contraseña.

## Marco legal (Argentina) · revisalo con tu asesor legal y tu contador

| Tema | Norma | Qué implica para PARALLAX |
|---|---|---|
| Firma electrónica y digital | Ley 25.506 y Decreto 182/2019 | La firma del Área de Miembros es **firma electrónica** (art. 5). Es válida, pero si alguien la desconoce, quien la invoca debe probarla; por eso se guardan la huella, la IP, el dispositivo y el registro de eventos. La **firma digital** (art. 2), con certificado de un certificador licenciado, tiene presunción de autoría e integridad. |
| Forma y prueba de los contratos | Código Civil y Comercial, arts. 284 a 288 y 319 | Hay libertad de formas. El art. 288 exige firma digital para tener por cumplida la firma en instrumentos electrónicos; la doctrina discute si alcanza la firma electrónica. La recomendación es: firma electrónica para la operación diaria y firma digital (o firma en papel) para los contratos de mayor monto o duración. |
| Contrato de servicios | CCyC, arts. 1251 y siguientes | El contrato es de locación de servicios entre partes independientes. |
| Mora e intereses | CCyC, arts. 768, 771, 886 y 903 | La mora es automática al vencer el plazo. Los intereses punitorios pactados pueden ser reducidos por un juez si son excesivos. Los pagos se imputan primero a intereses. |
| Datos personales | Ley 25.326 | Los legajos (DNI, fecha de nacimiento, etc.) se usan solo para el contrato. Hay que informar a los titulares sus derechos y consultar con la AAIP si corresponde inscribir la base. |
| Factura electrónica | RG 4291, RG 5616 y normas de ARCA | Se emite factura electrónica con CAE y código QR, informando la condición frente al IVA del receptor. |

El texto del contrato que genera el sistema es un **modelo**: revisalo y adaptalo con tu abogado antes de usarlo.

## Cuentas principales

Las tres unidades de negocio que operan en el espacio vienen precargadas en la demostración:

- **Celius Salud** · Balro S.A.
- **Nivel Salud** · Care Salud S.A.
- **M&C Salud** · razón social a confirmar

El CUIT y los datos del titular quedan **pendientes de carga**, para no inventar información legal; el panel los señala. Con el servidor, la base arranca vacía: solo trae la configuración y las modalidades de abono. El inventario de ejemplo se carga con un clic desde *Inventario*.

## Naturaleza del vínculo

Todo el sistema refleja una relación **estrictamente comercial** de locación de servicios:

- PARALLAX es el prestador y cada cliente es un locatario.
- Las personas que ingresan son *personas autorizadas* que designa cada cliente.
- La planilla de check-in registra el uso de las instalaciones y de los recursos prestados.
- Cada cliente organiza su actividad con plena autonomía.

## Estructura

```
index.html · ingresar.html · miembros.html · gestoria.html
server/server.js             Servidor (Node.js, sin dependencias)
server/arca.js               Factura electrónica ARCA (WSAA + WSFEv1)
assets/css/                  base, landing, panel, miembros
assets/js/core/
  util.js                    Formatos es-AR, fechas, edad, CSV, validación de CUIT
  store.js                   Capa de datos (operaciones locales o hacia el servidor)
  backend.js                 Modo servidor/demostración, sesión, usuarios, archivos
  scope.js                   Qué datos ve cada miembro (lo usan navegador y servidor)
  reglas.js                  SHA-256, contrato y firma, reservas, cuenta corriente, factura
  agenda.js                  Calendario semanal de salas
  firma-vista.js             Constancia de firma (panel y Área de Miembros)
  billing.js                 Resumen de gastos: abonos, incluidos, excedentes, IVA
  seed.js                    Datos de demostración e inventario de ejemplo
  icons.js                   Íconos SVG
assets/js/landing.js · login.js · miembros.js
assets/js/panel/             Panel: interfaz, ayudantes, enrutador y módulos (views/)
scripts/verificar-terminologia.sh
```

## Identidad visual

- Fondo oscuro con textura metálica.
- Acentos neón **cyan** `#3FE6F5` y **magenta** `#E04CF0`, tomados del logo.
- Tipografías *Michroma* (títulos), *Exo 2* (texto) y *JetBrains Mono* (cifras y códigos).

## Reglas de terminología

Para la administración y el soporte corporativo se usa **siempre** «Asesoría» o «Gestoría». Hay términos restringidos que no pueden aparecer en el código, los datos ni la interfaz. Para comprobarlo:

```bash
bash scripts/verificar-terminologia.sh   # o: npm run verificar
```

El script revisa:

- los términos restringidos (guardados codificados, así el repositorio no los contiene);
- el vocabulario propio de una relación laboral.

También corre de forma automática en cada push mediante GitHub Actions.
