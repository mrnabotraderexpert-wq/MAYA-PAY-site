import { CONFIG } from './config.js';

export const serverReady = () => Boolean(CONFIG.supabase?.url && CONFIG.supabase?.key);
export const validId = (id) => /^[0-9a-f]{12}$/.test(String(id ?? ''));
export const validKey = (k) => /^[0-9a-f]{32}$/.test(String(k ?? ''));

// Appelle une fonction RPC. En cas d'erreur, le message de la base (ex. « rate_limited ») devient err.code.
async function rpc(fn, args) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${CONFIG.supabase.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CONFIG.supabase.key },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let code = 'http_' + res.status;
      try { code = (await res.json()).message || code; } catch { /* ignoré */ }
      throw Object.assign(new Error(code), { code });
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Un numéro par opérateur (au moins un) : le client ne voit que les opérateurs pour lesquels un numéro existe.
export const createLink = (v) => rpc('mayapay_create_v2', { p_name: v.n, p_number_orange: v.po || null, p_number_moov: v.pm || null, p_amount: v.a, p_description: v.d, p_hours: v.h });
// Infos publiques (jamais le numéro) pour la page client.
export const getLink = (id) => rpc('mayapay_get', { p_id: id });
// Ouvre une session de 2 minutes : retourne le code complet, seulement à ce moment-là.
export const startSession = (id, operator) => rpc('mayapay_start', { p_id: id, p_operator: operator });
// Envoie le SMS de confirmation collé par le client ; le serveur le lit et répond.
export const confirmPayment = (id, operator, message) => rpc('mayapay_confirm', { p_id: id, p_operator: operator, p_message: message });
// Suivi vendeur (clé privée).
export const vendorStatus = (id, key) => rpc('mayapay_status', { p_id: id, p_key: key });
