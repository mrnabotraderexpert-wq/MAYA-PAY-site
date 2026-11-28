// Comptes vendeurs (e-mail + mot de passe), vérification d'identité (NINA) et signalement d'un vendeur.
// Tout est piloté par les interrupteurs de l'administrateur (admin.html > « Confiance et sécurité ») :
// activer ou couper une fonction ne demande ni build ni déploiement. Le serveur applique les règles ; ce fichier affiche.
import {
  setTokenProvider, flagsGet, myProfile, verifyRequest, expressClaim, reportSend,
  authSignUp, authSignIn, authRefresh, authRecover, authSetPassword, authUser, authSignOut, validId, validKey,
} from './api.js';

const KEY = 'mayapay.auth';
const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const now = () => Math.floor(Date.now() / 1000);

let ctx;
let flags = { auth: false, required: false, kyc: false, reports: true };
let flagsAt = 0;
let recovery = false; // le lien « mot de passe oublié » vient d'être ouvert : demander un nouveau mot de passe
let mode = 'login';
let reportTarget = null;

/* ---------- Session ---------- */
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const write = (s) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };
const toSession = (r, email) => ({ at: r.access_token, rt: r.refresh_token, exp: now() + (Number(r.expires_in) || 3600), email: String((r.user && r.user.email) || email || '') });
export const loggedIn = () => Boolean(read());
export const getFlags = () => flags;
// Gate « inscription obligatoire » : actif seulement si l'administrateur l'a demandé.
export const gated = () => flags.auth && flags.required && !loggedIn();

let refreshing = null;
async function token() {
  const s = read();
  if (!s || !s.at) return '';
  if (s.exp - 60 > now()) return s.at;
  try {
    refreshing = refreshing || authRefresh(s.rt).finally(() => { refreshing = null; });
    const r = await refreshing;
    if (!r || !r.access_token) throw Object.assign(new Error('bad'), { status: 400 });
    write(toSession(r, s.email));
    return r.access_token;
  } catch (e) {
    if (e && e.status) { write(null); refreshMenu(); } // session refusée : on la retire. Panne réseau : on la garde.
    return '';
  }
}

/* ---------- Interrupteurs publics ---------- */
async function loadFlags() {
  try {
    const f = await Promise.race([flagsGet(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 4000))]);
    if (f && typeof f === 'object') flags = { auth: f.auth === true, required: f.required === true && f.auth === true, kyc: f.kyc === true, reports: f.reports !== false };
    flagsAt = Date.now();
  } catch { /* on garde les valeurs précédentes */ }
  refreshMenu();
}

function refreshMenu() {
  const a = $('menu-account');
  a.hidden = !flags.auth;
  a.textContent = loggedIn() ? 'Mon compte' : 'Connexion';
  for (const id of ['s-report-row', 'pay-report-row']) $(id).hidden = !flags.reports;
}

