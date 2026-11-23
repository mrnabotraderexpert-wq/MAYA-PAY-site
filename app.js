import { CONFIG } from './config.js';
import { validatePayment, buildLink, decodePayment, parseHash, formatAmount } from './link.js';
import { serverMode, validId, createLink, getLink, getNumber } from './api.js';
import { buildTransferCode, displayCode, toTelUri, cauuRequired, cauuValid, isLikelyMobile } from './ussd.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'omdirect.vendor';
const views = ['view-vendor', 'view-pay', 'view-error'];

// Toutes les données issues d'un lien sont insérées avec textContent, jamais innerHTML.

/* ---------- Utilitaires ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignoré */ }
    ta.remove();
    return ok;
  }
}

const store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  clear() { try { localStorage.removeItem(STORE_KEY); } catch { /* ignoré */ } },
};

function show(id) {
  views.forEach((v) => ($(v).hidden = v !== id));
  window.scrollTo(0, 0);
}

/* ---------- Routage par fragment ---------- */
async function loadServerLink(id) {
  let o = null;
  try { o = validId(id) ? await getLink(id) : null; } catch { toast('Connexion impossible. Réessayez.'); }
  if (location.hash.indexOf(id) < 0) return; // la navigation a changé pendant l'attente
  if (o && o.n) return showPay({ n: String(o.n), a: Number(o.a), d: String(o.d || ''), id });
  document.title = 'Lien invalide – OM Direct';
  show('view-error');
}

function route() {
  wipeSecrets();
  const { path, params } = parseHash(location.hash);
  if (path === '/pay') {
    if (params.get('i')) return loadServerLink(params.get('i'));
    const p = decodePayment(params.get('d'));
    if (p) return showPay(p);
    document.title = 'Lien invalide – OM Direct';
    return show('view-error');
  }
  showVendor();
}
addEventListener('hashchange', route);

/* ---------- Vue vendeur ---------- */
const fields = { n: $('f-n'), p: $('f-p'), a: $('f-a'), d: $('f-d'), h: $('f-h') };
for (const o of CONFIG.validity.options) fields.h.add(new Option(o.label, o.hours, false, o.hours === CONFIG.validity.default));
const validityLabel = (h) => CONFIG.validity.options.find((o) => o.hours === Number(h))?.label || '';
let lastLink = '';

function showVendor() {
  document.title = 'OM Direct – Liens de paiement Orange Money';
  show('view-vendor');
  $('ussd-notice').hidden = CONFIG.ussd.verified;
  const saved = store.get();
  if (!fields.n.value && saved.n) fields.n.value = saved.n;
  if (!fields.p.value && saved.p) fields.p.value = saved.p;
  if (saved.h && validityLabel(saved.h)) fields.h.value = saved.h;
  $('forget').hidden = !(saved.n || saved.p);
}

