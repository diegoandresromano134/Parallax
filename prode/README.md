# ⚽ PRODE Amigos

PRODE del fútbol argentino para jugar entre amigos con **fichas ficticias** (sin plata real).
Es una **app web instalable (PWA)**: se agrega a la pantalla de inicio de Android y iPhone y se ve como una app,
**sin publicarla en ninguna tienda** y sin cuenta de desarrollador.

## Administrador y fichas
- **Hay un solo admin:** la cuenta de `PRODE_ADMIN_EMAIL`, creada por el servidor con `PRODE_ADMIN_PASSWORD`.
  Nadie puede registrarse con ese mail ni con un apodo que empiece con "admin". Es el único que ve la pestaña **Admin**:
  pedidos de fichas, carga directa, clave de la suscripción de datos, torneos, partidos y resultados a mano, usuarios y movimientos.
  Sin esas variables (solo para probar en tu compu) el primer usuario registrado queda como admin: **no publiques la app sin configurarlas**.
- **Fichas:** nadie arranca con fichas. Cada jugador pide fichas desde la pestaña Grupo (cantidad y mensaje) y el admin las carga o rechaza;
  el jugador recibe un aviso. Sin fichas se puede pronosticar y sumar puntos, pero no apostar. Todos los movimientos quedan registrados.
- **Suscripción de datos:** pegá la clave en Admin → Fuente de datos y tocá *Probar conexión*. No hace falta tocar el servidor.

## Cuentas y grupos
- **Ingreso obligatorio:** sin cuenta no se puede ver ni jugar nada.
- **Registro:** nombre, apellido, apodo, mail, fecha de nacimiento, contraseña (8+ con letras y números) y aceptar las reglas. **Solo mayores de 16**: se calcula con la fecha de nacimiento y se valida en el servidor.
  La edad es declarada, la app no puede verificarla. El mail no se verifica por correo (no hay servicio de mail configurado).
- **Olvidé mi contraseña:** quien creó el grupo (o el admin) le pone una clave temporal (pestaña Grupo → Clave). El creador del grupo solo maneja nombre, color, código y claves de su grupo, no las fichas.
- **Varios grupos:** cada grupo tiene su código/link, sus fichas, su pozo, su ranking y sus comentarios. Se puede estar en varios.
- **Perfil:** foto, color, equipo favorito, cambio de contraseña y avisos en el celular.
- Ranking general o filtrado por **torneo y fecha** (para saber quién ganó la semana), tabla de posiciones y comentarios por partido.
- **Avisos (Web Push):** 90 min antes del cierre si no jugaste, y cuando termina un partido. En iPhone solo con la app instalada (iOS 16.4+). Usa claves VAPID que el servidor genera solo; `PRODE_PUSH_SUBJECT` = `mailto:tu@mail` recomendado. **No pude probarlo contra Apple/Google desde acá.**

## Cómo se juega (todos los torneos igual)
- **Sin fichas no se juega nada.** Para pronosticar los partidos de una fecha o ronda hay que anotarse **antes de que empiece**, pagando la inscripción en fichas
  (100 por defecto, editable por torneo en Admin). Si no alcanzan las fichas, no hay inscripción y no se puede pronosticar.
- **Pozo por fecha:** las inscripciones forman el pozo. Cuando terminan todos los partidos de la fecha, se lo lleva quien sumó más puntos
  (3 por resultado exacto, 1 por ganador o empate). Desempata quien tuvo más exactos y luego quien erró menos goles (un partido sin pronóstico cuenta como error grande).
  Si siguen empatados, se reparte. Si una fecha se suspende entera, se devuelven las inscripciones.
- **Copas** (Libertadores, Sudamericana, Copa Argentina, Recopa, Supercopa) funcionan igual por ronda y suman un **pozo de campeonato** (300 por defecto) que se reparte al final
  entre quienes acumularon más puntos. Solo cuentan los partidos que empiezan después de anotarse. **Lo cierra el admin** (Admin → Premios en juego → Cerrar y repartir).
- Si la fuente no informa la fecha de un partido, ese partido es su propia fecha.
- Una fecha trabada (por ejemplo, un partido postergado) la cierra el admin a mano.
- **Canje:** las fichas se canjean por premios que define el admin (Admin → Premios para canjear: nombre, descripción y costo). El jugador canjea desde la pestaña Grupo,
  las fichas se descuentan, y el admin marca la entrega o rechaza (y se devuelven). Los canjes pendientes suman al globito rojo del panel.
- ⚠️ **Importante:** mientras las fichas solo las carga el admin gratis (a pedido), esto es un juego entre amigos. Si alguna vez se **cobran** fichas con dinero real
  y se entregan premios de valor, pasa a ser un juego de azar/apuestas, que en Argentina está regulado. No lo hagas sin asesoramiento.
- Ranking → **Premios** muestra los pozos abiertos, quién va ganando y quién se llevó cada uno.

## Cuentas y grupos
- **Ingreso obligatorio:** sin cuenta no se puede ver ni jugar nada.
- **Registro:** nombre, apellido, apodo, mail, fecha de nacimiento, contraseña (8+ con letras y números) y aceptar las reglas. **Solo mayores de 16**: se calcula con la fecha de nacimiento y se valida en el servidor.
  La edad es declarada, la app no puede verificarla. El mail no se verifica por correo (no hay servicio de mail configurado).
