import { CONFIG } from './config.js';
import { serverReady, adminGet, adminSet, adminLicenses, adminLicense, adminPayment, adminPassword } from './api.js';
import { formatAmount, normalizeNumber } from './link.js';

const $ = (id) => document.getElementById(id);
const PASS_KEY = 'mayapay.admin';
// Le mot de passe n'est jamais stocké durablement : seulement pour l'onglet ouvert (sessionStorage), et revérifié par le serveur à chaque appel.
const pass = {
  get() { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(PASS_KEY, v); } catch { /* ignoré */ } },
  clear() { try { sessionStorage.removeItem(PASS_KEY); } catch { /* ignoré */ } },
};

// Toutes les données venant du serveur sont insérées avec textContent, jamais innerHTML.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const money = (n) => `${formatAmount(Number(n))} ${CONFIG.currency}`;
const daysLabel = (d) => ({ 30: '30 jours', 90: '3 mois', 180: '6 mois', 365: '1 an' }[d] || `${d} jours`);

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function say(id, text, ok) { const m = $(id); m.textContent = text || ''; m.className = 'msg ' + (text ? (ok ? 'ok' : 'bad') : ''); }

const ERRORS = {
  forbidden: 'Mot de passe incorrect.',
  locked: 'Trop de tentatives. Réessayez dans 15 minutes.',
  invalid_price: 'Prix invalide (de 1 à 5 000 000 FCFA).',
  invalid_days: 'Durée invalide (de 1 à 3650 jours).',
  invalid_phone_orange: 'Numéro Orange Money invalide (8 à 10 chiffres).',
  invalid_phone_moov: 'Numéro Moov Money invalide (8 à 10 chiffres).',
  invalid_phone: 'Numéro invalide (8 à 10 chiffres).',
  invalid_free: 'Valeur invalide.',
  not_found: 'Aucune licence pour ce numéro.',
  not_pending: 'Ce paiement a déjà été traité.',
  weak_password: 'Le mot de passe doit contenir de 10 à 100 caractères.',
};
const errText = (code) => ERRORS[code] || 'Opération impossible. Réessayez.';

let cfg = null;
let busy = false;

/* ---------- Appel sécurisé ---------- */
// Retourne la réponse du serveur ; en cas de mot de passe refusé, ramène à l'écran de connexion.
async function call(fn, ...args) {
  let r;
  try { r = await fn(pass.get(), ...args); } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
  if (r && r.error) {
    if (r.error === 'forbidden' || r.error === 'locked') logout(errText(r.error));
    throw Object.assign(new Error(r.error), { code: r.error });
  }
  return r;
}

/* ---------- Vues ---------- */
function showLogin(msg) {
  $('view-panel').hidden = true;
  $('logout').hidden = true;
  $('view-login').hidden = false;
  $('login-err').textContent = msg || '';
  stopAuto();
}
function showPanel() {
  $('view-login').hidden = true;
  $('view-panel').hidden = false;
  $('logout').hidden = false;
}
function logout(msg) {
  pass.clear(); cfg = null; $('l-pass').value = '';
  showLogin(typeof msg === 'string' ? msg : '');
}
$('logout').addEventListener('click', () => logout());

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('l-pass').value;
  if (!v) { $('login-err').textContent = 'Saisissez le mot de passe.'; return; }
  $('login-err').textContent = '';
  pass.set(v);
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    await loadAll(true);
    showPanel();
    startAuto();
  } catch (err) {
    if (err.code !== 'forbidden' && err.code !== 'locked') { pass.clear(); $('login-err').textContent = 'Connexion impossible. Réessayez.'; }
  } finally {
    if (btn) btn.disabled = false;
    $('l-pass').value = '';
  }
});

/* ---------- Chargement ---------- */
async function loadSettings(fillForm) {
  const r = await call(adminGet);
  cfg = r;
  for (const [k, v] of [['s-active', r.stats.active], ['s-expired', r.stats.expired], ['s-suspended', r.stats.suspended], ['s-pending', r.stats.pending]]) $(k).textContent = String(v);
  renderFree();
  if (fillForm) fillSettingsForm();
}

