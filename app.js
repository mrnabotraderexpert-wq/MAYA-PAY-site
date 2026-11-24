import { CONFIG } from './config.js';
import { validatePayment, parseHash, formatAmount } from './link.js';
import { serverReady, validId, validKey, createLink, getLink, startSession, confirmPayment, vendorStatus } from './api.js';
import { toTelUri, isLikelyMobile, operatorLabel } from './ussd.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'mayapay.vendor';
const views = ['view-desktop', 'view-vendor', 'view-track', 'view-pay', 'view-error'];

// Toutes les données venant du serveur ou d'un lien sont insérées avec textContent, jamais innerHTML.

/* ---------- Utilitaires ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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
  set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...store.get(), ...v })); } catch { /* stockage indisponible */ } },
  clear() { try { const { links } = store.get(); localStorage.setItem(STORE_KEY, JSON.stringify({ links: links || [] })); } catch { /* ignoré */ } },
};

function show(id) {
  views.forEach((v) => ($(v).hidden = v !== id));
  window.scrollTo(0, 0);
}

function invalid() {
  document.title = 'Lien invalide – MAYA-PAY';
  show('view-error');
}

const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* ---------- Routage par fragment ---------- */
let trackTimer;
const stopTrack = () => { clearInterval(trackTimer); trackTimer = null; };

function route() {
  wipeSecrets();
  stopTrack();
  if (!isLikelyMobile()) { document.title = 'MAYA-PAY'; return show('view-desktop'); } // téléphone uniquement
  if (!serverReady()) return invalid();
  const { path, params } = parseHash(location.hash);
  if (path === '/pay') return validId(params.get('i')) ? loadPay(params.get('i')) : invalid();
  if (path === '/suivi') return validId(params.get('i')) && validKey(params.get('k')) ? showTrack(params.get('i'), params.get('k')) : invalid();
  showVendor();
}
addEventListener('hashchange', route);

/* ---------- Vue vendeur ---------- */
const fields = { n: $('f-n'), po: $('f-po'), pm: $('f-pm'), a: $('f-a'), d: $('f-d'), h: $('f-h') };
for (const o of CONFIG.validity.options) fields.h.add(new Option(o.label, o.hours, false, o.hours === CONFIG.validity.default));
const validityLabel = (h) => CONFIG.validity.options.find((o) => o.hours === Number(h))?.label || '';
let lastLink = '';

function renderRecent() {
  const links = store.get().links || [];
  const ul = $('recent');
  ul.replaceChildren();
  for (const l of links) {
    if (!validId(l.id) || !validKey(l.key)) continue;
    const li = document.createElement('li');
    const info = document.createElement('span');
    const b = document.createElement('strong');
    b.textContent = `${formatAmount(Number(l.a))} ${CONFIG.currency}`;
    const small = document.createElement('small');
    small.textContent = `${String(l.n).slice(0, 40)} · ${fmtDate(l.t)}`;
    info.append(b, small);
    const a = document.createElement('a');
    a.className = 'btn secondary small';
    a.href = `#/suivi?i=${l.id}&k=${l.key}`;
    a.textContent = 'Suivre';
    li.append(info, a);
    ul.appendChild(li);
  }
  $('recent-box').hidden = !ul.children.length;
}

