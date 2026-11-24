import { CONFIG } from './config.js';

export const serverReady = () => Boolean(CONFIG.supabase?.url && CONFIG.supabase?.key);
export const validId = (id) => /^[0-9a-f]{12}$/.test(String(id ?? ''));
export const validKey = (k) => /^[0-9a-f]{32}$/.test(String(k ?? ''));

// Appelle une fonction RPC. En cas d'erreur, le message de la base (ex. « rate_limited ») devient err.code.
async function rpc(fn, args, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
export const createLink = (v) => rpc('mayapay_create_v3', { p_name: v.n, p_number_orange: v.po || null, p_number_moov: v.pm || null, p_amount: v.a, p_description: v.d, p_hours: v.h, p_photo: v.ph || null }, 30000);
// Infos publiques (jamais le numéro) pour la page client.
export const getLink = (id) => rpc('mayapay_get', { p_id: id });
// Ouvre une session de 2 minutes : retourne le code complet, seulement à ce moment-là.
// Le numéro du client (celui qui paie) est obligatoire : il est rapproché du SMS de confirmation.
export const startSession = (id, operator, payer) => rpc('mayapay_start_v2', { p_id: id, p_operator: operator, p_payer: payer });
// Résultat de la confirmation automatique (décidée par le serveur à partir du SMS lu par l'application) : null tant que rien n'est reçu.
export const smsResult = (id) => rpc('mayapay_sms_result', { p_id: id });
// Suivi vendeur (clé privée).
export const vendorStatus = (id, key) => rpc('mayapay_status', { p_id: id, p_key: key });

// ---- Abonnements (licences vendeurs) ----
// État de la licence d'un vendeur, d'après son/ses numéros (jamais de données d'un autre vendeur).
export const subInfo = (po, pm) => rpc('mayapay_sub_info', { p_orange: po || null, p_moov: pm || null });
// Crée un lien de paiement d'abonnement vers le numéro marchand configuré par l'administrateur.
export const subOrder = (phone) => rpc('mayapay_sub_order', { p_phone: phone });

// ---- Administration : le mot de passe est revérifié par le serveur à chaque appel ----
export const adminGet = (pass) => rpc('mayapay_admin_get', { p_pass: pass });
export const adminSet = (pass, s) => rpc('mayapay_admin_set', { p_pass: pass, p_free: s.free, p_price: s.price, p_days: s.days, p_orange: s.orange, p_moov: s.moov });
export const adminLicenses = (pass, q) => rpc('mayapay_admin_licenses', { p_pass: pass, p_q: q || '' });
export const adminLicense = (pass, phone, action, days) => rpc('mayapay_admin_license', { p_pass: pass, p_phone: phone, p_action: action, p_days: days ?? null });
export const adminPayment = (pass, id, action) => rpc('mayapay_admin_payment', { p_pass: pass, p_id: id, p_action: action });
export const adminPassword = (pass, next) => rpc('mayapay_admin_password', { p_pass: pass, p_new: next });
