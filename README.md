# PARALLAX · Coworking corporativo

Aplicación web de PARALLAX, coworking de alto nivel dedicado a la provisión de infraestructura y servicios compartidos corporativos. Tiene dos interfaces:

| Interfaz | Archivo | Para quién |
|---|---|---|
| **Sitio público** (landing de captación) | `index.html` | Personas y profesionales que todavía no conocen el coworking |
| **Panel de Gestoría** (módulo interno) | `gestoria.html` | Equipo de PARALLAX que administra contratos, accesos, consumos y resúmenes de gastos |

Está hecha con HTML, CSS y JavaScript, sin dependencias ni proceso de compilación.

## Cómo abrirla

- **Rápido:** abrí `index.html` con doble clic en el navegador.
- **Recomendado:** levantá un servidor local en la carpeta del proyecto y entrá a `http://localhost:8000`:

  ```bash
  python3 -m http.server 8000
  ```

El panel se abre desde el enlace «Acceso Gestoría» del sitio o directamente en `gestoria.html`.

## Sitio público

- **Hero** con el logo y capas geométricas que se desplazan con distinta profundidad según el puntero y el scroll (efecto parallax), sobre un campo de partículas.
- **Quiénes somos:** presentación del espacio, una comparación «oficina tradicional vs. PARALLAX» para quien no conoce el coworking y los pasos para empezar.
- **Servicios:** infraestructura, servicios compartidos y un bloque destacado de **Asesoría y Gestoría**.
- **Membresías:** modalidades de abono. Cada botón «Consultar» preselecciona el interés en el formulario.
- **Contacto:** formulario validado con protección anti‑spam. Cada consulta llega a la bandeja **Consultas del sitio** del panel.

Los datos de contacto visibles (email, teléfono, dirección, horario) y la URL de un servicio propio para recibir consultas se configuran en `SITE_CONFIG`, al inicio de `assets/js/landing.js`. Los campos que quedan vacíos no se muestran.

## Panel de Gestoría

| Módulo | Qué resuelve |
|---|---|
| **Inicio** | Indicadores del mes, gastos por locatario, ingresos de los últimos 14 días, personas en el espacio, vencimientos y datos pendientes |
| **Gestoría de Contratos** | Contratos de locación de servicios (Abonos de Membresía), alta y edición de locatarios, modalidades de abono |
| **Control de Accesos** | Lector de credenciales (alterna ingreso y egreso), personas en el espacio, historial filtrable y exportable, personas autorizadas por cada locatario |
| **Gestoría de Consumos** | Registro de utilería, mobiliario, papelería, otros insumos y servicios adicionales por locatario; catálogo con precios |
| **Gastos y Facturación** | Consolidado mensual por locatario (abonos con prorrateo, consumos por categoría, IVA, total), emisión de resúmenes numerados, impresión o PDF, exportación CSV y JSON |
| **Consultas del sitio** | Bandeja de consultas recibidas; con un clic, una consulta se convierte en locatario |
| **Configuración** | Datos del prestador, alícuota de IVA, prorrateo, plan de cuentas, respaldo y restauración |

### Cuentas principales

Vienen precargadas las tres unidades de negocio que operan en el espacio:

- **Celius Salud** · razón social Balro S.A.
- **Nivel Salud** · razón social Care Salud S.A.
- **M&C Salud** · razón social a confirmar

El CUIT y los datos de contacto quedan **pendientes de carga** (el panel los señala), para no inventar información legal. Los montos, las personas autorizadas, los accesos y los consumos de la demostración son ilustrativos. Desde **Configuración → Comenzar sin datos de demostración** se vacía la base y se conservan las modalidades, el catálogo de insumos y la configuración.

### Naturaleza del vínculo

Todo el sistema refleja una relación **estrictamente comercial** de locación de servicios:

