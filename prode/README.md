# ⚽ PRODE Amigos

PRODE del fútbol argentino para jugar entre amigos con **fichas ficticias** (sin plata real).
Es una **app web instalable (PWA)**: se agrega a la pantalla de inicio de Android y iPhone y se ve como una app,
**sin publicarla en ninguna tienda** y sin cuenta de desarrollador.

## Cómo se juega
- **Pronóstico (PRODE clásico):** ponés el resultado. Exacto = **3 puntos**, acertar ganador/empate = **1 punto**.
- **Apuesta ficticia:** elegís Local / Empate / Visitante y apostás fichas (todos arrancan con 1000).
  Las fichas de todos forman un **pozo** que se reparte entre quienes acertaron, según cuánto puso cada uno.
  Si nadie acierta (o se suspende el partido) se devuelven las fichas.
- Todo se **cierra cuando arranca el partido**; ahí se ven las jugadas de los demás.
- Hay dos rankings: por **fichas** y por **puntos del PRODE**.

## Torneos y fixture automático
El servidor consulta [TheSportsDB](https://www.thesportsdb.com) y detecta solo los torneos argentinos
(Liga Profesional, Primera Nacional, Copa Argentina, Supercopa, Trofeo de Campeones…) y los sudamericanos
(Libertadores, Sudamericana, Recopa). Los principales quedan activados; el admin prende/apaga el resto.
- Resultados: se actualizan solos cada 10 min. Fixture: cada 6 h. Torneos nuevos: una vez por día.
- Si arranca un torneo nuevo, aparece solo. Desde **Admin → Actualizar fixture** se fuerza al instante.
- Fallback manual: el admin puede crear torneos/partidos y cargar resultados a mano.
- ⚠️ La clave gratuita de TheSportsDB limita cuántos partidos devuelve por torneo. Si ves fixtures incompletos,
  usá una clave paga (`THESPORTSDB_KEY`, unos USD 9/mes, la paga uno solo del grupo).
  **Esta integración no pudo probarse contra la API real al desarrollarla** (sin acceso a internet): revisá la primera sincronización.

## Probarla ya (con partidos de mentira)
```bash
cd prode
npm run demo          # http://localhost:3000  — código de grupo: se imprime en consola
npm test
```
Requiere Node 22.13+. No tiene dependencias. El **primer usuario que se registra es el administrador**.

## Ponerla online para los amigos
Hace falta un lugar donde corra el servidor con **HTTPS** (iPhone lo exige para instalarla) y un disco que no se borre.
- **Fly.io / Railway / Render (con disco persistente):** usá el `Dockerfile`, montá un volumen en `/data`.
  Variables: `PRODE_CODE=<código que elijas>`, opcional `THESPORTSDB_KEY`.
- **Gratis en tu casa:** `npm start` en una PC/Raspberry prendida + [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) para tener HTTPS.
- ⚠️ En planes gratuitos *sin* disco persistente la base se borra al reiniciar: no sirven.

Después, cada amigo abre el link y:
- **iPhone (Safari):** Compartir → *Agregar a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar app* / *Agregar a pantalla principal*.

Se registran con nombre + PIN + el código del grupo.

## Variables de entorno
| Variable | Para qué | Por defecto |
|---|---|---|
| `PRODE_CODE` | Código de grupo para crear cuenta | se genera y se imprime |
| `PRODE_START_COINS` | Fichas iniciales | 1000 |
| `THESPORTSDB_KEY` | Clave paga de TheSportsDB | clave gratuita |
| `PRODE_DB` | Ruta de la base SQLite | `data/prode.db` |
| `PORT` | Puerto | 3000 |

## Estructura
`server/` API + sincronización + reglas (`scoring.js`, `settle.js`) · `public/` la app (HTML/CSS/JS sin build) · `test/`.