let searchQ = '';
async function loadLists() {
  const r = await call(adminLicenses, searchQ);
  renderLicenses(Array.isArray(r.licenses) ? r.licenses : []);
  renderPayments(Array.isArray(r.payments) ? r.payments : []);
}

async function loadAll(fillForm) {
  await loadSettings(fillForm);
  await loadLists();
}

let autoTimer;
const stopAuto = () => { clearInterval(autoTimer); autoTimer = null; };
function startAuto() {
  stopAuto();
  autoTimer = setInterval(() => { if (document.visibilityState === 'visible' && !busy && pass.get()) loadAll(false).catch(() => {}); }, 30000);
}
$('refresh').addEventListener('click', async () => {
  try { await loadAll(false); toast('Actualisé.'); } catch { toast('Connexion impossible.'); }
});

/* ---------- Accès gratuit ---------- */
function renderFree() {
  const on = cfg.free_access;
  $('free').checked = on;
  $('free-title').textContent = on ? 'Accès gratuit ACTIVÉ' : 'Accès gratuit DÉSACTIVÉ';
  $('free-text').textContent = on
    ? 'Tous les vendeurs peuvent créer des liens de paiement sans abonnement.'
    : 'Seuls les vendeurs ayant une licence valide peuvent créer de nouveaux liens.';
}
$('free').addEventListener('change', async (e) => {
  const want = e.target.checked;
  say('free-msg', '');
  e.target.disabled = true;
  busy = true;
  try {
    await call(adminSet, { free: want, price: cfg.price, days: cfg.days, orange: cfg.phone_orange, moov: cfg.phone_moov });
    cfg.free_access = want;
    say('free-msg', want ? 'Accès gratuit activé : appliqué immédiatement à tous les vendeurs.' : 'Accès gratuit désactivé : seuls les vendeurs avec une licence valide peuvent créer des liens.', true);
  } catch (err) {
    say('free-msg', errText(err.code), false);
  } finally {
    busy = false;
    e.target.disabled = false;
    if (cfg) renderFree();
  }
});

/* ---------- Paramètres ---------- */
const PRESETS = ['30', '90', '180', '365'];
function fillSettingsForm() {
  $('a-price').value = String(cfg.price);
  const d = String(cfg.days);
  $('a-days').value = PRESETS.includes(d) ? d : 'custom';
  $('a-days-custom').hidden = PRESETS.includes(d);
  $('a-days-custom').value = PRESETS.includes(d) ? '' : d;
  $('a-orange').value = cfg.phone_orange || '';
  $('a-moov').value = cfg.phone_moov || '';
  $('n-days').value = $('n-days').value || String(cfg.days);
}
$('a-days').addEventListener('change', () => {
  const c = $('a-days').value === 'custom';
  $('a-days-custom').hidden = !c;
  if (c) $('a-days-custom').focus();
});

const toInt = (v) => { const s = String(v ?? '').replace(/[\s\u00a0\u202f.,]/g, ''); return /^\d+$/.test(s) ? Number(s) : NaN; };

$('set-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('set-msg', '');
  const price = toInt($('a-price').value);
  const days = $('a-days').value === 'custom' ? toInt($('a-days-custom').value) : Number($('a-days').value);
  if (!Number.isInteger(price) || price < 1 || price > 5000000) return say('set-msg', errText('invalid_price'), false);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return say('set-msg', errText('invalid_days'), false);
  const orange = normalizeNumber($('a-orange').value);
  const moov = normalizeNumber($('a-moov').value);
  if (orange && !/^[0-9]{8,10}$/.test(orange)) return say('set-msg', errText('invalid_phone_orange'), false);
  if (moov && !/^[0-9]{8,10}$/.test(moov)) return say('set-msg', errText('invalid_phone_moov'), false);
  const btn = e.submitter; if (btn) btn.disabled = true;
  busy = true;
  try {
    await call(adminSet, { free: cfg.free_access, price, days, orange, moov });
    await loadSettings(true);
    say('set-msg', !orange && !moov ? 'Enregistré, mais aucun numéro marchand : les vendeurs ne peuvent pas encore s’abonner.' : 'Paramètres enregistrés.', Boolean(orange || moov));
  } catch (err) {
    say('set-msg', errText(err.code), false);
  } finally {
    busy = false;
    if (btn) btn.disabled = false;
  }
});