function showVendor() {
  document.title = 'MAYA-PAY – Liens de paiement Mobile Money';
  show('view-vendor');
  const saved = store.get();
  if (!fields.n.value && saved.n) fields.n.value = saved.n;
  if (!fields.po.value && saved.po) fields.po.value = saved.po;
  if (!fields.pm.value && saved.pm) fields.pm.value = saved.pm;
  if (saved.h && validityLabel(saved.h)) fields.h.value = saved.h;
  $('forget').hidden = !(saved.n || saved.po || saved.pm);
  renderRecent();
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
  $('form-err').textContent = '';
  const r = validatePayment({ n: fields.n.value, po: fields.po.value, pm: fields.pm.value, a: fields.a.value, d: fields.d.value, h: fields.h.value });
  setErrors(r.errors);
  if (!r.ok) return;

  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  const submit = e.submitter;
  if (submit) submit.disabled = true;
  let created;
  try {
    created = await createLink(r.value);
    if (!created || !validId(created.id) || !validKey(created.key)) throw new Error('bad response');
  } catch {
    $('form-err').textContent = 'Connexion impossible. Réessayez.';
    return;
  } finally {
    if (submit) submit.disabled = false;
  }

  const link = `${base}#/pay?i=${created.id}`;
  lastLink = link;
  const links = [{ id: created.id, key: created.key, n: r.value.n, a: r.value.a, t: Date.now() }, ...(store.get().links || [])].slice(0, 10);
  store.set({ n: r.value.n, po: r.value.po, pm: r.value.pm, h: r.value.h, links });
  $('forget').hidden = false;
  renderRecent();

  const amount = `${formatAmount(r.value.a)} ${CONFIG.currency}`;
  $('r-summary').textContent = r.value.d ? `${amount} – ${r.value.d}` : amount;
  $('r-expiry').textContent = `Valable ${validityLabel(r.value.h)}`;
  $('r-link').value = link;

  const msg = `Bonjour, voici votre lien de paiement MAYA-PAY pour ${r.value.n} : ${amount}${r.value.d ? ` (${r.value.d})` : ''}.\n${link}\nPremier paiement : testez avec un petit montant.`;
  $('r-wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('r-sms').href = 'sms:?&body=' + encodeURIComponent(msg);
  $('r-track').href = `#/suivi?i=${created.id}&k=${created.key}`;
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
  fields.n.value = ''; fields.po.value = ''; fields.pm.value = '';
  $('forget').hidden = true;
  toast('Nom et numéros effacés de cet appareil.');
});

/* ---------- Suivi vendeur ---------- */
const REASON_CHECK = {
  recipient_partial: 'Montant correct, numéro du bénéficiaire partiellement lisible.',
  recipient_not_found: 'Montant correct, mais le bénéficiaire n’apparaît pas dans le message.',
};

function renderProofs(proofs) {
  const ul = $('t-list');
  ul.replaceChildren();
  for (const p of proofs) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'proof-head';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (p.status === 'confirmed' ? 'ok' : 'warn');
    badge.textContent = p.status === 'confirmed' ? 'Confirmé' : 'À vérifier';
    const meta = document.createElement('small');
    meta.textContent = [operatorLabel(p.operator), fmtDate(p.at)].filter(Boolean).join(' · ');
    head.append(badge, meta);
    li.appendChild(head);
    if (p.status !== 'confirmed' && REASON_CHECK[p.reason]) {
      const why = document.createElement('p');
      why.className = 'why';
      why.textContent = REASON_CHECK[p.reason];
      li.appendChild(why);
    }
    const pre = document.createElement('pre');
    pre.className = 'sms';
    pre.textContent = String(p.message);
    li.appendChild(pre);
    ul.appendChild(li);
  }
}

async function refreshTrack(id, key) {
  let s;
  try {
    s = await vendorStatus(id, key);
  } catch (err) {
    if (err.code === 'forbidden') { stopTrack(); return invalid(); }
    $('t-state').textContent = 'Connexion impossible. Nouvel essai automatique…';
    return;
  }
  if (!location.hash.includes(id) || !s) return; // la navigation a changé pendant l'attente
  $('t-name').textContent = String(s.n);
  $('t-amount').textContent = formatAmount(Number(s.a));
  $('t-desc').textContent = String(s.d || '');
  const proofs = Array.isArray(s.proofs) ? s.proofs : [];
  renderProofs(proofs);
  const st = $('t-state');
  const confirmed = proofs.some((p) => p.status === 'confirmed');
  st.className = 'state ' + (confirmed ? 'ok' : proofs.length ? 'warn' : '');
  st.textContent = confirmed
    ? 'Paiement reçu : le message de confirmation correspond.'
    : proofs.length
      ? 'Un message a été reçu : vérifiez-le sur votre compte.'
      : 'En attente du paiement du client…';
}