// Lien de l'e-mail (confirmation ou mot de passe oublié) : le service d'authentification ajoute la session après « # ».
function consumeAuthHash() {
  const h = location.hash;
  if (!/^#(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h.slice(1));
  history.replaceState(null, '', location.pathname + location.search + '#/compte');
  if (p.get('error')) return { error: p.get('error_code') || p.get('error') };
  if (!p.get('access_token')) return null;
  write({ at: p.get('access_token'), rt: p.get('refresh_token') || '', exp: now() + (Number(p.get('expires_in')) || 3600), email: '' });
  return { type: p.get('type') || 'signup' };
}

export async function boot() {
  const link = consumeAuthHash();
  if (link && link.type === 'recovery') recovery = true;
  await loadFlags();
  if (link && link.error) ctx.toast('Ce lien n’est plus valable. Demandez-en un nouveau.');
  const s = read();
  if (s && !s.email) { // session venue d'un lien e-mail : retrouver l'adresse
    try { const u = await authUser(s.at); write({ ...s, email: String((u && u.email) || '') }); } catch { /* ignoré */ }
  }
  refreshMenu();
}

// À appeler à chaque changement de page : rafraîchit les interrupteurs si besoin et efface les champs sensibles.
export function touch() {
  if (Date.now() - flagsAt > 60000) loadFlags();
  for (const id of ['ac-pass', 'ac-pass2', 'ac-v-nina']) { const el = $(id); if (el) el.value = ''; }
}

export function initAccount(c) {
  ctx = c;
  setTokenProvider(token);
  setupForm();
  setupProfile();
  setupReport();
  refreshMenu();
  return { boot, open, openReport, setReportTarget, claimLocalShop, touch, gated, loggedIn, flags: getFlags };
}

const go = (h) => { if (location.hash === h) ctx.route(); else location.hash = h; };

/* ---------- Écran de connexion (4 éléments : logo, champs, encart sécurité, lien d'aide) ---------- */
const T = {
  login: { title: 'Connexion', btn: 'Se connecter', pass: true, pass2: false, auto: 'current-password', links: [['Mot de passe oublié ?', 'forgot'], ['Créer un compte', 'signup']] },
  signup: { title: 'Créer un compte', btn: 'Créer mon compte', pass: true, pass2: true, auto: 'new-password', links: [['Déjà un compte ? Se connecter', 'login']] },
  forgot: { title: 'Mot de passe oublié', btn: 'Envoyer le lien', pass: false, pass2: false, auto: 'current-password', links: [['Retour à la connexion', 'login']] },
  reset: { title: 'Nouveau mot de passe', btn: 'Enregistrer', pass: true, pass2: true, auto: 'new-password', links: [] },
};

function renderForm(m) {
  mode = T[m] ? m : 'login';
  const t = T[mode];
  $('ac-form-box').hidden = false;
  $('ac-profile').hidden = true;
  $('ac-title').textContent = t.title;
  $('ac-submit').textContent = t.btn;
  $('ac-submit').hidden = false;
  $('ac-f-email').hidden = mode === 'reset';
  $('ac-f-pass').hidden = !t.pass;
  $('ac-f-pass2').hidden = !t.pass2;
  $('ac-pass').autocomplete = t.auto;
  $('ac-pass').placeholder = mode === 'login' ? 'Votre mot de passe' : '8 caractères minimum';
  $('ac-err').textContent = '';
  $('ac-note').hidden = true;
  const box = $('ac-links');
  box.replaceChildren();
  t.links.forEach(([label, to], i) => {
    if (i) box.appendChild(document.createTextNode(' · '));
    const b = mk('button', 'auth-link', label);
    b.type = 'button';
    b.onclick = () => { renderForm(to); (to === 'login' || to === 'signup' || to === 'forgot' ? $('ac-email') : $('ac-pass')).focus(); };
    box.appendChild(b);
  });
}

export async function open(m) {
  if (!flags.auth) { go('#/'); return; }
  document.title = 'Mon compte – MAYA-PAY';
  if (recovery) m = 'reset';
  ctx.show('view-account');
  if (m !== 'reset' && loggedIn()) return renderProfile();
  renderForm(m || 'login');
}

const AUTH_ERR = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  email_not_confirmed: 'Confirmez d’abord votre e-mail : un lien vous a été envoyé à l’inscription.',
  over_request_rate_limit: 'Trop d’essais. Réessayez dans quelques minutes.',
  over_email_send_rate_limit: 'Trop d’e-mails envoyés. Réessayez dans quelques minutes.',
  weak_password: 'Mot de passe trop faible : ajoutez des lettres et des chiffres.',
  same_password: 'Choisissez un mot de passe différent de l’ancien.',
  signup_disabled: 'Les inscriptions sont fermées pour le moment.',
  user_banned: 'Ce compte est suspendu.',
};
const authMsg = (e) => (e && e.code && AUTH_ERR[e.code]) || (e && e.status ? 'Opération refusée. Vérifiez vos informations.' : 'Connexion impossible. Réessayez.');
const redirectUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

async function afterAuth() {
  refreshMenu();
  await claimLocalShop();
  go(flags.required ? '#/' : '#/compte');
}

