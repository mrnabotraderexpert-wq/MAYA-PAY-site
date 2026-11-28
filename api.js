import { CONFIG } from './config.js';

export const serverReady = () => Boolean(CONFIG.supabase?.url && CONFIG.supabase?.key);
export const validId = (id) => /^[0-9a-f]{12}$/.test(String(id ?? ''));
export const validKey = (k) => /^[0-9a-f]{32}$/.test(String(k ?? ''));

// Jeton du compte connecté (fourni par account.js). Sans compte, les appels restent anonymes comme avant.
let tokenProvider = null;
export const setTokenProvider = (fn) => { tokenProvider = fn; };

// Appelle une fonction RPC. En cas d'erreur, le message de la base (ex. « rate_limited ») devient err.code.
async function rpc(fn, args, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabase.key };
    if (tokenProvider) { const t = await tokenProvider(); if (t) headers.Authorization = 'Bearer ' + t; }
    const res = await fetch(`${CONFIG.supabase.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
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
// Consentement obligatoire (case cochée) : enregistré avec la session (date + version de la politique).
export const CONSENT_VERSION = '2026-11-26';
export const startSession = (id, operator, payer) => rpc('mayapay_start_v3', { p_id: id, p_operator: operator, p_payer: payer, p_consent: true, p_version: CONSENT_VERSION });
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

// ---- Assistance (messagerie client). Le client n'a pas de compte : un code secret généré dans son navigateur, dont le serveur ne garde que l'empreinte ----
export const supportSend = (token, name, phone, body) => rpc('mayapay_support_send', { p_token: token, p_name: name || null, p_phone: phone || null, p_body: body });
export const supportFetch = (token, after) => rpc('mayapay_support_fetch', { p_token: token, p_after: after || 0 });
export const supportAdminList = (pass) => rpc('mayapay_support_admin_list', { p_pass: pass });
export const supportAdminGet = (pass, thread, after) => rpc('mayapay_support_admin_get', { p_pass: pass, p_thread: thread, p_after: after || 0 });
export const supportAdminReply = (pass, thread, body) => rpc('mayapay_support_admin_reply', { p_pass: pass, p_thread: thread, p_body: body });
export const supportAdminClose = (pass, thread, closed) => rpc('mayapay_support_admin_close', { p_pass: pass, p_thread: thread, p_closed: closed });

// Publicités de l'accueil : lecture publique (une annonce au hasard), écriture réservée à l'administrateur
export const adsPublic = () => rpc('mayapay_ads_public', {});
export const adminAdsList = (pass) => rpc('mayapay_admin_ads_list', { p_pass: pass });
export const adminAdSave = (pass, ad) => rpc('mayapay_admin_ad_save', { p_pass: pass, p_id: ad.id ?? null, p_title: ad.title, p_text: ad.text, p_cta: ad.cta, p_url: ad.url, p_image: ad.image || null, p_active: ad.active });
export const adminAdAction = (pass, id, action) => rpc('mayapay_admin_ad_action', { p_pass: pass, p_id: id, p_action: action });

// ---- Maya Express : vitrine (catalogue) du vendeur et commandes ----
// Le prix de chaque produit et le total sont toujours recalculés par le serveur ; la licence vendeur est vérifiée comme pour les liens.
export const expressSave = (v) => rpc('mayapay_express_save', { p_id: v.id || null, p_key: v.key || null, p_name: v.n, p_orange: v.po || null, p_moov: v.pm || null, p_photo: v.ph || null, p_products: v.products }, 30000);
// Page publique du client : nom, photo, opérateurs, produits (jamais les numéros du vendeur).
export const expressGet = (id) => rpc('mayapay_express_get', { p_id: id });
// Profil de la vitrine (bannière, WhatsApp, ville, slogan, réseaux) : réservé au propriétaire (id + clé), vérifié et normalisé par le serveur.
export const expressProfileSave = (v) => rpc('mayapay_express_profile_save', { p_id: v.id, p_key: v.key, p_banner: v.bn || null, p_whatsapp: v.wa || null, p_city: v.ci || null, p_slogan: v.sl || null, p_facebook: v.fb || null, p_instagram: v.ig || null, p_tiktok: v.tt || null }, 30000);
// Le client valide son panier : le serveur crée un lien de paiement MAYA-PAY (24 h) et retourne son identifiant.
export const expressOrder = (id, items, buyer, phone) => rpc('mayapay_express_order', { p_id: id, p_items: items, p_buyer: buyer, p_phone: phone }, 30000);
// Commandes reçues (clé privée de la vitrine), avec l'état du paiement vérifié par SMS.
export const expressOrders = (id, key) => rpc('mayapay_express_orders', { p_id: id, p_key: key });

// Import d'une boutique Boutiki (infos déjà publiques : nom, numéros, logo). Erreurs renvoyées en JSON : bad_slug, not_found, too_many.
export const importBoutique = (slug) => rpc('mayapay_import_boutique', { p_slug: slug });
// Produits (nom, prix, photo) d'une boutique Boutiki : 30 au maximum. Erreurs JSON : bad_slug, not_found, too_many.
export const importProduits = (slug) => rpc('mayapay_import_produits', { p_slug: slug });

// ---- Comptes vendeurs (Supabase Auth : e-mail + mot de passe) ----
// Le mot de passe n'est jamais stocké par ce site : il va directement au service d'authentification (HTTPS).
async function authCall(path, { method = 'POST', body, token, timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabase.key };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(`${CONFIG.supabase.url}/auth/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    if (!res.ok) throw Object.assign(new Error('auth_' + res.status), { status: res.status, code: (data && (data.error_code || data.code)) || 'http_' + res.status });
    return data;
  } finally {
    clearTimeout(timer);
  }
}
const redir = (u) => (u ? '?redirect_to=' + encodeURIComponent(u) : '');
export const authSignUp = (email, password, redirectTo) => authCall('signup' + redir(redirectTo), { body: { email, password } });
export const authSignIn = (email, password) => authCall('token?grant_type=password', { body: { email, password } });
export const authRefresh = (refreshToken) => authCall('token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
export const authRecover = (email, redirectTo) => authCall('recover' + redir(redirectTo), { body: { email } });
export const authSetPassword = (token, password) => authCall('user', { method: 'PUT', token, body: { password } });
export const authUser = (token) => authCall('user', { method: 'GET', token });
export const authSignOut = (token) => authCall('logout', { token });

// ---- Confiance : interrupteurs publics, profil vendeur, vérification NINA, signalement ----
export const flagsGet = () => rpc('mayapay_flags', {}, 6000);
export const myProfile = () => rpc('mayapay_my_profile', {});
export const verifyRequest = (name, phone, nina) => rpc('mayapay_verify_request', { p_name: name, p_phone: phone || null, p_nina: nina });
export const expressClaim = (id, key) => rpc('mayapay_express_claim', { p_id: id, p_key: key });
export const reportSend = (r) => rpc('mayapay_report', { p_kind: r.kind, p_id: r.id, p_reason: r.reason, p_details: r.details, p_contact: r.contact || null, p_order: r.order || null });

// ---- Administration : confiance et sécurité (mot de passe admin vérifié par le serveur à chaque appel) ----
export const adminTrustGet = (pass) => rpc('mayapay_admin_trust_get', { p_pass: pass });
export const adminTrustSet = (pass, t) => rpc('mayapay_admin_trust_set', { p_pass: pass, p_auth: t.auth, p_required: t.required, p_kyc: t.kyc, p_reports: t.reports });
export const adminVendors = (pass, status, q) => rpc('mayapay_admin_vendors', { p_pass: pass, p_status: status || '', p_q: q || '' });
export const adminVendorSet = (pass, user, action, note) => rpc('mayapay_admin_vendor_set', { p_pass: pass, p_user: user, p_action: action, p_note: note || null });
export const adminReports = (pass, status) => rpc('mayapay_admin_reports', { p_pass: pass, p_status: status || '' });
export const adminReportSet = (pass, id, status, note) => rpc('mayapay_admin_report_set', { p_pass: pass, p_id: id, p_status: status, p_note: note || null });
