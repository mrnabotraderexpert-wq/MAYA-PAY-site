// Panier du vendeur : additionne plusieurs articles et remplit le montant et la description du lien.
// Tout reste sur le téléphone ; le serveur reçoit seulement le total et la description, comme avant.
import { CONFIG } from './config.js';
import { formatAmount } from './link.js';

const MAX_LINES = 30;
const $ = (id) => document.getElementById(id);
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const toInt = (s) => {
  const raw = String(s ?? '').replace(/[\s  .]/g, '');
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
};

// Description limitée à la taille acceptée : les articles qui ne tiennent pas sont comptés (« +3 autres »).
export function describe(items, max = CONFIG.limits.description) {
  const parts = items.map((i) => `${i.q}x ${i.name}`);
  for (let k = parts.length; k > 0; k--) {
    const rest = parts.length - k;
    const text = parts.slice(0, k).join(', ') + (rest ? ` +${rest} autre${rest > 1 ? 's' : ''}` : '');
    if (text.length <= max) return text;
  }
  return `${parts.length} article${parts.length > 1 ? 's' : ''}`;
}

export function setupCart() {
  const box = $('cart'), list = $('cart-lines'), open = $('cart-open');
  const amount = $('f-a'), desc = $('f-d');
  let before = null; // saisie manuelle, rendue si le panier est retiré

  const rows = () => [...list.children].map((li) => {
    const [name, price, qty] = li.querySelectorAll('input');
    return { li, name, price, qty };
  });

  // Lignes valides, total, et première ligne à corriger (les lignes entièrement vides sont ignorées).
  function read() {
    const items = [];
    let bad = null;
    for (const r of rows()) {
      const name = clean(r.name.value);
      if (!name && !r.price.value.trim()) continue;
      const p = toInt(r.price.value), q = toInt(r.qty.value);
      if (!(p >= 1)) bad = bad || { field: r.price, msg: 'Saisissez le prix en chiffres.' };
      else if (!(q >= 1 && q <= 999)) bad = bad || { field: r.qty, msg: 'La quantité doit être entre 1 et 999.' };
      else items.push({ name: name || 'Article', p, q });
    }
    return { items, bad, total: items.reduce((s, i) => s + i.p * i.q, 0) };
  }

  function update() {
    const { items, total } = read();
    $('cart-total').textContent = `${formatAmount(total)} ${CONFIG.currency}`;
    $('cart-err').textContent = total > CONFIG.amount.max ? `Le montant maximum est ${formatAmount(CONFIG.amount.max)} ${CONFIG.currency}.` : '';
    amount.value = items.length ? formatAmount(total) : '';
    desc.value = items.length ? describe(items) : '';
    $('cart-add').disabled = list.children.length >= MAX_LINES;
  }

  function input(label, attrs) {
    const el = document.createElement('input');
    el.type = 'text';
    el.autocomplete = 'off';
    el.setAttribute('aria-label', label);
    Object.assign(el, attrs);
    return el;
  }

  function addLine(focus) {
    if (list.children.length >= MAX_LINES) return;
    const li = document.createElement('li');
    const name = input('Nom de l’article', { className: 'c-name', placeholder: 'Article (ex. savon)', maxLength: 40 });
    const price = input('Prix d’un article en FCFA', { className: 'c-price', placeholder: 'Prix FCFA', inputMode: 'numeric', maxLength: 10 });
    const qty = input('Quantité', { className: 'c-qty', value: '1', inputMode: 'numeric', maxLength: 3 });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'c-del'; del.textContent = '×';
    del.setAttribute('aria-label', 'Retirer cet article');
    del.onclick = () => { li.remove(); if (!list.children.length) addLine(false); update(); };
    li.append(name, price, qty, del);
    list.appendChild(li);
    if (focus) name.focus();
    update();
  }

  function show(on) {
    box.hidden = !on;
    open.hidden = on;
    amount.readOnly = desc.readOnly = on;
  }

  function reset() {
    list.replaceChildren();
    show(false);
    $('cart-err').textContent = '';
    before = null;
  }

  open.onclick = () => { before = { a: amount.value, d: desc.value }; show(true); addLine(true); };
  $('cart-add').onclick = () => addLine(true);
  $('cart-close').onclick = () => { const b = before; reset(); amount.value = b?.a || ''; desc.value = b?.d || ''; };
  list.addEventListener('input', update);
  // La touche « Entrée » dans le panier ne doit pas générer le lien par erreur.
  list.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

  return {
    reset,
    // Avant de créer le lien : { ok:false } si une ligne est à corriger ; sinon le détail complet des articles.
    check() {
      if (box.hidden) return { ok: true, detail: '' };
      const { items, bad, total } = read();
      if (bad) { $('cart-err').textContent = bad.msg; bad.field.focus(); return { ok: false }; }
      if (!items.length) { $('cart-err').textContent = 'Ajoutez au moins un article avec son prix.'; rows()[0]?.name.focus(); return { ok: false }; }
      update();
      if (total > CONFIG.amount.max) { $('cart-add').scrollIntoView({ block: 'center' }); return { ok: false }; }
      return { ok: true, detail: items.map((i) => `• ${i.q} x ${i.name} : ${formatAmount(i.p * i.q)} ${CONFIG.currency}`).join('\n') };
    },
  };
}
