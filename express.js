// Maya Express : vitrine du vendeur (catalogue), page de commande du client et commandes reçues.
// Ce fichier ne fait que l'affichage : le serveur recalcule toujours le total avec SES prix, vérifie la licence
// du vendeur (comme pour les liens de paiement) et crée le lien de paiement. Le paiement lui-même reste celui de MAYA-PAY.
import { CONFIG } from './config.js';
import { formatAmount, normalizeNumber } from './link.js';
import { validId, validKey, expressSave, expressGet, expressOrder, expressOrders } from './api.js';
import { drawQr } from './qr.js';

const $ = (id) => document.getElementById(id);
const MAX = CONFIG.express.maxProducts;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const toInt = (s) => {
  const raw = String(s ?? '').replace(/[\s\u00a0\u202f.]/g, '');
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
};
const money = (n) => `${formatAmount(n)} ${CONFIG.currency}`;
const phoneOk = (x) => /^[0-9]{8,10}$/.test(String(x ?? ''));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPS = { orange: 'Orange Money', moov: 'Moov Money' };
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

let ctx;
let ordersTimer;
export const stopExpress = () => { clearInterval(ordersTimer); ordersTimer = null; };

export function initExpress(c) {
  ctx = c;
  setupVendor();
  setupShop();
  return { render, openShop, openOrders, stop: stopExpress };
}

/* ---------- Espace vendeur : mes produits, ma vitrine ---------- */
const saved = () => ctx.store.get().express || {};
const keep = (patch) => ctx.store.set({ express: { ...saved(), ...patch } });
const shopLink = (id) => `${location.origin}${location.pathname.replace(/index\.html$/, '')}#/express?s=${id}`;

function rows() {
  return [...$('x-lines').children].map((li) => ({ li, n: li.querySelector('.x-name'), p: li.querySelector('.x-price'), ph: li._ph || '' }));
}
const draft = () => rows().map((r) => ({ n: r.n.value, p: r.p.value, ph: r.ph })).filter((r) => r.n.trim() || r.p.trim());

// Lignes valides, et première ligne à corriger (les lignes entièrement vides sont ignorées).
function readProducts() {
  const items = [];
  let bad = null;
  for (const r of rows()) {
    const n = clean(r.n.value);
    if (!n && !r.p.value.trim()) continue;
    const p = toInt(r.p.value);
    if (!n) bad = bad || { f: r.n, msg: 'Donnez un nom à chaque produit.' };
    else if (!(p >= 1 && p <= CONFIG.amount.max)) bad = bad || { f: r.p, msg: 'Saisissez le prix en chiffres (1 à ' + formatAmount(CONFIG.amount.max) + ').' };
    else items.push(r.ph ? { n, p, ph: r.ph } : { n, p });
  }
  return { items, bad };
}

function input(label, attrs) {
  const el = document.createElement('input');
  el.type = 'text';
  el.autocomplete = 'off';
  el.setAttribute('aria-label', label);
  return Object.assign(el, attrs);
}

// Photo du produit : petit carré JPEG préparé sur le téléphone (facultatif).
function setupPic(li) {
  const box = mk('div', 'x-picbox');
  const pic = mk('button', 'x-pic');
  pic.type = 'button';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  const clear = mk('button', 'x-pic-del', '×');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Retirer la photo du produit');
  const paint = () => {
    pic.replaceChildren();
    if (li._ph) {
      const img = mk('img');
      img.alt = '';
      ctx.setAvatar(img, li._ph);
      pic.appendChild(img);
    } else {
      pic.appendChild(mk('span', 'x-pic-empty', '📷'));
    }
    pic.setAttribute('aria-label', li._ph ? 'Changer la photo du produit' : 'Ajouter une photo du produit (facultatif)');
    clear.hidden = !li._ph;
  };
  pic.onclick = () => file.click();
  clear.onclick = () => { li._ph = ''; paint(); sync(); };
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) return ctx.toast('Choisissez une image.');
    try {
      li._ph = await ctx.makeThumb(f);
      paint();
      sync();
    } catch {
      ctx.toast('Cette image ne peut pas être utilisée. Essayez une autre photo.');
    }
  });
  paint();
  box.append(pic, clear, file);
  return box;
}

