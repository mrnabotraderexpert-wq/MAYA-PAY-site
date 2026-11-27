import { CONFIG } from './config.js';
import { validatePayment, validatePayer, parseHash, formatAmount, normalizeNumber } from './link.js';
import { adsPublic, serverReady, validId, validKey, createLink, getLink, startSession, CONSENT_VERSION, smsResult, vendorStatus, subInfo, subOrder } from './api.js';
import { toTelUri, isLikelyMobile, operatorLabel } from './ussd.js';
import { drawQr } from './qr.js';
import { setupCart } from './cart.js';
import { initExpress } from './express.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'mayapay.vendor';
const views = ['view-desktop', 'view-vendor', 'view-track', 'view-pay', 'view-shop', 'view-orders', 'view-error'];

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
  clear() { try { const { links, express } = store.get(); localStorage.setItem(STORE_KEY, JSON.stringify({ links: links || [], express })); } catch { /* ignoré */ } },
};

function show(id) {
  views.forEach((v) => ($(v).hidden = v !== id));
  window.scrollTo(0, 0);
  // Application Android : l'espace vendeur est protégé par le verrou du téléphone.
  try { window.MayaNative?.setScreen?.(id); } catch { /* ignoré */ }
}

// Photo / logo : recadrée en carré, réduite et convertie en JPEG sur le téléphone, puis stockée côté serveur avec le lien.
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const safePhoto = (p) => (typeof p === 'string' && p.length <= CONFIG.photo.maxChars + 2000 && PHOTO_RE.test(p) ? p : '');
function setAvatar(img, src) {
  const ok = safePhoto(src);
  if (ok) img.src = ok; else img.removeAttribute('src');
  img.hidden = !ok;
}
async function makeAvatar(file) {
  let src;
  if (window.createImageBitmap) {
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* repli ci-dessous */ }
  }
  if (!src) {
    const url = URL.createObjectURL(file);
    try {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url; });
    } finally { URL.revokeObjectURL(url); }
  }
  const sw = src.width, sh = src.height;
  if (!sw || !sh) throw new Error('decode');
  const crop = Math.min(sw, sh);
  for (const [side, q] of [[CONFIG.photo.side, 0.8], [CONFIG.photo.side, 0.65], [192, 0.6], [160, 0.5], [128, 0.5]]) {
    const c = document.createElement('canvas');
    c.width = c.height = side;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side);
    ctx.drawImage(src, (sw - crop) / 2, (sh - crop) / 2, crop, crop, 0, 0, side, side);
    const data = c.toDataURL('image/jpeg', q);
    if (PHOTO_RE.test(data) && data.length <= CONFIG.photo.maxChars) { if (src.close) src.close(); return data; }
  }
  if (src.close) src.close();
  throw new Error('too_big');
}

function invalid() {
  document.title = 'Lien invalide – MAYA-PAY';
  show('view-error');
}

const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* ---------- Routage par fragment ---------- */
let trackTimer;
let lastSig = '';
const stopTrack = () => { clearInterval(trackTimer); trackTimer = null; lastSig = ''; };

function route() {
  wipeSecrets();
  stopPoll();
  stopTrack();
  express.stop();
  if (!isLikelyMobile()) { document.title = 'MAYA-PAY – Liens de paiement Orange Money et Moov Money au Mali'; return show('view-desktop'); } // téléphone uniquement
  if (!serverReady()) return invalid();
  const { path, params } = parseHash(location.hash);
  if (path === '/pay') return validId(params.get('i')) ? loadPay(params.get('i')) : invalid();
  if (path === '/express') return validId(params.get('s')) ? express.openShop(params.get('s')) : invalid();
  if (path === '/commandes') return express.openOrders();
  if (path === '/suivi') return validId(params.get('i')) && validKey(params.get('k')) ? showTrack(params.get('i'), params.get('k')) : invalid();
  showVendor();
}
addEventListener('hashchange', route);

/* ---------- Vue vendeur ---------- */
const fields = { n: $('f-n'), po: $('f-po'), pm: $('f-pm'), a: $('f-a'), d: $('f-d'), h: $('f-h') };
for (const o of CONFIG.validity.options) fields.h.add(new Option(o.label, o.hours, false, o.hours === CONFIG.validity.default));
const validityLabel = (h) => CONFIG.validity.options.find((o) => o.hours === Number(h))?.label || '';
let lastLink = '';
let vendorPhoto = '';

function renderPhoto() {
  setAvatar($('photo-preview'), vendorPhoto);
  $('photo-empty').hidden = Boolean(safePhoto(vendorPhoto));
  $('photo-remove').hidden = !safePhoto(vendorPhoto);
  $('photo-pick-text').textContent = vendorPhoto ? 'Changer la photo' : 'Choisir une photo';
}
$('f-photo').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  $('e-photo').textContent = '';
  if (!file) return;
  if (!/^image\//.test(file.type)) { $('e-photo').textContent = 'Choisissez une image.'; return; }
  $('photo-pick-text').textContent = 'Préparation…';
  try {
    vendorPhoto = await makeAvatar(file);
    store.set({ photo: vendorPhoto });
  } catch {
    $('e-photo').textContent = 'Cette image ne peut pas être utilisée. Essayez une autre photo.';
  }
  renderPhoto();
});
$('photo-remove').addEventListener('click', () => { vendorPhoto = ''; store.set({ photo: '' }); renderPhoto(); });