- **Olvidé mi contraseña:** quien creó el grupo (o el admin) le pone una clave temporal (pestaña Grupo → Clave). El creador del grupo solo maneja nombre, color, código y claves de su grupo, no las fichas.
- **Varios grupos:** cada grupo tiene su código/link, sus fichas, su pozo, su ranking y sus comentarios. Se puede estar en varios.
- **Perfil:** foto, color, equipo favorito, cambio de contraseña y avisos en el celular.
- Ranking general o filtrado por **torneo y fecha** (para saber quién ganó la semana), tabla de posiciones y comentarios por partido.
- **Avisos (Web Push):** 90 min antes del cierre si no jugaste, y cuando termina un partido. En iPhone solo con la app instalada (iOS 16.4+). Usa claves VAPID que el servidor genera solo; `PRODE_PUSH_SUBJECT` = `mailto:tu@mail` recomendado. **No pude probarlo contra Apple/Google desde acá.**

## Premios: ligas por fecha, copas por partido y campeonato
- **Ligas** (Liga Profesional, Primera Nacional…): se juega por **fecha**. Los jugadores se anotan al pozo de la fecha pagando una inscripción en fichas
  (100 por defecto) **antes de que empiece la fecha**. Cuando terminan todos sus partidos gana quien suma más puntos; desempata quien tuvo más resultados
  exactos y luego quien erró menos goles (un partido sin pronóstico cuenta como error grande). Si siguen empatados, se reparte. En ligas no hay apuesta por partido.
- **Copas** (Libertadores, Sudamericana, Copa Argentina, Recopa, Supercopa): premio **por partido** con el pozo de apuestas (Local/Empate/Visitante), y además un
  **pozo del campeonato** (300 por defecto) que se reparte al final entre quienes acumularon más puntos. Solo cuentan los partidos que empiezan después de anotarse.
  **Lo cierra el admin** (Admin → Premios en juego → Cerrar y repartir) cuando termina el torneo; no se cierra solo porque las copas cargan sus fases de a poco.
- El tipo de torneo se detecta por el nombre y se cambia en Admin → Torneos → Premios de este torneo, donde también se editan las inscripciones (0 = sin pozo).
- Una fecha trabada (por ejemplo, un partido postergado) se cierra a mano desde el panel. Una fecha suspendida entera devuelve las inscripciones.
- Ranking → **Premios** muestra los pozos abiertos, quién va ganando y quién se llevó cada uno.

## Torneos y fixture automático
El servidor consulta [TheSportsDB](https://www.thesportsdb.com) y detecta solo los torneos argentinos
(Liga Profesional, Primera Nacional, Copa Argentina, Supercopa, Trofeo de Campeones…) y los sudamericanos
(Libertadores, Sudamericana, Recopa). Los principales quedan activados; el admin prende/apaga el resto.
- Resultados: se actualizan solos cada 10 min. Fixture: cada 6 h. Torneos nuevos: una vez por día.
- Si arranca un torneo nuevo, aparece solo. Desde **Admin → Actualizar fixture** se fuerza al instante.
- Fallback manual: el admin puede crear torneos/partidos y cargar resultados a mano.
- ⚠️ La clave gratuita de TheSportsDB limita cuántos partidos devuelve por torneo. Si ves fixtures incompletos,
  suscribite a TheSportsDB Premium (≈ USD 9/mes) y cargá la clave en Admin → Fuente de datos.
  La tabla de posiciones usa la oficial si la fuente la trae; si no, se calcula con los resultados cargados. Goleadores: no hay fuente gratuita incluida.
  **Esta integración no pudo probarse contra la API real al desarrollarla** (sin acceso a internet): revisá la primera sincronización.

## Probarla ya (con partidos de mentira)
```bash
cd prode
npm run demo          # http://localhost:3000  — código de grupo: se imprime en consola
npm test
```
Requiere Node 22.13+. No tiene dependencias. El **primer usuario que se registra es el administrador general** (torneos y fixture); cada grupo lo maneja quien lo creó.

## Ponerla online para los amigos
Hace falta un lugar donde corra el servidor con **HTTPS** (iPhone lo exige para instalarla) y un disco que no se borre.
- **Fly.io / Railway / Render (con disco persistente):** usá el `Dockerfile`, montá un volumen en `/data`.
  Variables: `PRODE_ADMIN_EMAIL`, `PRODE_ADMIN_PASSWORD` y, recomendado, `PRODE_PUSH_SUBJECT`.
- **Gratis en tu casa:** `npm start` en una PC/Raspberry prendida + [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) para tener HTTPS.
- ⚠️ En planes gratuitos *sin* disco persistente la base se borra al reiniciar: no sirven.

Después, cada amigo abre el link y:
- **iPhone (Safari):** Compartir → *Agregar a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar app* / *Agregar a pantalla principal*.

Se registran con su mail y datos; el código de grupo es opcional al registrarse.

## Variables de entorno
| Variable | Para qué | Por defecto |
|---|---|---|
| `PRODE_PUSH_SUBJECT` | Contacto para los avisos (`mailto:...`) | `mailto:admin@prode.local` |
| `PRODE_ADMIN_EMAIL` / `PRODE_ADMIN_PASSWORD` | Cuenta del único administrador (obligatorias al publicar) | — |
| `PRODE_START_COINS` | Fichas iniciales (normalmente 0) | 0 |
| `THESPORTSDB_KEY` | Clave de TheSportsDB (mejor cargarla desde el panel Admin) | clave gratuita |
| `PRODE_DB` | Ruta de la base SQLite | `data/prode.db` |
| `PORT` | Puerto | 3000 |

## Estructura
`server/` API + sincronización + reglas (`scoring.js`, `settle.js`) · `public/` la app (HTML/CSS/JS sin build) · `test/`.
