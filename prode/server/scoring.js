// Reglas puras del juego (sin base de datos), fáciles de testear.

// Las fichas las carga solo el administrador, por pedido. Nadie arranca con fichas.
export const START_COINS = Number(process.env.PRODE_START_COINS || 0);

/** 'L' gana local, 'E' empate, 'V' gana visitante */
export function outcome(h, a) {
  return h > a ? 'L' : h < a ? 'V' : 'E';
}

/** 🟢 1 punto si acertó quién gana (o el empate). */
export const pickPoints = (pick, real) => (pick && pick === outcome(real.home, real.away) ? 1 : 0);
/** 🔴 1 si acertó el marcador exacto. */
export const isExact = (pred, real) => pred.home === real.home && pred.away === real.away;
