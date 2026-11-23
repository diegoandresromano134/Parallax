// Validaciones de datos de cuenta (puras, testeables).
export const MIN_AGE = 16;

export function ageOn(birth, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || '');
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // fecha inexistente
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age--;
  return age;
}

export function validateAccount(b, today = new Date()) {
  const clean = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const out = {
    email: clean(b.email, 120).toLowerCase(), first_name: clean(b.first_name, 40), last_name: clean(b.last_name, 40),
    nick: clean(b.nick, 20), birth_date: clean(b.birth_date, 10), fav_team: clean(b.fav_team, 40) || null,
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(out.email)) return { error: 'Ingresá un mail válido' };
  if (out.first_name.length < 2 || out.last_name.length < 2) return { error: 'Completá tu nombre y apellido' };
  if (out.nick.length < 2) return { error: 'El apodo debe tener entre 2 y 20 letras' };
  const age = ageOn(out.birth_date, today);
  if (age === null) return { error: 'Ingresá una fecha de nacimiento válida' };
  if (age < MIN_AGE) return { error: `Tenés que tener al menos ${MIN_AGE} años para jugar` };
  if (age > 110) return { error: 'Revisá tu fecha de nacimiento' };
  return { value: out };
}

export const validPassword = (p) =>
  typeof p === 'string' && p.length >= 8 && p.length <= 100 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const PASSWORD_MSG = 'La contraseña debe tener al menos 8 caracteres, con letras y números';

export function validAvatar(a) {
  return a === null || a === '' || (typeof a === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length <= 80_000);
}
