import { CONFIG } from './config.js';

export function normalizeNumber(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  const cc = CONFIG.countryCode;
  if (d.startsWith('00' + cc)) d = d.slice(2 + cc.length);
  else if (cc && d.startsWith(cc) && d.length > CONFIG.numberDigits.max) d = d.slice(cc.length);
  return d;
}

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export const formatAmount = (a) => new Intl.NumberFormat('fr-FR').format(a).replace(/\u202f|\u00a0/g, ' ');

// Valide et normalise un paiement. Retourne { ok, errors, value }.
export function validatePayment(input) {
  const errors = {};
  const n = clean(input.n);
  const d = clean(input.d);
  const po = normalizeNumber(input.po);
  const pm = normalizeNumber(input.pm);
  const h = Number(input.h);
  const raw = String(input.a ?? '').replace(/[\s\u00a0\u202f.,]/g, '');
  const a = /^\d+$/.test(raw) ? Number(raw) : NaN;

  if (!n) errors.n = 'Saisissez votre nom commercial.';
  else if (n.length > CONFIG.limits.name) errors.n = `${CONFIG.limits.name} caractères maximum.`;

  const { min, max } = CONFIG.numberDigits;
  const badLen = (x) => x.length < min || x.length > max;
  const lenMsg = `Le numéro doit contenir ${min === max ? min : `${min} à ${max}`} chiffres.`;
  if (!po && !pm) errors.po = 'Saisissez au moins un numéro (Orange Money ou Moov Money).';
  else {
    if (po && badLen(po)) errors.po = lenMsg;
    if (pm && badLen(pm)) errors.pm = lenMsg;
  }

  if (!Number.isInteger(a)) errors.a = 'Saisissez un montant en chiffres.';
  else if (a < CONFIG.amount.min) errors.a = 'Le montant doit être supérieur à 0.';
  else if (a > CONFIG.amount.max) errors.a = `Le montant maximum est ${formatAmount(CONFIG.amount.max)} ${CONFIG.currency}.`;

  if (input.h !== undefined && !CONFIG.validity.options.some((o) => o.hours === h)) errors.h = 'Choisissez une durée de validité.';

  if (d.length > CONFIG.limits.description) errors.d = `${CONFIG.limits.description} caractères maximum.`;

  return { ok: Object.keys(errors).length === 0, errors, value: { n, po, pm, a, d, h: Number.isFinite(h) && input.h !== undefined ? h : undefined } };
}

export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const i = h.indexOf('?');
  return { path: i < 0 ? h : h.slice(0, i), params: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) };
}