function addRow(name, price, focus, photo) {
  const list = $('x-lines');
  if (list.children.length >= MAX) return;
  const li = document.createElement('li');
  li._ph = photo || '';
  const n = input('Nom du produit', { className: 'x-name', placeholder: 'Produit (ex. savon)', maxLength: 40, value: name || '' });
  const p = input('Prix du produit en FCFA', { className: 'x-price', placeholder: 'Prix FCFA', inputMode: 'numeric', maxLength: 10, value: price || '' });
  const del = mk('button', 'c-del', '×');
  del.type = 'button';
  del.setAttribute('aria-label', 'Retirer ce produit');
  del.onclick = () => { li.remove(); if (!list.children.length) addRow('', '', false); sync(); };
  li.append(setupPic(li), n, p, del);
  list.appendChild(li);
  if (focus) n.focus();
  sync();
}

function sync() {
  $('x-add').disabled = $('x-lines').children.length >= MAX;
  keep({ products: draft() });
}

function renderResult() {
  const s = saved();
  const ok = validId(s.id) && validKey(s.key);
  $('x-result').hidden = !ok;
  $('x-save-text').textContent = ok ? 'Mettre à jour ma vitrine' : 'Créer ma vitrine';
  if (!ok) return;
  const link = shopLink(s.id);
  $('x-link').value = link;
  const qrOk = drawQr($('x-qr'), link);
  $('x-qr-box').hidden = !qrOk;
  const name = clean(s.n || ctx.fields.n.value) || 'ma boutique';
  $('x-wa').href = 'https://wa.me/?text=' + encodeURIComponent(`Bonjour, voici ma boutique ${name} : choisissez vos produits et payez par Orange Money ou Moov Money.\n${link}`);
}

function render() {
  if (!$('x-lines').children.length) {
    const list = (saved().products || []).slice(0, MAX);
    if (list.length) for (const r of list) addRow(String(r.n ?? ''), String(r.p ?? ''), false, typeof r.ph === 'string' ? r.ph : '');
    else addRow('', '', false);
  }
  renderResult();
}

