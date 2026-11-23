// Reglas puras del juego (sin base de datos), fáciles de testear.

// Las fichas las carga solo el administrador, por pedido. Nadie arranca con fichas.
export const START_COINS = Number(process.env.PRODE_START_COINS || 0);
export const MIN_STAKE = 10;

/** 'L' gana local, 'E' empate, 'V' gana visitante */
export function outcome(h, a) {
  return h > a ? 'L' : h < a ? 'V' : 'E';
}

/** PRODE clásico: resultado exacto = 3 pts, acertar ganador/empate = 1 pt. */
export function predictionPoints(pred, real) {
  if (pred.home === real.home && pred.away === real.away) return 3;
  return outcome(pred.home, pred.away) === outcome(real.home, real.away) ? 1 : 0;
}

/**
 * Apuesta ficticia a pozo común (pari-mutuel): todas las fichas apostadas en el
 * partido forman un pozo y se reparten entre quienes acertaron, en proporción a
 * lo que apostó cada uno. Si nadie acertó, se devuelve todo.
 * bets: [{user_id, pick, stake}] → Map(user_id → fichas que recibe)
 */
export function settleBets(bets, real) {
  const result = outcome(real.home, real.away);
  const pool = bets.reduce((s, b) => s + b.stake, 0);
  const winners = bets.filter((b) => b.pick === result);
  const winStake = winners.reduce((s, b) => s + b.stake, 0);
  const out = new Map();
  for (const b of bets) {
    if (winStake === 0) out.set(b.user_id, b.stake); // nadie acertó: devolución
    else out.set(b.user_id, b.pick === result ? Math.floor((b.stake / winStake) * pool) : 0);
  }
  return out;
}