/* ---------- Licences ---------- */
function licenseStatus(l) {
  if (l.suspended) return ['Suspendue', 'bad'];
  return l.active ? ['Active', 'ok'] : ['Expirée', 'warn'];
}

async function licenseAction(phone, action, days) {
  say('lic-msg', '');
  busy = true;
  try {
    const r = await call(adminLicense, phone, action, days);
    say('lic-msg', action === 'extend' ? `Licence de ${phone} prolongée jusqu’au ${fmt(r.expires_at)}.` : action === 'suspend' ? `Licence de ${phone} suspendue.` : `Licence de ${phone} réactivée.`, true);
    await loadAll(false);
  } catch (err) {
    say('lic-msg', errText(err.code), false);
  } finally {
    busy = false;
  }
}

function renderLicenses(list) {
  const ul = $('licenses');
  ul.replaceChildren();
  if (!list.length) { const li = el('li', 'empty', searchQ ? 'Aucun vendeur trouvé.' : 'Aucune licence pour le moment. Elles apparaissent ici dès qu’un vendeur s’abonne.'); ul.appendChild(li); return; }
  for (const l of list) {
    const phone = String(l.phone);
    if (!/^[0-9]{8,10}$/.test(phone)) continue;
    const li = el('li', 'item');
    const head = el('div', 'item-head');
    const [label, cls] = licenseStatus(l);
    head.append(el('strong', '', phone), el('span', 'badge ' + cls, label));
    const info = el('small', '', `Expire le ${fmt(l.expires_at)} · activée le ${fmt(l.activated_at)} · ${l.source === 'admin' ? 'ajoutée par l’administrateur' : 'par paiement'}`);
    const actions = el('div', 'item-actions');
    const days = el('input');
    days.type = 'text'; days.inputMode = 'numeric'; days.value = String(cfg ? cfg.days : 30); days.setAttribute('aria-label', `Jours à ajouter pour ${phone}`);
    const ext = el('button', 'btn secondary small', 'Prolonger');
    ext.type = 'button';
    ext.addEventListener('click', () => {
      const n = toInt(days.value);
      if (!Number.isInteger(n) || n < 1 || n > 3650) return say('lic-msg', errText('invalid_days'), false);
      licenseAction(phone, 'extend', n);
    });
    const tog = el('button', 'btn ghost small', l.suspended ? 'Réactiver' : 'Suspendre');
    tog.type = 'button';
    tog.addEventListener('click', () => {
      if (!l.suspended && !confirm(`Suspendre la licence de ${phone} ? Le vendeur ne pourra plus créer de nouveaux liens (ses anciens liens et paiements en cours restent traités).`)) return;
      licenseAction(phone, l.suspended ? 'reactivate' : 'suspend');
    });
    actions.append(days, el('span', 'muted', 'jours'), ext, tog);
    li.append(head, info, actions);
    ul.appendChild(li);
  }
}

let searchTimer;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => { searchQ = $('q').value.replace(/\D/g, ''); try { await loadLists(); } catch { /* ignoré */ } }, 400);
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = normalizeNumber($('n-phone').value);
  const n = toInt($('n-days').value);
  if (!/^[0-9]{8,10}$/.test(phone)) return say('lic-msg', errText('invalid_phone'), false);
  if (!Number.isInteger(n) || n < 1 || n > 3650) return say('lic-msg', errText('invalid_days'), false);
  await licenseAction(phone, 'extend', n);
  $('n-phone').value = '';
});