function setupForm() {
  $('ac-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('ac-err');
    const note = $('ac-note');
    err.textContent = '';
    note.hidden = true;
    const email = clean($('ac-email').value).toLowerCase();
    const pass = $('ac-pass').value;
    const pass2 = $('ac-pass2').value;
    if (mode !== 'reset' && !EMAIL_RE.test(email)) { err.textContent = 'Saisissez une adresse e-mail valide.'; return $('ac-email').focus(); }
    if (mode === 'login' && !pass) { err.textContent = 'Saisissez votre mot de passe.'; return $('ac-pass').focus(); }
    if ((mode === 'signup' || mode === 'reset') && (pass.length < 8 || pass.length > 72)) { err.textContent = 'Le mot de passe doit contenir de 8 à 72 caractères.'; return $('ac-pass').focus(); }
    if ((mode === 'signup' || mode === 'reset') && pass !== pass2) { err.textContent = 'Les deux mots de passe sont différents.'; return $('ac-pass2').focus(); }
    const btn = $('ac-submit');
    btn.disabled = true;
    try {
      if (mode === 'login') {
        const r = await authSignIn(email, pass);
        write(toSession(r, email));
        ctx.toast('Connecté.');
        await afterAuth();
      } else if (mode === 'signup') {
        const r = await authSignUp(email, pass, redirectUrl());
        if (r && r.access_token) { write(toSession(r, email)); ctx.toast('Compte créé.'); await afterAuth(); }
        else { note.textContent = 'Compte créé. Un e-mail de confirmation vient de vous être envoyé : ouvrez le lien qu’il contient, puis connectez-vous.'; note.hidden = false; renderNoteOnly(); }
      } else if (mode === 'forgot') {
        await authRecover(email, redirectUrl()).catch((x) => { if (x && x.status === 429) throw x; });
        note.textContent = 'Si ce compte existe, un lien de réinitialisation vient d’être envoyé. Vérifiez aussi vos courriers indésirables.';
        note.hidden = false;
      } else {
        const s = read();
        if (!s) throw Object.assign(new Error('expired'), { status: 401, code: 'expired' });
        await authSetPassword(await token(), pass);
        recovery = false;
        ctx.toast('Mot de passe modifié.');
        await afterAuth();
      }
    } catch (x) {
      err.textContent = x && x.code === 'expired' ? 'Ce lien n’est plus valable. Demandez-en un nouveau.' : authMsg(x);
      if (mode === 'reset' && x && x.status === 401) { recovery = false; write(null); refreshMenu(); }
    } finally {
      btn.disabled = false;
      $('ac-pass').value = '';
      $('ac-pass2').value = '';
    }
  });
}
// Après l'inscription sans session (e-mail à confirmer) : on masque les champs et on propose d'aller à la connexion.
function renderNoteOnly() {
  for (const id of ['ac-f-email', 'ac-f-pass', 'ac-f-pass2', 'ac-submit']) $(id).hidden = true;
  const box = $('ac-links');
  box.replaceChildren();
  const b = mk('button', 'auth-link', 'Aller à la connexion');
  b.type = 'button';
  b.onclick = () => renderForm('login');
  box.appendChild(b);
}

/* ---------- Profil, statut du vendeur, vérification NINA ---------- */
const STATUS = {
  none: ['', 'Non vérifié', 'Votre compte est actif. La vérification d’identité est facultative et ajoute un badge « Vendeur vérifié » sur vos vitrines.'],
  pending: ['warn', 'Vérification en cours', 'Votre demande est en cours d’examen. Vous serez visible comme vérifié dès qu’elle sera acceptée.'],
  verified: ['ok', 'Vendeur vérifié', 'Votre identité est vérifiée : le badge s’affiche sur vos vitrines Maya Express.'],
  rejected: ['bad', 'Vérification refusée', 'Votre demande n’a pas été acceptée. Corrigez les informations ci-dessous et renvoyez-la.'],
  suspended: ['bad', 'Compte suspendu', 'Vos vitrines ne prennent plus de commande. Contactez l’assistance MAYA-PAY.'],
};
const VERIFY_ERR = {
  invalid_name: 'Saisissez votre nom complet (2 à 60 caractères).',
  invalid_phone: 'Numéro de téléphone invalide.',
  invalid_nina: 'Numéro NINA invalide (8 à 20 caractères).',
  nina_used: 'Ce numéro NINA est déjà utilisé par un autre compte.',
  already_verified: 'Votre compte est déjà vérifié.',
  already_pending: 'Une demande est déjà en cours.',
  suspended: 'Compte suspendu : contactez l’assistance.',
  disabled: 'La vérification d’identité n’est pas ouverte pour le moment.',
};

async function renderProfile() {
  $('ac-form-box').hidden = true;
  $('ac-profile').hidden = false;
  const s = read();
  $('ac-email-show').textContent = (s && s.email) || '';
  $('ac-status').textContent = 'Chargement…';
  $('ac-status').className = 'badge';
  $('ac-status-text').textContent = '';
  $('ac-verify').hidden = true;
  $('ac-shops-box').hidden = true;
  let p;
  try { p = await myProfile(); } catch { $('ac-status-text').textContent = 'Connexion impossible. Réessayez.'; return; }
  if (!p || p.error === 'auth_required') { write(null); refreshMenu(); return open('login'); }
  if (p.error) { $('ac-status-text').textContent = 'Les comptes ne sont pas disponibles pour le moment.'; return; }
  const st = STATUS[p.status] ? p.status : 'none';
  $('ac-status').textContent = STATUS[st][1];
  $('ac-status').className = 'badge ' + STATUS[st][0];
  $('ac-status-text').textContent = STATUS[st][2] + (st === 'rejected' && p.note ? ' Motif : ' + String(p.note).slice(0, 200) : '');
  $('ac-verify').hidden = !(p.kyc && (st === 'none' || st === 'rejected'));
  if (p.name && !$('ac-v-name').value) $('ac-v-name').value = String(p.name).slice(0, 60);
  if (p.last4 && st !== 'none') $('ac-status-text').textContent += ` NINA enregistré : ••••${String(p.last4).replace(/[^A-Za-z0-9]/g, '').slice(-4)}.`;
  const list = $('ac-shops');
  list.replaceChildren();
  for (const sh of Array.isArray(p.shops) ? p.shops : []) {
    if (!validId(sh.id)) continue;
    const li = mk('li');
    const a = mk('a', null, String(sh.n || 'Ma vitrine').slice(0, 40));
    a.href = '#/express?s=' + sh.id;
    li.appendChild(a);
    list.appendChild(li);
  }
  $('ac-shops-box').hidden = !list.children.length;
}