function setErrors(errors) {
  for (const k of Object.keys(fields)) {
    $('e-' + k).textContent = errors[k] || '';
    fields[k].setAttribute('aria-invalid', errors[k] ? 'true' : 'false');
  }
  const first = Object.keys(fields).find((k) => errors[k]);
  if (first) fields[first].focus();
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = validatePayment({ n: fields.n.value, p: fields.p.value, a: fields.a.value, d: fields.d.value, h: fields.h.value });
  setErrors(r.errors);
  if (!r.ok) return;

  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  let link;
  const submit = e.submitter;
  if (submit) submit.disabled = true;
  try {
    link = serverMode() ? `${base}#/pay?i=${await createLink(r.value)}` : buildLink(r.value, base);
  } catch {
    toast('Connexion impossible. Réessayez.');
    return;
  } finally {
    if (submit) submit.disabled = false;
  }
  lastLink = link;
  store.set({ n: r.value.n, p: r.value.p, h: r.value.h });
  $('forget').hidden = false;

  const amount = `${formatAmount(r.value.a)} ${CONFIG.currency}`;
  $('r-summary').textContent = r.value.d ? `${amount} – ${r.value.d}` : amount;
  $('r-expiry').textContent = `Valable ${validityLabel(r.value.h)}`;
  $('r-link').value = link;

  const msg = `Bonjour, voici votre lien de paiement Orange Money pour ${r.value.n} : ${amount}${r.value.d ? ` (${r.value.d})` : ''}.\n${link}`;
  $('r-wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('r-sms').href = 'sms:?&body=' + encodeURIComponent(msg);
  $('r-open').href = link;
  $('r-share').hidden = typeof navigator.share !== 'function';
  $('r-share').onclick = () => navigator.share({ title: 'Paiement ' + r.value.n, text: msg, url: link }).catch(() => {});

  $('vendor-grid').classList.add('has-result');
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('r-copy').addEventListener('click', async () => {
  toast((await copyText(lastLink)) ? 'Lien copié.' : 'Copie impossible : sélectionnez le lien à la main.');
});
$('r-link').addEventListener('focus', (e) => e.target.select());

$('r-new').addEventListener('click', () => {
  fields.a.value = ''; fields.d.value = '';
  setErrors({});
  $('result').hidden = true;
  $('vendor-grid').classList.remove('has-result');
  window.scrollTo(0, 0);
  fields.a.focus();
});

$('forget').addEventListener('click', () => {
  store.clear();
  fields.n.value = ''; fields.p.value = '';
  $('forget').hidden = true;
  toast('Données effacées de cet appareil.');
});

/* ---------- Vue client ---------- */
let payment = null;
let lastCode = null; // { code, shown } gardé en mémoire uniquement, jamais dans l'URL ni le stockage
let ttlTimer;

function wipeSecrets() {
  clearTimeout(ttlTimer);
  lastCode = null;
  const c = $('cauu');
  if (c) c.value = '';
  $('fb-code').textContent = '';
}

function step(n) {
  ['step-1', 'step-2', 'step-3'].forEach((id, i) => ($(id).hidden = i + 1 !== n));
}

function showPay(p) {
  payment = p;
  document.title = `Payer ${p.n} – OM Direct`;
  $('pay-name').textContent = p.n;
  $('pay-name-2').textContent = p.n;
  const amount = formatAmount(p.a);
  $('pay-amount').textContent = amount;
  $('pay-desc').textContent = p.d;
  $('warn-name').textContent = p.n;
  $('sum-amount').textContent = `${amount} ${CONFIG.currency}`;
  $('sum-name').textContent = p.n;
  $('cauu-link').href = toTelUri(CONFIG.ussd.cauuRequest);
  $('cauu-block').hidden = !cauuRequired();
  $('chk').checked = false;
  refreshConfirm();
  step(1);
  show('view-pay');
}

function refreshConfirm() {
  const v = $('cauu').value;
  const okCauu = !cauuRequired() || cauuValid(v);
  $('confirm').disabled = !($('chk').checked && okCauu);
  $('e-cauu').textContent = v && !cauuValid(v) ? 'Le code ne semble pas valide. Vérifiez les chiffres reçus.' : '';
}
$('chk').addEventListener('change', refreshConfirm);
$('cauu').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); refreshConfirm(); });

$('pay-btn').addEventListener('click', () => step(2));
$('back').addEventListener('click', () => { wipeSecrets(); $('chk').checked = false; refreshConfirm(); step(1); });
$('fb-retry').addEventListener('click', () => { wipeSecrets(); $('chk').checked = false; refreshConfirm(); step(2); });

$('confirm').addEventListener('click', async () => {
  if (!payment) return;
  let number = payment.p;
  if (payment.id) {
    $('confirm').disabled = true;
    try { number = await getNumber(payment.id); } catch { number = null; }
    refreshConfirm();
    if (!/^\d{8,10}$/.test(number || '')) {
      $('e-cauu').textContent = 'Lien expiré ou connexion impossible. Réessayez.';
      return;
    }
  }
  const params = { number, amount: payment.a, cauu: $('cauu').value };
  let code;
  try {
    code = buildTransferCode(params);
  } catch (err) {
    $('e-cauu').textContent = err.message;
    return;
  }
  lastCode = code;
  $('fb-code').textContent = displayCode(params);
  $('cauu').value = '';
  clearTimeout(ttlTimer);
  ttlTimer = setTimeout(() => {
    lastCode = null;
    $('fb-code').textContent = 'Code expiré. Cliquez sur « Recommencer ».';
  }, CONFIG.ussd.cauuTtlMs);

  if (!isLikelyMobile()) return step(3); // pas de composeur : solution alternative directe
  location.href = toTelUri(code);
  // Si la page reste visible, le composeur ne s'est probablement pas ouvert.
  setTimeout(() => { if (document.visibilityState === 'visible' && lastCode) step(3); }, 1200);
});

$('fb-copy').addEventListener('click', async () => {
  if (!lastCode) return toast('Code expiré. Recommencez.');
  toast((await copyText(lastCode)) ? 'Code copié.' : 'Copie impossible : recopiez le code à la main.');
});

addEventListener('pagehide', wipeSecrets);
document.addEventListener('visibilitychange', () => {
  // Le téléphone a pris la main : on laisse l'écran de secours disponible au retour.
  if (document.visibilityState === 'visible' && lastCode && !$('step-2').hidden) step(3);
});

/* ---------- PWA ---------- */
let installEvent;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('install').hidden = true;
});
addEventListener('appinstalled', () => ($('install').hidden = true));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

route();
