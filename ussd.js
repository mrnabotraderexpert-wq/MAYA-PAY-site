import { CONFIG } from './config.js';

export const operatorLabel = (id) => CONFIG.operators.find((o) => o.id === id)?.label ?? '';

// Le '#' doit être encodé dans un lien tel: pour que le composeur ne le tronque pas.
// Le code ne contient que 0-9, * et # : tout autre caractère est refusé.
export function toTelUri(code) {
  if (!/^[0-9*#]+$/.test(String(code))) throw new Error('Code USSD invalide.');
  return 'tel:' + code.replace(/#/g, '%23');
}

// MAYA-PAY est réservé au téléphone (paiement mobile).
export const isLikelyMobile = () =>
  /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820);