function setupVendor() {
  $('x-add').onclick = () => addRow('', '', true);
  $('x-lines').addEventListener('input', sync);
  // La touche « Entrée » dans la liste ne doit pas valider le formulaire par erreur.
  $('x-lines').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  $('x-copy').onclick = async () => ctx.toast((await ctx.copyText($('x-link').value)) ? 'Lien copié.' : 'Copie impossible : sélectionnez le lien à la main.');
  $('x-link').addEventListener('focus', (e) => e.target.select());

  $('x-save').onclick = async () => {
    const err = $('x-err');
    err.textContent = '';
    const f = ctx.fields;
    const n = clean(f.n.value);
    const po = normalizeNumber(f.po.value);
    const pm = normalizeNumber(f.pm.value);
    if (!n) { err.textContent = 'Saisissez d’abord votre nom commercial dans le formulaire ci-dessus.'; return f.n.focus(); }
    if ((!po && !pm) || (po && !phoneOk(po)) || (pm && !phoneOk(pm))) {
      err.textContent = 'Saisissez un numéro Orange Money ou Moov Money valide dans le formulaire ci-dessus.';
      return (po ? f.pm : f.po).focus();
    }
    const { items, bad } = readProducts();
    if (bad) { err.textContent = bad.msg; return bad.f.focus(); }
    if (!items.length) { err.textContent = 'Ajoutez au moins un produit avec son prix.'; return rows()[0]?.n.focus(); }

    const btn = $('x-save');
    btn.disabled = true;
    const s = saved();
    try {
      const r = await expressSave({ id: s.id, key: s.key, n, po, pm, ph: ctx.getPhoto(), products: items.map(({ ph, ...r }) => (ph ? { ...r, i: ph } : r)) });
      if (!r || !validId(r.id) || !validKey(r.key)) throw new Error('bad response');
      keep({ id: r.id, key: r.key, n, products: items.map((i) => ({ n: i.n, p: String(i.p), ph: i.ph || '' })) });
      ctx.toast(s.id ? 'Vitrine mise à jour.' : 'Vitrine créée.');
      renderResult();
    } catch (e) {
      if (e && e.code === 'license_required') {
        err.textContent = 'Votre licence est expirée : abonnez-vous pour utiliser Maya Express. Vos commandes restent consultables.';
        ctx.refreshSub();
        $('sub-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (e && e.code === 'forbidden') {
        keep({ id: undefined, key: undefined });
        renderResult();
        err.textContent = 'Cette vitrine n’est plus accessible depuis cet appareil. Touchez de nouveau le bouton pour en créer une nouvelle.';
      } else {
        err.textContent = e && e.code === 'rate_limited' ? 'Trop de demandes. Réessayez dans une heure.'
          : e && e.code === 'invalid_product_photo' ? 'Une photo de produit ne peut pas être utilisée. Retirez-la ou changez-la.'
          : e && e.code === 'invalid_photo' ? 'La photo ne peut pas être utilisée. Changez-la dans le formulaire ci-dessus.'
          : 'Connexion impossible. Réessayez.';
      }
    } finally {
      btn.disabled = false;
    }
  };
}

/* ---------- Page du client : choisir, calculer, payer ---------- */
let shop = null;
const qty = new Map();

function shopTotal() {
  return shop.products.reduce((s, p) => s + p.p * (qty.get(p.id) || 0), 0);
}

function refreshTotal() {
  const total = shopTotal();
  $('s-total').textContent = money(total);
  $('s-order').disabled = !shop.open || total < 1 || total > CONFIG.amount.max;
  $('s-err').textContent = total > CONFIG.amount.max ? `Le montant maximum est ${money(CONFIG.amount.max)}.` : '';
}

function renderShop() {
  $('s-name').textContent = shop.name;
  ctx.setAvatar($('s-photo'), shop.photo);
  $('s-closed').hidden = shop.open;
  $('s-ops').textContent = shop.ops.length ? `Paiement par ${shop.ops.map((o) => OPS[o]).filter(Boolean).join(' ou ')}.` : '';
  const ul = $('s-list');
  ul.replaceChildren();
  for (const p of shop.products) {
    const li = document.createElement('li');
    if (p.ph) {
      const img = mk('img', 'p-thumb');
      img.alt = '';
      img.width = img.height = 56;
      img.loading = 'lazy';
      ctx.setAvatar(img, p.ph);
      li.appendChild(img);
    }
    const info = mk('span', 'p-info');
    info.append(mk('strong', null, p.n), mk('small', null, money(p.p)));
    const out = mk('output', 'p-qty', '0');
    const minus = mk('button', 'btn secondary', '−');
    const plus = mk('button', 'btn secondary', '+');
    minus.type = plus.type = 'button';
    minus.setAttribute('aria-label', 'Retirer un ' + p.n);
    plus.setAttribute('aria-label', 'Ajouter un ' + p.n);
    const set = (q) => { qty.set(p.id, q); out.textContent = String(q); refreshTotal(); };
    minus.onclick = () => set(Math.max(0, (qty.get(p.id) || 0) - 1));
    plus.onclick = () => set(Math.min(99, (qty.get(p.id) || 0) + 1));
    const step = mk('div', 'stepper');
    step.append(minus, out, plus);
    li.append(info, step);
    ul.appendChild(li);
  }
  refreshTotal();
}

export async function openShop(id) {
  let o = null;
  try { o = await expressGet(id); } catch { ctx.toast('Connexion impossible. Réessayez.'); }
  if (!location.hash.includes(id)) return; // la navigation a changé pendant l'attente
  if (!o || !o.n || !Array.isArray(o.products)) return ctx.invalid();
  qty.clear();
  shop = {
    id,
    name: String(o.n).slice(0, 40),
    photo: o.p,
    open: o.open === true,
    ops: Array.isArray(o.ops) ? o.ops.map(String).filter((x) => OPS[x]) : [],
    products: o.products
      .filter((p) => p && UUID.test(String(p.id)) && Number.isInteger(Number(p.p)) && Number(p.p) >= 1)
      .slice(0, MAX)
      .map((p) => ({ id: String(p.id), n: String(p.n ?? '').slice(0, 40), p: Number(p.p), ph: typeof p.i === 'string' ? p.i : '' })),
  };
  document.title = `${shop.name} – Maya Express`;
  $('s-err').textContent = '';
  renderShop();
  ctx.show('view-shop');
}

function setupShop() {
  $('s-order').onclick = async () => {
    const err = $('s-err');
    err.textContent = '';
    if (!shop) return;
    const buyer = clean($('s-buyer').value);
    const phone = normalizeNumber($('s-phone').value);
    const items = [...qty].filter(([, q]) => q > 0).map(([id, q]) => ({ id, q }));
    if (!items.length) { err.textContent = 'Choisissez au moins un produit.'; return; }
    if (buyer.length < 2) { err.textContent = 'Saisissez votre nom.'; return $('s-buyer').focus(); }
    if (!phoneOk(phone)) { err.textContent = 'Saisissez votre numéro de téléphone (8 chiffres).'; return $('s-phone').focus(); }
    const btn = $('s-order');
    btn.disabled = true;
    try {
      const r = await expressOrder(shop.id, items, buyer, phone);
      if (!r || !validId(r.id)) throw new Error('bad response');
      location.hash = `#/pay?i=${r.id}`; // même parcours de paiement et même vérification automatique que les autres liens
      return;
    } catch (e) {
      const code = e && e.code;
      if (code === 'invalid_cart') {
        err.textContent = 'Le catalogue a changé. Vérifiez votre panier.';
        openShop(shop.id);
      } else {
        err.textContent = code === 'license_required' || code === 'shop_not_found' ? 'Cette boutique ne peut pas prendre de commande pour le moment.'
          : code === 'rate_limited' ? 'Trop de commandes pour le moment. Réessayez plus tard.'
          : code === 'invalid_buyer' ? 'Saisissez votre nom.'
          : code === 'invalid_phone' ? 'Numéro de téléphone invalide.'
          : 'Connexion impossible. Réessayez.';
      }
    }
    refreshTotal();
  };
}

/* ---------- Commandes reçues (vendeur) ---------- */
const STATUS = {
  confirmed: ['ok', 'Payée'],
  check: ['warn', 'Paiement à vérifier'],
  pending: ['', 'En attente de paiement'],
};
let ordersSig = '';

function renderOrders(orders) {
  const ul = $('o-list');
  ul.replaceChildren();
  for (const o of orders) {
    const li = document.createElement('li');
    const status = STATUS[o.status] ? o.status : 'pending';
    const expired = status === 'pending' && o.exp && new Date(o.exp) < new Date();
    const head = mk('div', 'proof-head');
    head.append(mk('span', 'badge ' + STATUS[status][0], expired ? 'Non payée (expirée)' : STATUS[status][1]), mk('small', null, ctx.fmtDate(o.at)));
    li.appendChild(head);
    li.appendChild(mk('strong', 'o-buyer', String(o.buyer ?? '').slice(0, 40)));
    if (phoneOk(o.phone)) {
      const p = mk('p', 'detail');
      const tel = mk('a', null, o.phone);
      tel.href = 'tel:' + o.phone;
      const wa = mk('a', null, 'WhatsApp');
      wa.href = `https://wa.me/${CONFIG.countryCode}${o.phone}`;
      wa.target = '_blank';
      wa.rel = 'noopener noreferrer';
      p.append(tel, document.createTextNode(' · '), wa);
      li.appendChild(p);
    }
    const items = mk('ul', 'o-items');
    for (const i of Array.isArray(o.items) ? o.items : []) {
      const q = Number(i.q), pr = Number(i.p);
      if (!Number.isFinite(q) || !Number.isFinite(pr)) continue;
      items.appendChild(mk('li', null, `${q} x ${String(i.n ?? '').slice(0, 40)} : ${money(q * pr)}`));
    }
    li.appendChild(items);
    li.appendChild(mk('p', 'o-total', `Total : ${money(Number(o.total) || 0)}`));
    ul.appendChild(li);
  }
}

async function refreshOrders(s) {
  let r;
  try {
    r = await expressOrders(s.id, s.key);
  } catch (e) {
    if (e && e.code === 'forbidden') { stopExpress(); $('o-state').textContent = 'Cette vitrine n’est plus accessible depuis cet appareil.'; return; }
    $('o-state').textContent = 'Connexion impossible. Nouvel essai automatique…';
    return;
  }
  if (location.hash !== '#/commandes' || !r) return; // la navigation a changé pendant l'attente
  const orders = Array.isArray(r.orders) ? r.orders : [];
  $('o-state').textContent = orders.length ? '' : 'Aucune commande pour le moment.';
  const sig = JSON.stringify(orders.map((o) => [o.id, o.status]));
  if (sig !== ordersSig) { ordersSig = sig; renderOrders(orders); }
}

export function openOrders() {
  const s = saved();
  if (!validId(s.id) || !validKey(s.key)) { location.hash = '#/'; return; }
  document.title = 'Mes commandes – MAYA-PAY';
  ordersSig = '';
  $('o-list').replaceChildren();
  $('o-state').textContent = 'Chargement…';
  ctx.show('view-orders');
  refreshOrders(s);
  ordersTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshOrders(s); }, CONFIG.trackRefreshSeconds * 1000);
}