function setupProfile() {
  $('ac-v-send').onclick = async () => {
    const err = $('ac-v-err');
    err.textContent = '';
    const name = clean($('ac-v-name').value);
    const phone = $('ac-v-phone').value.replace(/\D/g, '');
    const nina = $('ac-v-nina').value;
    if (name.length < 2) { err.textContent = VERIFY_ERR.invalid_name; return $('ac-v-name').focus(); }
    if (nina.replace(/[^A-Za-z0-9]/g, '').length < 8) { err.textContent = VERIFY_ERR.invalid_nina; return $('ac-v-nina').focus(); }
    const btn = $('ac-v-send');
    btn.disabled = true;
    try {
      const r = await verifyRequest(name, phone, nina);
      if (r && r.error === 'auth_required') { write(null); refreshMenu(); return open('login'); }
      if (r && r.error) { err.textContent = VERIFY_ERR[r.error] || 'Demande impossible pour le moment.'; return; }
      ctx.toast('Demande envoyée.');
      $('ac-v-nina').value = '';
      await renderProfile();
    } catch { err.textContent = 'Connexion impossible. Réessayez.'; } finally { btn.disabled = false; }
  };
  $('ac-logout').onclick = async () => {
    const s = read();
    write(null);
    refreshMenu();
    if (s && s.at) authSignOut(s.at).catch(() => {});
    ctx.toast('Déconnecté.');
    go('#/');
  };
}

// Rattache à mon compte la vitrine créée sur cet appareil (sans effet si elle a déjà un propriétaire).
export async function claimLocalShop() {
  if (!flags.auth || !loggedIn()) return;
  const s = ctx.store.get().express || {};
  if (!validId(s.id) || !validKey(s.key)) return;
  try { await expressClaim(s.id, s.key); } catch { /* ignoré */ }
}

/* ---------- Signalement d'un vendeur ---------- */
const REPORT_ERR = {
  disabled: 'Les signalements sont fermés pour le moment.',
  not_found: 'Ce vendeur est introuvable.',
  invalid_details: 'Décrivez le problème en 10 à 500 caractères.',
  invalid_reason: 'Choisissez un motif.',
  rate_limited: 'Trop de signalements envoyés. Réessayez plus tard.',
  already_reported: 'Vous avez déjà signalé ce vendeur aujourd’hui.',
};

export function setReportTarget(t) { reportTarget = t; }

export function openReport(params) {
  const kind = params.get('k');
  const id = params.get('i');
  if (!flags.reports || !['shop', 'link'].includes(kind) || !validId(id)) return ctx.invalid();
  if (!reportTarget || reportTarget.id !== id) reportTarget = { kind, id, name: '' };
  reportTarget.kind = kind;
  document.title = 'Signaler un vendeur – MAYA-PAY';
  $('r-vendor').textContent = reportTarget.name ? `Vendeur concerné : ${reportTarget.name}` : '';
  $('r-vendor').hidden = !reportTarget.name;
  $('r-details').value = '';
  $('r-contact').value = '';
  $('r-order').value = '';
  $('r-err').textContent = '';
  $('r-form').hidden = false;
  $('r-done').hidden = true;
  ctx.show('view-report');
}

function setupReport() {
  for (const id of ['r-back', 'r-back2']) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      if (history.length > 1) history.back(); else location.hash = '#/';
    });
  }
  $('r-send').onclick = async () => {
    const err = $('r-err');
    err.textContent = '';
    const details = clean($('r-details').value);
    if (details.length < 10 || details.length > 500) { err.textContent = REPORT_ERR.invalid_details; return $('r-details').focus(); }
    if (!reportTarget) return ctx.invalid();
    const btn = $('r-send');
    btn.disabled = true;
    try {
      const r = await reportSend({ kind: reportTarget.kind, id: reportTarget.id, reason: $('r-reason').value, details, contact: clean($('r-contact').value), order: clean($('r-order').value) });
      if (r && r.error) { err.textContent = REPORT_ERR[r.error] || 'Envoi impossible pour le moment.'; return; }
      $('r-form').hidden = true;
      $('r-done').hidden = false;
      window.scrollTo(0, 0);
    } catch { err.textContent = 'Connexion impossible. Réessayez.'; } finally { btn.disabled = false; }
  };
}
