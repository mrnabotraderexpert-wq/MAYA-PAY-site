import { CONFIG } from './config.js';

export const serverMode = () => Boolean(CONFIG.supabase?.url && CONFIG.supabase?.key);
export const validId = (id) => /^[0-9a-f]{12}$/.test(String(id ?? ''));

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
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const createLink = (v) => rpc('omdirect_create_link', { p_name: v.n, p_number: v.p, p_amount: v.a, p_description: v.d, p_hours: v.h });
// Infos publiques (sans numéro) pour afficher la page client.
export const getLink = (id) => rpc('omdirect_get_link', { p_id: id });
// Numéro du vendeur, demandé seulement quand le client confirme.
export const getNumber = (id) => rpc('omdirect_get_number', { p_id: id });