- PARALLAX es el *prestador* y cada empresa o profesional es un *locatario*.
- Las personas que ingresan son *personas autorizadas* que designa cada locatario.
- El registro de accesos existe para la seguridad de las instalaciones y para imputar el uso de la infraestructura. Cada locatario organiza su actividad con plena autonomía.

## Resumen de gastos e integración contable

- **Abonos:** si un contrato empieza o termina dentro del mes, el abono se prorratea por días (se puede desactivar).
- **Consumos:** se agrupan por insumo y precio. Cada registro guarda el precio vigente al momento de cargarlo.
- **Emisión:** congela una copia del resumen con número `RG-AAAAMM-NNNN`. Si después cambian los consumos, el resumen se marca como *Desactualizado* y se puede re-emitir conservando el número.
- **CSV contable:** separador `;`, coma decimal y BOM UTF‑8 (abre directo en planillas configuradas en español). Tiene una línea por concepto con estas columnas: período, número, CUIT, razón social, condición frente al IVA, cuenta contable, categoría, concepto, cantidad, precio unitario, neto, alícuota, IVA y total.
- **JSON** (`parallax.resumen-gastos.v1`): la estructura completa de cada resumen, pensada para importarla de forma automática.
- El resumen consolida abonos y consumos, pero **no reemplaza la factura electrónica**.

Plan de cuentas por defecto (se edita en Configuración): `4.1.01` Abonos de Membresía · `4.1.02` Utilería · `4.1.03` Mobiliario · `4.1.04` Papelería · `4.1.05` Otros insumos · `4.1.06` Servicios adicionales.

## Datos y puesta en producción

Esta versión guarda la información en el **almacenamiento local del navegador** (`localStorage`). Por eso:

- cada navegador o equipo tiene su propia base, y
- el panel **no tiene autenticación**.

Para operar con varios usuarios, la capa de datos (`assets/js/core/store.js`) está aislada: alcanza con reemplazar sus funciones `read()` y `persist()` por llamadas a una API propia con inicio de sesión. El resto del sistema usa solo los métodos públicos de `store`. Mientras tanto, Configuración permite descargar y restaurar respaldos JSON.

## Estructura

```
index.html                   Sitio público
gestoria.html                Panel de Gestoría
assets/
  css/base.css               Sistema visual (colores, tipografías, componentes)
  css/landing.css            Estilos del sitio público
  css/panel.css              Estilos del panel e impresión del resumen
  img/                       Logo (emblema y wordmark), favicon, imagen para redes
  js/core/util.js            Formatos es-AR, fechas, CSV, validación de CUIT
  js/core/icons.js           Íconos SVG
  js/core/store.js           Capa de datos y constantes del dominio
  js/core/billing.js         Motor de resumen de gastos y exportación contable
  js/core/seed.js            Datos de demostración
  js/landing.js              Interacción del sitio público
  js/panel/                  Panel: interfaz, ayudantes, enrutador y módulos (views/)
scripts/verificar-terminologia.sh
```

## Identidad visual

- Fondo oscuro con textura metálica cepillada.
- Acentos neón **cyan** `#3FE6F5` y **magenta** `#E04CF0`, tomados del logo.
- Tipografías: *Michroma* para títulos (geométrica y ancha, en línea con el wordmark), *Exo 2* para el texto y *JetBrains Mono* para cifras y códigos.
- En los gráficos se usan variantes más profundas (`#14A3B8` y `#C944E0`), validadas para contraste y daltonismo sobre el fondo oscuro.

## Reglas de terminología

En la administración y el soporte corporativo se usa **siempre** «Asesoría» o «Gestoría». Hay términos restringidos que no pueden aparecer en ninguna parte del código, la base de datos ni la interfaz. Para comprobarlo:

```bash
bash scripts/verificar-terminologia.sh
```

El script revisa:

- los términos restringidos (guardados codificados, para que el repositorio no los contenga), y
- vocabulario propio de una relación laboral, que no corresponde a un vínculo comercial.

También corre de forma automática en cada push mediante GitHub Actions.
