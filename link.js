import { CONFIG } from './config.js';

// Le lien contient les données du paiement dans le fragment (#...), encodées en
// base64url. Le fragment n'est jamais envoyé à un serveur. Ce n'est PAS un secret :
// toute personne qui possède le lien peut décoder le numéro du vendeur.

const toB64Url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64Url = (s) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

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
  const p = normalizeNumber(input.p);
  const h = Number(input.h);
  const raw = String(input.a ?? '').replace(/[\s\u00a0\u202f.,]/g, '');
  const a = /^\d+$/.test(raw) ? Number(raw) : NaN;

  if (!n) errors.n = 'Saisissez votre nom commercial.';
  else if (n.length > CONFIG.limits.name) errors.n = `${CONFIG.limits.name} caractères maximum.`;

  const { min, max } = CONFIG.numberDigits;
  if (!p) errors.p = 'Saisissez votre numéro Orange Money.';
  else if (p.length < min || p.length > max) errors.p = `Le numéro doit contenir ${min === max ? min : `${min} à ${max}`} chiffres.`;

  if (!Number.isInteger(a)) errors.a = 'Saisissez un montant en chiffres.';
  else if (a < CONFIG.amount.min) errors.a = 'Le montant doit être supérieur à 0.';
  else if (a > CONFIG.amount.max) errors.a = `Le montant maximum est ${formatAmount(CONFIG.amount.max)} ${CONFIG.currency}.`;

  if (input.h !== undefined && !CONFIG.validity.options.some((o) => o.hours === h)) errors.h = 'Choisissez une durée de validité.';

  if (d.length > CONFIG.limits.description) errors.d = `${CONFIG.limits.description} caractères maximum.`;

  return { ok: Object.keys(errors).length === 0, errors, value: { n, p, a, d, h: Number.isFinite(h) && input.h !== undefined ? h : undefined } };
}

export const encodePayment = (v) => toB64Url(JSON.stringify({ v: 1, n: v.n, p: v.p, a: v.a, d: v.d, e: v.e }));

// Décode et revalide : un lien modifié ou corrompu retourne null.
export function decodePayment(encoded) {
  try {
    if (!encoded || encoded.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const o = JSON.parse(fromB64Url(encoded));
    if (!o || o.v !== 1) return null;
    if (o.e !== undefined && !(Number(o.e) * 1000 > Date.now())) return null; // lien expiré
    const r = validatePayment({ n: o.n, p: o.p, a: o.a, d: o.d });
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

// Mode sans serveur : l'expiration est inscrite dans le lien (secondes Unix).
export const buildLink = (value, baseUrl) => {
  const e = value.h ? Math.floor(Date.now() / 1000) + value.h * 3600 : undefined;
  return `${baseUrl}#/pay?d=${encodePayment({ ...value, e })}`;
};

export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const i = h.indexOf('?');
  return { path: i < 0 ? h : h.slice(0, i), params: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) };
}