async function showTrack(id, key) {
  document.title = 'Suivi du paiement – MAYA-PAY';
  for (const k of ['t-name', 't-amount', 't-desc', 't-state']) $(k).textContent = '';
  $('t-list').replaceChildren();
  show('view-track');
  await refreshTrack(id, key);
  if (!location.hash.includes(id)) return;
  trackTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshTrack(id, key); }, CONFIG.trackRefreshSeconds * 1000);
}

/* ---------- Vue client ---------- */
// Le numéro du vendeur et la formule USSD n'existent pas dans cette page : le serveur remet
// le code complet uniquement à l'ouverture d'une session (2 minutes), gardé en mémoire seulement.
let payment = null;
let session = null; // { code, op, deadline, total }
let lastOp = '';
let tick;

function wipeSecrets() {
  clearInterval(tick);
  tick = null;
  session = null;
}

function step(n) {
  [1, 2, 3, 4].forEach((i) => ($('step-' + i).hidden = i !== n));
}

/* Choix de l'opération : un bouton par opérateur configuré par le vendeur, affichés directement sur la page */
const opsBox = $('ops');
// Seuls les opérateurs pour lesquels le vendeur a saisi un numéro sont proposés (liste donnée par le serveur).
function renderOps() {
  opsBox.replaceChildren();
  const avail = Array.isArray(payment?.ops) ? payment.ops : CONFIG.operators.map((o) => o.id);
  for (const o of CONFIG.operators.filter((x) => avail.includes(x.id))) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn op op-${o.id} block big`;
    b.dataset.op = o.id;
    b.textContent = `Payer avec ${o.label}`;
    opsBox.appendChild(b);
  }
}
const setOpsDisabled = (v) => opsBox.querySelectorAll('button').forEach((b) => (b.disabled = v));
opsBox.addEventListener('click', (e) => {
  const op = e.target.closest('button[data-op]')?.dataset.op;
  if (op) pay(op);
});

function showVerdict(kind, title, text) {
  const v = $('verdict');
  v.className = 'verdict ' + kind;
  v.replaceChildren();
  const h = document.createElement('strong');
  h.textContent = title;
  v.appendChild(h);
  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    v.appendChild(p);
  }
  v.hidden = false;
}

function showPay(p) {
  payment = p;
  lastOp = '';
  document.title = `Payer ${p.n} – MAYA-PAY`;
  $('pay-name').textContent = p.n;
  $('pay-name-2').textContent = p.n;
  $('pay-amount').textContent = formatAmount(p.a);
  $('pay-desc').textContent = p.d;
  $('warn-name').textContent = p.n;
  $('sms').value = '';
  $('sms').disabled = false;
  $('verify').hidden = false;
  $('verdict').hidden = true;
  renderOps();
  step(1);
  show('view-pay');
}

async function loadPay(id) {
  let o = null;
  try { o = await getLink(id); } catch { toast('Connexion impossible. Réessayez.'); }
  if (!location.hash.includes(id)) return; // la navigation a changé pendant l'attente
  if (o && o.n) return showPay({ id, n: String(o.n), a: Number(o.a), d: String(o.d || ''), ops: Array.isArray(o.ops) ? o.ops.map(String) : undefined });
  invalid();
}

$('reopen').addEventListener('click', () => step(1));

async function pay(op) {
  if (!payment) return;
  setOpsDisabled(true);
  let r;
  try {
    r = await startSession(payment.id, op);
  } catch (err) {
    setOpsDisabled(false);
    return toast(err.code === 'rate_limited' ? 'Trop de tentatives sur ce lien. Réessayez plus tard.' : err.code === 'operator_unavailable' ? 'Ce vendeur n’accepte pas cet opérateur.' : 'Lien expiré ou connexion impossible. Réessayez.');
  }
  setOpsDisabled(false);
  if (!r || !/^[0-9*#]+$/.test(String(r.code))) return toast('Réponse invalide. Réessayez.');
  const total = Math.min(Number(r.ttl) || 120, 120);
  lastOp = op;
  session = { code: r.code, op, deadline: Date.now() + total * 1000, total };
  $('op-name').textContent = operatorLabel(op);
  step(2);
  startTick();
  dial();
}

// Un site web ne peut pas lancer l'appel lui-même : le lien tel: ouvre le composeur avec le code
// déjà saisi, le client appuie sur appeler. Sur un téléphone à deux SIM, c'est le téléphone qui demande la SIM.
function dial() {
  if (!session) return;
  location.href = toTelUri(session.code);
}
$('redial').addEventListener('click', dial);

function startTick() {
  clearInterval(tick);
  const update = () => {
    if (!session) return;
    const left = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
    $('countdown').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    $('bar').style.width = `${(left / session.total) * 100}%`;
    if (left <= 0) closeSession();
  };
  update();
  tick = setInterval(update, 500);
}

// Fin des 2 minutes : le code est effacé et la session se ferme. Le client peut en rouvrir une.
function closeSession() {
  const watching = !$('step-2').hidden;
  wipeSecrets();
  if (watching) step(3);
  try { window.close(); } catch { /* seule une page ouverte par script peut se fermer */ }
}
document.addEventListener('visibilitychange', () => {
  if (session && document.visibilityState === 'visible') startTick(); // le téléphone a pu mettre la page en veille
});

/* Confirmation par SMS */
const goConfirm = () => { $('verdict').hidden = true; step(4); $('sms').focus(); };
$('go-confirm-1').addEventListener('click', goConfirm);
$('go-confirm-2').addEventListener('click', goConfirm);
$('go-confirm-3').addEventListener('click', goConfirm);
$('back-confirm').addEventListener('click', () => step(session ? 2 : 1));

const REASONS = {
  too_short: 'Le message est trop court. Collez le SMS complet.',
  failure_message: 'Ce message indique que le paiement a échoué : rien n’est confirmé.',
  received_message: 'Ce message annonce une réception d’argent. Collez le SMS reçu après l’envoi de votre paiement.',
  not_a_confirmation: 'Ce message ne ressemble pas à une confirmation de transfert Orange Money ou Moov Money.',
  amount_mismatch: 'Le montant du message ne correspond pas au montant demandé.',
  already_used: 'Ce message a déjà été utilisé pour un paiement.',
};
const ERRORS = {
  no_session: 'Ouvrez d’abord le paiement avec le bouton « Payer ».',
  rate_limited: 'Trop d’essais. Réessayez plus tard.',
  invalid_link: 'Lien expiré ou invalide.',
};

$('verify').addEventListener('click', async () => {
  if (!payment) return;
  const msg = $('sms').value.trim();
  if (msg.length < 20) return showVerdict('bad', 'Message incomplet', 'Collez le SMS complet reçu d’Orange Money ou de Moov Money.');
  $('verify').disabled = true;
  let r;
  try {
    r = await confirmPayment(payment.id, lastOp, msg);
  } catch (err) {
    return showVerdict('bad', 'Vérification impossible', ERRORS[err.code] || 'Connexion impossible. Réessayez.');
  } finally {
    $('verify').disabled = false;
  }
  if (r?.status === 'confirmed') {
    $('sms').disabled = true;
    $('verify').hidden = true;
    showVerdict('ok', 'Paiement confirmé', 'Le message correspond. Le vendeur est informé et verra votre message.');
  } else if (r?.status === 'check') {
    $('sms').disabled = true;
    $('verify').hidden = true;
    showVerdict('warn', 'Message transmis au vendeur', 'Le montant correspond, mais le bénéficiaire n’a pas pu être lu dans le message. Le vendeur a reçu votre message et va vérifier sur son compte.');
  } else {
    showVerdict('bad', 'Paiement non confirmé', REASONS[r?.reason] || 'Message non reconnu.');
  }
});

addEventListener('pagehide', wipeSecrets);

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