/* ---------- Paiements d'abonnement ---------- */
const PAY_STATUS = { activated: ['Activé', 'ok'], pending: ['À valider', 'warn'], rejected: ['Rejeté', 'bad'] };

function renderPayments(list) {
  const pend = list.filter((p) => p.status === 'pending');
  $('pending-card').hidden = !pend.length;
  const pl = $('pending');
  pl.replaceChildren();
  for (const p of pend) {
    const li = el('li', 'item');
    const head = el('div', 'item-head');
    head.append(el('strong', '', String(p.phone)), el('span', 'badge warn', 'À valider'));
    const info = el('small', '', `${p.amount != null ? money(p.amount) : 'montant inconnu'} · ${daysLabel(Number(p.days))} · ${fmt(p.created_at)}${/^[A-Za-z0-9.\-]{6,40}$/.test(String(p.tx_id ?? '')) ? ` · transaction ${p.tx_id}` : ''}`);
    const actions = el('div', 'item-actions');
    const ok = el('button', 'btn primary small', 'Valider et activer');
    ok.type = 'button';
    ok.addEventListener('click', () => { if (confirm(`Avez-vous bien reçu ${p.amount != null ? money(p.amount) : 'ce paiement'} sur votre compte marchand ? La licence de ${p.phone} sera activée.`)) payAction(p.id, 'validate'); });
    const no = el('button', 'btn ghost small', 'Rejeter');
    no.type = 'button';
    no.addEventListener('click', () => { if (confirm('Rejeter ce paiement ? Aucune licence ne sera activée.')) payAction(p.id, 'reject'); });
    actions.append(ok, no);
    li.append(head, info, actions);
    pl.appendChild(li);
  }

  const ul = $('payments');
  ul.replaceChildren();
  if (!list.length) { ul.appendChild(el('li', 'empty', 'Aucun paiement d’abonnement pour le moment.')); return; }
  for (const p of list) {
    const [label, cls] = PAY_STATUS[p.status] || ['–', 'mute'];
    const li = el('li', 'item');
    const head = el('div', 'item-head');
    head.append(el('strong', '', String(p.phone)), el('span', 'badge ' + cls, label));
    li.append(head, el('small', '', `${p.amount != null ? money(p.amount) : '–'} · ${daysLabel(Number(p.days))} · ${fmt(p.created_at)}`));
    ul.appendChild(li);
  }
}

async function payAction(id, action) {
  say('pay-msg', '');
  busy = true;
  try {
    await call(adminPayment, id, action);
    say('pay-msg', action === 'validate' ? 'Paiement validé : licence activée.' : 'Paiement rejeté.', true);
    await loadAll(false);
  } catch (err) {
    say('pay-msg', errText(err.code), false);
    try { await loadAll(false); } catch { /* ignoré */ }
  } finally {
    busy = false;
  }
}

/* ---------- Mot de passe ---------- */
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = $('p-new').value, b = $('p-new2').value;
  if (a.length < 10 || a.length > 100) return say('pw-msg', errText('weak_password'), false);
  if (a !== b) return say('pw-msg', 'Les deux mots de passe ne sont pas identiques.', false);
  try {
    await call(adminPassword, a);
    pass.set(a);
    $('p-new').value = ''; $('p-new2').value = '';
    say('pw-msg', 'Mot de passe changé.', true);
  } catch (err) {
    say('pw-msg', errText(err.code), false);
  }
});

/* ---------- Démarrage ---------- */
(async function init() {
  if (!serverReady()) return showLogin('Serveur non configuré (config.js).');
  if (!pass.get()) return showLogin();
  try {
    await loadAll(true);
    showPanel();
    startAuto();
  } catch (err) {
    if (err.code === 'network') { pass.clear(); showLogin('Connexion impossible. Réessayez.'); }
  }
})();
