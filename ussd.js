import { CONFIG } from './config.js';

const U = CONFIG.ussd;

export const cauuRequired = () => U.transferTemplate.includes('{CAUU}');
export const cauuValid = (c) => U.cauuPattern.test(String(c ?? ''));

// Construit le code USSD final. Chaque valeur injectée est strictement numérique,
// ce qui empêche d'insérer des '*' ou '#' supplémentaires.
export function buildTransferCode({ number, amount, cauu }) {
  const num = String(number);
  const amt = String(amount);
  if (!/^\d+$/.test(num) || !/^\d+$/.test(amt)) throw new Error('Numéro ou montant invalide.');
  if (cauuRequired() && !cauuValid(cauu)) throw new Error('CAUU invalide.');
  const code = U.transferTemplate
    .replaceAll('{NUMERO}', num)
    .replaceAll('{MONTANT}', amt)
    .replaceAll('{CAUU}', String(cauu ?? ''));
  if (!/^[0-9*#]+$/.test(code)) throw new Error('Code USSD invalide.');
  return code;
}

// Le '#' doit être encodé dans un lien tel: pour que le composeur ne le tronque pas.
export const toTelUri = (code) => 'tel:' + code.replace(/#/g, '%23');

// Version affichable : le numéro du vendeur et le CAUU sont masqués par des puces (construit depuis le gabarit,
// pas par recherche dans le code final, car le CAUU peut ressembler à une partie du numéro).
export function displayCode({ number, amount, cauu }) {
  buildTransferCode({ number, amount, cauu });
  const n = String(number);
  const maskedNumber = n.slice(0, 2) + '\u2022'.repeat(Math.max(n.length - 4, 0)) + n.slice(-2);
  return U.transferTemplate
    .replaceAll('{NUMERO}', maskedNumber)
    .replaceAll('{MONTANT}', String(amount))
    .replaceAll('{CAUU}', '\u2022'.repeat(String(cauu ?? '').length));
}

export const isLikelyMobile = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
