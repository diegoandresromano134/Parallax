// Reglas puras del juego (sin base de datos), fáciles de testear.

// Las fichas las carga solo el administrador, por pedido. Nadie arranca con fichas.
export const START_COINS = Number(process.env.PRODE_START_COINS || 0);

/** 'L' gana local, 'E' empate, 'V' gana visitante */
export function outcome(h, a) {
  return h > a ? 'L' : h < a ? 'V' : 'E';
}

/** PRODE clásico: resultado exacto = 3 pts, acertar ganador/empate = 1 pt. */
export function predictionPoints(pred, real) {
  if (pred.home === real.home && pred.away === real.away) return 3;
  return outcome(pred.home, pred.away) === outcome(real.home, real.away) ? 1 : 0;
}