// Application Android : le téléphone surveille les liens récents du vendeur et le prévient d'un nouveau paiement,
// même application fermée (pas de Firebase). Seuls l'identifiant et la clé de suivi sont transmis à l'application.
function syncNativeWatch() {
  try {
    if (typeof window.MayaNative?.watchLinks !== 'function') return;
    const list = (store.get().links || [])
      .filter((l) => l && validId(l.id) && validKey(l.key))
      .slice(0, 10)
      .map((l) => ({ id: l.id, key: l.key, n: String(l.n || '').slice(0, 40), t: Number(l.t) || Date.now() }));
    window.MayaNative.watchLinks(JSON.stringify(list));
  } catch { /* ignoré */ }
}

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

/* ---------- Panneau publicitaire (config.js > ads) ---------- */
function safeAdUrl(u) {
  try {
    const x = new URL(String(u || ''), location.href);
    return x.protocol === 'https:' ? x.href : '';
  } catch { return ''; }
}
function safeAdImage(u) {
  const v = String(u || '');
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 90000 ? v : '';
}
let adSeq = 0;
async function renderAd() {
  const box = $('ad-panel');
  const seq = ++adSeq;
  box.hidden = true;
  if (!CONFIG.ads || !CONFIG.ads.enabled) return;
  let ad = null;
  try { ad = await adsPublic(); } catch { return; }   // hors ligne ou serveur indisponible : pas de panneau
  if (seq !== adSeq || !ad || typeof ad !== 'object' || !ad.title || $('view-vendor').hidden) return;
  $('ad-title').textContent = String(ad.title).slice(0, 60);
  const txt = $('ad-text');
  txt.textContent = String(ad.text || '').slice(0, 160);
  txt.hidden = !txt.textContent;
  const img = $('ad-img');
  const src = safeAdImage(ad.image);
  if (src) { img.src = src; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
  const cta = $('ad-cta');
  const url = safeAdUrl(ad.url);
  if (url && ad.cta) { cta.href = url; cta.textContent = String(ad.cta).slice(0, 30); cta.hidden = false; } else { cta.hidden = true; cta.removeAttribute('href'); }
  box.hidden = false;
}

function showVendor() {
  document.title = 'MAYA-PAY – Liens de paiement Orange Money et Moov Money au Mali';
  show('view-vendor');
  const saved = store.get();
  if (!fields.n.value && saved.n) fields.n.value = saved.n;
  if (!fields.po.value && saved.po) fields.po.value = saved.po;
  if (!fields.pm.value && saved.pm) fields.pm.value = saved.pm;
  if (saved.h && validityLabel(saved.h)) fields.h.value = saved.h;
  vendorPhoto = safePhoto(saved.photo);
  renderPhoto();
  $('forget').hidden = !(saved.n || saved.po || saved.pm || vendorPhoto);
  renderRecent();
  refreshSub();
  renderAd();
  express.render();
}

const cart = setupCart();
const express = initExpress({ store, fields, show, invalid, toast, copyText, fmtDate, setAvatar, refreshSub, getPhoto: () => safePhoto(vendorPhoto) });

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
  const basket = cart.check();
  if (!basket.ok) return;
  const r = validatePayment({ n: fields.n.value, po: fields.po.value, pm: fields.pm.value, a: fields.a.value, d: fields.d.value, h: fields.h.value });
  setErrors(r.errors);
  if (!r.ok) return;

  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  const submit = e.submitter;
  if (submit) submit.disabled = true;
  let created;
  try {
    created = await createLink({ ...r.value, ph: safePhoto(vendorPhoto) });
    if (!created || !validId(created.id) || !validKey(created.key)) throw new Error('bad response');
  } catch (err) {
    if (err && err.code === 'license_required') {
      $('form-err').textContent = 'Votre licence est expirée : abonnez-vous pour créer de nouveaux liens. Vos anciens liens et votre historique sont conservés.';
      refreshSub();
      $('sub-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      $('form-err').textContent = 'Connexion impossible. Réessayez.';
    }
    return;
  } finally {
    if (submit) submit.disabled = false;
  }

  const link = `${base}#/pay?i=${created.id}`;
  lastLink = link;
  const links = [{ id: created.id, key: created.key, n: r.value.n, a: r.value.a, t: Date.now() }, ...(store.get().links || [])].slice(0, 10);
  store.set({ n: r.value.n, po: r.value.po, pm: r.value.pm, h: r.value.h, links });
  syncNativeWatch();
  $('forget').hidden = false;
  renderRecent();

  const amount = `${formatAmount(r.value.a)} ${CONFIG.currency}`;
  $('r-summary').textContent = r.value.d ? `${amount} – ${r.value.d}` : amount;
  $('r-expiry').textContent = `Valable ${validityLabel(r.value.h)}`;
  $('r-link').value = link;
  // QR code du lien : le client peut le scanner avec l'application MAYA-PAY ou l'appareil photo.
  const qrOk = drawQr($('r-qr'), link);
  $('qr-box').hidden = !qrOk;
  $('r-qr-dl').hidden = !qrOk || inApp();

  const msg = `Bonjour, voici votre lien de paiement MAYA-PAY pour ${r.value.n} : ${amount}${basket.detail ? `.\n${basket.detail}` : r.value.d ? ` (${r.value.d}).` : '.'}\n${link}\nPremier paiement : testez avec un petit montant.`;
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
$('r-qr-dl').addEventListener('click', () => {
  $('r-qr').toBlob((blob) => {
    if (!blob) return toast('Téléchargement impossible.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'maya-pay-qr.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
});

$('r-new').addEventListener('click', () => {
  cart.reset();
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
  vendorPhoto = '';
  store.set({ photo: '' });
  renderPhoto();
  $('forget').hidden = true;
  toast('Nom, photo et numéros effacés de cet appareil.');
  refreshSub();
});

/* ---------- Abonnement du vendeur ---------- */
// Le prix, la durée, l'accès gratuit et le numéro marchand sont réglés par l'administrateur (admin.html).
// La licence est attribuée par le serveur seulement après la confirmation automatique du paiement par SMS.
let subSeq = 0;
let subTimer;
const daysLabel = (d) => ({ 30: '30 jours', 90: '3 mois', 180: '6 mois', 365: '1 an' }[d] || `${d} jours`);
const fmtDay = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
function vendorPhones() {
  const { min, max } = CONFIG.numberDigits;
  const ok = (x) => x.length >= min && x.length <= max;
  const po = normalizeNumber(fields.po.value);
  const pm = normalizeNumber(fields.pm.value);
  return { po: ok(po) ? po : '', pm: ok(pm) ? pm : '' };
}

function renderSub(info) {
  const status = $('sub-status');
  const btn = $('sub-btn');
  $('sub-err').textContent = '';
  if (!info || typeof info !== 'object') {
    status.className = 'sub-status';
    status.textContent = 'Informations d’abonnement indisponibles. Vérifiez votre connexion.';
    $('sub-price').textContent = '…'; $('sub-days').textContent = '…';
    $('sub-exp-row').hidden = true; $('sub-note').textContent = ''; btn.hidden = true;
    return;
  }
  const { po, pm } = vendorPhones();
  const hasNumber = Boolean(po || pm);
  $('sub-price').textContent = `${formatAmount(Number(info.price))} ${CONFIG.currency}`;
  $('sub-days').textContent = daysLabel(Number(info.days));
  const expRow = $('sub-exp-row');
  let cls = '', text = '', note = '', label = 'S’abonner', canPay = Boolean(info.available);
  if (hasNumber && info.has_license) {
    $('sub-exp').textContent = fmtDay(info.expires_at);
    expRow.hidden = false;
    if (info.suspended) { cls = 'bad'; text = 'Licence suspendue par l’administrateur.'; note = 'Contactez le support MAYA-PAY pour la réactiver.'; canPay = false; }
    else if (info.active) { cls = 'ok'; text = 'Licence active.'; label = 'Renouveler mon abonnement'; note = 'Un renouvellement s’ajoute à la durée qu’il vous reste.'; }
    else { cls = 'bad'; text = 'Licence expirée.'; label = 'Renouveler mon abonnement'; note = info.free ? '' : 'Vous ne pouvez plus créer de nouveaux liens ni utiliser Maya Express. Vos anciens liens, vos commandes et votre historique sont conservés.'; }
  } else {
    expRow.hidden = true;
    if (!hasNumber) { text = info.free ? 'Accès gratuit actuellement.' : 'Saisissez votre numéro Orange Money ou Moov Money pour voir l’état de votre licence.'; }
    else { cls = info.free ? 'ok' : 'bad'; text = info.free ? 'Accès gratuit actuellement.' : 'Aucune licence pour ce numéro.'; if (!info.free) note = 'Un abonnement est nécessaire pour créer des liens de paiement et votre vitrine Maya Express.'; }
  }
  if (info.free) note = ['Accès gratuit activé par l’administrateur : l’abonnement n’est pas obligatoire pour le moment.', note].filter(Boolean).join(' ');
  if (!info.available && !info.suspended) note = (note ? note + ' ' : '') + 'Le paiement de l’abonnement n’est pas encore disponible.';
  status.className = 'sub-status ' + cls;
  status.textContent = text;
  $('sub-note').textContent = note;
  $('sub-btn-text').textContent = label;
  btn.hidden = !canPay;
}

async function refreshSub() {
  const seq = ++subSeq;
  const { po, pm } = vendorPhones();
  let info = null;
  try { info = await subInfo(po, pm); } catch { /* affichage de repli */ }
  if (seq !== subSeq || $('view-vendor').hidden) return; // une saisie plus récente a pris le relais
  renderSub(info);
}
for (const k of ['po', 'pm']) {
  fields[k].addEventListener('input', () => { clearTimeout(subTimer); subTimer = setTimeout(refreshSub, 600); });
}

$('sub-btn').addEventListener('click', async () => {
  const { po, pm } = vendorPhones();
  const phone = po || pm;
  const err = $('sub-err');
  err.textContent = '';
  if (!phone) {
    err.textContent = 'Saisissez d’abord votre numéro Orange Money ou Moov Money dans le formulaire ci-dessous.';
    return (po ? fields.pm : fields.po).focus();
  }
  const btn = $('sub-btn');
  btn.disabled = true;
  let o;
  try {
    o = await subOrder(phone);
    if (!o || !validId(o.id)) throw new Error('bad response');
  } catch (e) {
    err.textContent = e.code === 'subscription_unavailable' ? 'L’abonnement n’est pas encore disponible.'
      : e.code === 'rate_limited' ? 'Trop de demandes. Réessayez dans une heure.'
      : e.code === 'invalid_number' ? 'Numéro invalide.'
      : 'Connexion impossible. Réessayez.';
    return;
  } finally {
    btn.disabled = false;
  }
  location.hash = `#/pay?i=${o.id}`; // même parcours de paiement et même vérification automatique que les autres liens
});

/* ---------- Suivi vendeur ---------- */
const REASON_CHECK = {
  sender_unverified: 'Montant, bénéficiaire et transaction corrects, mais le numéro de l’expéditeur n’a pas pu être vérifié (ni dans le SMS, ni par la SIM). Contrôlez sur votre compte avant de livrer.',
  format_unverified: 'SMS d’un format non validé automatiquement. Contrôlez sur votre compte avant de livrer.',
};
const SENDER_SRC = { sms: 'lu dans le SMS', sim: 'numéro de la SIM' };

function line(label, value) {
  const p = document.createElement('p');
  p.className = 'detail';
  const b = document.createElement('strong');
  b.textContent = label + ' ';
  p.append(b, document.createTextNode(value));
  return p;
}

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
    meta.textContent = [operatorLabel(p.operator), fmtDate(p.received_at || p.at)].filter(Boolean).join(' · ');
    head.append(badge, meta);
    li.appendChild(head);
    if (p.status !== 'confirmed' && REASON_CHECK[p.reason]) {
      const why = document.createElement('p');
      why.className = 'why';
      why.textContent = REASON_CHECK[p.reason];
      li.appendChild(why);
    }
    const num = (x) => (/^[0-9]{8,10}$/.test(String(x ?? '')) ? String(x) : '');
    if (p.amount != null && Number.isFinite(Number(p.amount))) li.appendChild(line('Montant :', `${formatAmount(Number(p.amount))} ${CONFIG.currency}`));
    if (num(p.payer)) li.appendChild(line('Numéro déclaré par le client :', num(p.payer)));
    if (num(p.sender)) li.appendChild(line('Expéditeur détecté :', `${num(p.sender)}${SENDER_SRC[p.sender_source] ? ` (${SENDER_SRC[p.sender_source]})` : ''}`));
    if (/^[A-Za-z0-9.\-]{6,40}$/.test(String(p.tx_id ?? ''))) li.appendChild(line('Transaction :', String(p.tx_id)));
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
  setAvatar($('t-photo'), s.p);
  $('t-amount').textContent = formatAmount(Number(s.a));
  $('t-desc').textContent = String(s.d || '');
  const proofs = Array.isArray(s.proofs) ? s.proofs : [];
  // Ne reconstruit la liste que si elle a changé (évite de recharger les captures toutes les 10 s).
  const sig = JSON.stringify(proofs.map((p) => [p.id, p.status, p.reason, p.sender]));
  if (sig !== lastSig) { lastSig = sig; renderProofs(proofs); }
  const st = $('t-state');
  const confirmed = proofs.some((p) => p.status === 'confirmed');
  st.className = 'state ' + (confirmed ? 'ok' : proofs.length ? 'warn' : '');
  st.textContent = confirmed
    ? 'Paiement confirmé automatiquement : le SMS du client correspond.'
    : proofs.length
      ? 'Paiement détecté mais à vérifier : contrôlez-le sur votre compte.'
      : 'En attente du paiement du client…';
}

async function showTrack(id, key) {
  document.title = 'Suivi du paiement – MAYA-PAY';
  for (const k of ['t-name', 't-amount', 't-desc', 't-state']) $(k).textContent = '';
  $('t-list').replaceChildren();
  setAvatar($('t-photo'), '');
  lastSig = '';
  show('view-track');
  await refreshTrack(id, key);
  if (!location.hash.includes(id)) return;
  trackTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshTrack(id, key); }, CONFIG.trackRefreshSeconds * 1000);
}

/* ---------- Vue client ---------- */
// Le numéro du vendeur et la formule USSD n'existent pas dans cette page : le serveur remet
// le code complet uniquement à l'ouverture d'une session (2 minutes), gardé en mémoire seulement.
// La confirmation est 100 % automatique : l'application Android lit le SMS de l'opérateur, le serveur le vérifie
// (montant, bénéficiaire, numéro expéditeur, transaction unique) et la page affiche le résultat.
let payment = null;
let session = null; // { code, op, deadline, total, sms }
let chosenOp = '';
let tick;
let pollTimer;

function wipeSecrets() {
  clearInterval(tick);
  tick = null;
  session = null;
}

function step(n) {
  [1, 2, 3].forEach((i) => ($('step-' + i).hidden = i !== n));
}

const inApp = () => Boolean(window.MayaNative && typeof window.MayaNative.dial === 'function');
const needsApp = () => Boolean(CONFIG.app?.required) && /Android/i.test(navigator.userAgent) && !inApp();

/* Choix de l'opérateur, puis saisie du numéro qui envoie l'argent */
const opsBox = $('ops');
function renderOps() {
  opsBox.replaceChildren();
  const avail = Array.isArray(payment?.ops) ? payment.ops : CONFIG.operators.map((o) => o.id);
  for (const o of CONFIG.operators.filter((x) => avail.includes(x.id))) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn op op-${o.id} block big`;
    b.dataset.op = o.id;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = o.label;
    opsBox.appendChild(b);
  }
}
// Dans l'application : le paiement est bloqué tant que la lecture des SMS n'est pas autorisée (sinon pas de confirmation automatique).
const smsOk = () => {
  if (!inApp() || typeof window.MayaNative.smsReady !== 'function') return true;
  try { return Boolean(window.MayaNative.smsReady()); } catch { return true; }
};
let opsBusy = false;
function refreshSmsGate() {
  const ok = smsOk();
  const g = $('sms-gate');
  if (g) g.hidden = ok;
  $('go-pay').disabled = opsBusy || !ok;
}
window.onMayaSms = () => refreshSmsGate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshSmsGate(); });
const setOpsDisabled = (v) => { opsBusy = v; opsBox.querySelectorAll('button').forEach((b) => (b.disabled = v)); refreshSmsGate(); };

function chooseOp(op) {
  chosenOp = op;
  opsBox.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.op === op;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('l-payer').textContent = `Votre numéro ${operatorLabel(op)} (celui qui envoie l’argent)`;
  $('go-pay').textContent = `Payer avec ${operatorLabel(op)}`;
  $('e-payer').textContent = '';
  $('payer-box').hidden = false;
  refreshSmsGate();
  $('f-payer').focus({ preventScroll: true });
}
opsBox.addEventListener('click', (e) => {
  const op = e.target.closest('button[data-op]')?.dataset.op;
  if (op) chooseOp(op);
});
$('go-pay').addEventListener('click', () => pay(chosenOp));
$('sms-allow')?.addEventListener('click', () => { try { window.MayaNative.askSms?.(); } catch { /* ignoré */ } });

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

// Sur Android, hors de l'application : le paiement passerait par le composeur (code et numéro visibles).
function applyGate() {
  const need = needsApp();
  $('app-gate').hidden = !need;
  opsBox.hidden = need;
  $('choose-label').hidden = need;
  if (need) $('payer-box').hidden = true;
  if (!need) return;
  $('apk-link').href = CONFIG.app.apkUrl;
  const rest = location.host + location.pathname + location.search + location.hash;
  $('app-open').href = `intent://${rest}#Intent;scheme=https;package=${CONFIG.app.androidPackage};end`;
}

function showPay(p) {
  payment = p;
  chosenOp = '';
  document.title = `Payer ${p.n} – MAYA-PAY`;
  $('pay-name').textContent = p.n;
  setAvatar($('pay-photo'), p.p);
  $('pay-name-2').textContent = p.n;
  $('pay-amount').textContent = formatAmount(p.a);
  $('pay-desc').textContent = p.d;
  $('warn-name').textContent = p.n;
  $('f-payer').value = store.get().payer || '';
  $('e-payer').textContent = '';
  const cs = store.get().consent;
  $('f-consent').checked = Boolean(cs && cs.v === CONSENT_VERSION);
  renderConsentNote();
  $('e-consent').textContent = '';
  $('payer-box').hidden = true;
  hideOutcome();
  $('sub-back').href = '#/';
  $('sub-back').hidden = p.k !== 'subscription';
  renderOps();
  applyGate();
  step(1);
  show('view-pay');
}

async function loadPay(id) {
  let o = null;
  try { o = await getLink(id); } catch { toast('Connexion impossible. Réessayez.'); }
  if (!location.hash.includes(id)) return; // la navigation a changé pendant l'attente
  if (o && o.n) return showPay({ id, n: String(o.n), a: Number(o.a), d: String(o.d || ''), p: safePhoto(o.p), k: o.k === 'subscription' ? 'subscription' : 'sale', ops: Array.isArray(o.ops) ? o.ops.map(String) : undefined });
  invalid();
}

// Consentement mémorisé sur le téléphone (version de la politique + date) : le client ne recoche pas à chaque paiement.
// Décocher le retire ; une nouvelle version de la politique le redemande.
function renderConsentNote() {
  const cs = store.get().consent;
  const ok = $('f-consent').checked && cs && cs.v === CONSENT_VERSION;
  const note = $('c-saved');
  note.hidden = !ok;
  if (ok) note.textContent = 'Déjà accepté le ' + new Date(cs.at).toLocaleDateString('fr-FR') + '. Décochez pour retirer votre accord.';
}
$('f-consent').addEventListener('change', () => {
  if ($('f-consent').checked) $('e-consent').textContent = '';
  else store.set({ consent: null });
  renderConsentNote();
});
$('reopen').addEventListener('click', () => { stopPoll(); disarmNative(); hideOutcome(); step(1); });

async function pay(op) {
  if (!payment || needsApp() || !op) return;
  if (!smsOk()) { // sécurité : même si le bouton est contourné, pas de paiement sans lecture des SMS
    refreshSmsGate();
    try { window.MayaNative.askSms?.(); } catch { /* ignoré */ }
    return toast('Autorisez la lecture des SMS pour pouvoir payer.');
  }
  const payer = validatePayer($('f-payer').value);
  if (!payer.ok) {
    $('e-payer').textContent = 'Saisissez le numéro avec lequel vous envoyez l’argent (8 chiffres).';
    $('f-payer').setAttribute('aria-invalid', 'true');
    $('f-payer').focus();
    return;
  }
  $('e-payer').textContent = '';
  $('f-payer').setAttribute('aria-invalid', 'false');
  if (!$('f-consent').checked) {
    $('e-consent').textContent = 'Cochez la case pour confirmer avant de payer.';
    $('f-consent').focus();
    return;
  }
  $('e-consent').textContent = '';
  hideOutcome();
  const prev = store.get().consent;
  store.set({ payer: payer.value, consent: prev && prev.v === CONSENT_VERSION ? prev : { v: CONSENT_VERSION, at: Date.now() } });
  renderConsentNote();
  setOpsDisabled(true);
  let r;
  try {
    r = await startSession(payment.id, op, payer.value);
  } catch (err) {
    setOpsDisabled(false);
    if (err.code === 'consent_required') { $('e-consent').textContent = 'Cochez la case pour confirmer avant de payer.'; return $('f-consent').focus(); }
    if (err.code === 'invalid_payer') { $('e-payer').textContent = 'Numéro invalide.'; return $('f-payer').focus(); }
    return toast(err.code === 'rate_limited' ? 'Trop de tentatives sur ce lien. Réessayez plus tard.' : err.code === 'operator_unavailable' ? 'Ce vendeur n’accepte pas cet opérateur.' : 'Lien expiré ou connexion impossible. Réessayez.');
  }
  setOpsDisabled(false);
  if (!r || !/^[0-9*#]+$/.test(String(r.code))) return toast('Réponse invalide. Réessayez.');
  const total = Math.min(Number(r.ttl) || 120, 120);
  session = { code: r.code, op, deadline: Date.now() + total * 1000, total, sms: typeof r.sms === 'string' ? r.sms.slice(0, 400) : '' };
  $('op-name').textContent = operatorLabel(op);
  step(2);
  startTick();
  // Détection automatique du SMS : l'application surveille le SMS de l'opérateur choisi pendant 10 minutes.
  if (inApp() && typeof window.MayaNative.armSms === 'function') {
    try { window.MayaNative.armSms(payment.id, op, session.sms, 10); } catch { /* ignoré */ }
    try { window.MayaNative.setSecure?.(true); } catch { /* ignoré */ } // pas de capture d'écran pendant la session
    startPoll(op);
  } else {
    setAuto('noapp');
  }
  dial();
}

function disarmNative() {
  try { window.MayaNative?.disarmSms?.(); } catch { /* ignoré */ }
  try { window.MayaNative?.setSecure?.(false); } catch { /* ignoré */ } // le reçu peut être capturé
}

// Un site web ne peut pas lancer l'appel lui-même : le lien tel: ouvre le composeur avec le code
// déjà saisi, le client appuie sur appeler. Sur un téléphone à deux SIM, c'est le téléphone qui demande la SIM.
function dial() {
  if (!session) return;
  // Dans l'application Android MAYA-PAY : appel direct sur la SIM de l'opérateur choisi, sans composeur.
  if (inApp()) {
    window.MayaNative.dial(session.code, session.op);
    return;
  }
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

// Fin des 2 minutes : le code est effacé et la session se ferme. La détection du SMS continue (10 minutes).
function closeSession() {
  const watching = !$('step-2').hidden;
  wipeSecrets();
  if (watching) step(3);
  try { window.close(); } catch { /* seule une page ouverte par script peut se fermer */ }
}
document.addEventListener('visibilitychange', () => {
  if (session && document.visibilityState === 'visible') startTick(); // le téléphone a pu mettre la page en veille
});

/* Confirmation automatique : suivi du résultat décidé par le serveur */
const REASONS = {
  failure_message: 'Le SMS indique que le transfert a échoué : rien n’est confirmé.',
  wrong_pin: 'Code secret incorrect. Relance le paiement.',
  insufficient_balance: (op) => `Solde insuffisant sur ton compte ${op}.`,
  not_a_confirmation: 'Ce SMS n’est pas reconnu comme une confirmation de transfert.',
  amount_mismatch: 'Le montant du SMS ne correspond pas au montant demandé.',
  recipient_mismatch: 'Le bénéficiaire du SMS n’est pas celui du vendeur.',
  operator_mismatch: 'Ce SMS ne provient pas de l’opérateur que vous avez choisi.',
  payer_mismatch: 'Le numéro expéditeur du SMS ne correspond pas au numéro que vous avez déclaré : paiement non validé.',
  already_used: 'Cette transaction a déjà été utilisée pour un paiement.',
  sms_too_old: 'Ce SMS date d’avant le début de votre paiement.',
  sms_in_future: 'La date de ce SMS est invalide. Vérifiez l’heure de votre téléphone.',
  no_date: 'La date de ce SMS est invalide. Vérifiez l’heure de votre téléphone.',
  inconsistent: 'Les montants du SMS ne sont pas cohérents (montant, frais, total).',
  rate_limited: 'Trop de tentatives. Réessayez plus tard.',
  no_session: 'Ouvrez d’abord le paiement avec le bouton « Payer ».',
  invalid_link: 'Lien expiré ou invalide.',
};
// Échecs précis indiqués par le SMS de l’opérateur : message dédié, sans « MAYA-PAY continue d’attendre ».
const SPECIFIC_FAILS = new Set(['wrong_pin', 'insufficient_balance']);
const CHECK_TEXT = {
  sender_unverified: 'Votre numéro n’a pas pu être vérifié automatiquement : le SMS ne le mentionne pas et le téléphone ne le communique pas. Le vendeur vérifiera sur son compte avant de livrer.',
  format_unverified: 'Le SMS est dans un format que MAYA-PAY ne valide pas encore seul. Le vendeur vérifiera sur son compte avant de livrer.',
};

function setAuto(kind, reason) {
  const op = session ? operatorLabel(session.op) : 'de votre opérateur';
  const T = {
    wait: ['Gardez votre téléphone allumé !', `En attente du SMS de confirmation. Dès que le SMS ${op} arrive, le paiement est vérifié automatiquement : vous n’avez rien à faire.`],
    perm: ['Autorisation SMS manquante', 'Autorisez MAYA-PAY à lire les SMS (Paramètres du téléphone > Applications > MAYA-PAY > Autorisations), puis relancez le paiement.'],
    rejected: SPECIFIC_FAILS.has(reason)
      ? ['Paiement non confirmé', typeof REASONS[reason] === 'function' ? REASONS[reason](op) : REASONS[reason]]
      : ['SMS reçu, paiement non confirmé', `${REASONS[reason] || 'Ce SMS ne correspond pas à ce paiement.'} MAYA-PAY continue d’attendre le bon SMS.`],
    success: ['Paiement confirmé', 'Le SMS de votre opérateur a été vérifié : votre paiement est validé.'],
    timeout: ['Aucun SMS de confirmation reçu', 'Si vous avez payé, le vendeur vérifiera la réception sur son compte. Sinon, ouvrez le paiement.'],
    noapp: ['Confirmation automatique indisponible', 'Elle fonctionne dans l’application MAYA-PAY (Android). Le vendeur vérifiera la réception sur son compte.'],
  }[kind];
  // rouge = échec, vert = succès, sombre = attente
  $('auto').className = 'auto ' + (kind === 'wait' ? 'wait' : kind === 'success' ? 'ok' : ['rejected', 'perm', 'timeout'].includes(kind) ? 'bad' : '');
  $('scan').hidden = !(kind === 'wait' || kind === 'rejected'); // le détecteur tourne tant qu'on attend le bon SMS
  $('auto-title').textContent = T[0];
  $('auto-text').textContent = T[1];
  $('auto').hidden = false;
}

function hideOutcome() {
  $('auto').hidden = true;
  $('scan').hidden = true;
  $('receipt').hidden = true;
  $('receipt').replaceChildren();
  $('verdict').hidden = true;
}

function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function finish(kind, reason) {
  stopPoll();
  disarmNative();
  wipeSecrets();
  [1, 2, 3].forEach((i) => ($('step-' + i).hidden = true));
  hideOutcome();
  if (kind === 'confirmed') {
    setAuto('success'); // panneau vert au-dessus du reçu
    return showReceipt();
  }
  if (payment?.k === 'subscription') {
    showVerdict('warn', 'Paiement reçu, en attente de validation', 'Votre paiement est enregistré. L’administrateur le validera : la licence sera alors activée.');
    return;
  }
  showVerdict('warn', 'Paiement reçu, à vérifier par le vendeur', CHECK_TEXT[reason] || 'Le vendeur vérifiera sur son compte avant de livrer.');
}

/* Reçu « Opération réussie » (construit avec le DOM : aucune donnée n'est insérée en HTML) */
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const maskNumber = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  return d.length >= 6 ? `${d.slice(0, 2)} •• •• ${d.slice(-2)}` : '';
};
function receiptInfo() {
  const sub = payment.k === 'subscription';
  const op = operatorLabel(chosenOp);
  const when = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  return {
    sub, op, when,
    ref: 'MP-' + String(payment.id).slice(0, 8).toUpperCase(),
    amount: `${formatAmount(payment.a)} ${CONFIG.currency}`,
    payer: maskNumber(store.get().payer),
  };
}
function showReceipt() {
  const i = receiptInfo();
  const box = $('receipt');
  box.replaceChildren();

  const medal = el('div', 'rc-medal');
  medal.setAttribute('aria-hidden', 'true');
  medal.innerHTML = '<i class="rc-ring r1"></i><i class="rc-ring r2"></i><i class="rc-spark s1"></i><i class="rc-spark s2"></i><i class="rc-spark s3"></i><i class="rc-spark s4"></i>'
    + '<svg viewBox="0 0 52 52" class="rc-check"><circle cx="26" cy="26" r="23"/><path d="M15 27.5l8 8 15-17"/></svg>';
  box.appendChild(medal);

  box.appendChild(el('h2', 'rc-title', i.sub ? 'Abonnement activé !' : 'Opération réussie !'));
  box.appendChild(el('p', 'rc-sub', i.sub ? 'Paiement vérifié : votre licence est activée ou prolongée.' : 'Paiement effectué avec succès'));
  box.appendChild(el('p', 'rc-to', i.sub ? 'Abonnement MAYA-PAY' : 'Votre paiement à'));
  if (!i.sub) box.appendChild(el('p', 'rc-merchant', payment.n));
  box.appendChild(el('p', 'rc-amount', i.amount));

  const cols = el('div', 'rc-cols');
  const c1 = el('div', 'rc-col');
  c1.append(el('span', 'rc-k', 'Bénéficiaire'), el('strong', 'rc-v', i.sub ? 'MAYA-PAY' : payment.n), el('span', 'rc-s', i.op));
  const c2 = el('div', 'rc-col');
  c2.append(el('span', 'rc-k', 'Expéditeur'), el('strong', 'rc-v', i.payer || 'Vous'), el('span', 'rc-s', i.op));
  cols.append(c1, c2);
  box.appendChild(cols);

  const st = el('p', 'rc-status');
  st.append(el('i', 'rc-dot'), document.createTextNode(' Complété'));
  box.appendChild(st);
  box.appendChild(el('p', 'rc-date', i.when));

  const foot = el('div', 'rc-foot');
  foot.append(el('span', null, `Référence : ${i.ref}`));
  box.appendChild(foot);

  const share = el('button', 'btn primary block rc-btn', 'Partager le reçu');
  share.type = 'button';
  share.addEventListener('click', async () => {
    const text = [i.sub ? 'Abonnement MAYA-PAY : opération réussie' : `Paiement réussi à ${payment.n}`, `Montant : ${i.amount}`, `Opérateur : ${i.op}`, `Date : ${i.when}`, `Référence : ${i.ref}`].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Reçu MAYA-PAY', text });
      else { await navigator.clipboard.writeText(text); toast('Reçu copié.'); }
    } catch { /* partage annulé */ }
  });
  const done = el('button', 'btn secondary block rc-btn', 'Terminé');
  done.type = 'button';
  done.addEventListener('click', () => { location.hash = '#/'; });
  box.append(share, done);

  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try { navigator.vibrate?.([60, 40, 90]); } catch { /* ignoré */ }
}

function startPoll(op) {
  stopPoll();
  const until = Date.now() + 10 * 60 * 1000;
  setAuto('wait');
  let busy = false;
  const run = async () => {
    if (!payment || busy || document.visibilityState !== 'visible') return;
    if (Date.now() > until) { stopPoll(); disarmNative(); return setAuto('timeout'); }
    busy = true;
    try {
      let ready = true;
      try { if (typeof window.MayaNative.smsReady === 'function') ready = Boolean(window.MayaNative.smsReady()); } catch { /* ignoré */ }
      let r = null;
      try { r = await smsResult(payment.id); } catch { /* réseau : nouvel essai */ }
      if (!payment || !location.hash.includes(payment.id)) return stopPoll();
      if (r?.status === 'confirmed') finish('confirmed');
      else if (r?.status === 'check') finish('check', r.reason);
      else if (r?.status === 'rejected') setAuto('rejected', r.reason);
      else setAuto(ready ? 'wait' : 'perm');
    } finally {
      busy = false;
    }
  };
  pollTimer = setInterval(run, 3000);
}

addEventListener('pagehide', wipeSecrets);

/* ---------- Menu ---------- */
const menu = $('menu');
const menuBtn = $('menu-btn');
function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); }
menuBtn.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
menu.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-go]');
  if (!a) return;
  e.preventDefault();
  setMenu(false);
  const go = () => {
    const t = $(a.dataset.go);
    if (t && !t.hidden) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (!location.hash || location.hash === '#/') go();
  else { location.hash = '#/'; setTimeout(go, 200); }
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
  setMenu(false);
});
addEventListener('appinstalled', () => ($('install').hidden = true));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

route();

syncNativeWatch();

// Application Android : bouton « Scanner un QR de paiement » (lecteur de QR du téléphone).
(() => {
  const b = document.getElementById('scan-qr');
  if (!b || !window.MayaNative || typeof window.MayaNative.scanQr !== 'function') return;
  b.hidden = false;
  b.addEventListener('click', () => { try { window.MayaNative.scanQr(); } catch { /* ignoré */ } });
})();
