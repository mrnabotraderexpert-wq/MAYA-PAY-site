// Publicité de l'accueil : créée, modifiée et supprimée uniquement par l'administrateur (mot de passe vérifié par le serveur à chaque appel).
import { adminAdsList, adminAdSave, adminAdAction } from './api.js';

const PASS_KEY = 'mayapay.admin';
const pass = () => { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch { return ''; } };
const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const card = $('ads-card');
const msg = $('ad-msg');
const say = (t, ok) => { msg.textContent = t || ''; msg.className = 'msg ' + (t ? (ok ? 'ok' : 'bad') : ''); };
const MAX_IMG_CHARS = 85000;

const ERR = {
  forbidden: 'Mot de passe refusé : reconnectez-vous.', locked: 'Trop de tentatives. Réessayez dans 15 minutes.',
  bad_title: 'Titre requis (60 caractères maximum).', bad_text: 'Texte trop long (160 caractères maximum).',
  bad_cta: 'Texte du bouton trop long (30 caractères maximum).', bad_url: 'Lien invalide : il doit commencer par https://',
  cta_needs_url: 'Un bouton demande un lien https://.', bad_image: 'Image refusée (PNG, JPEG ou WebP, taille réduite).',
  too_many: '20 annonces au maximum : supprimez-en une.', not_found: 'Annonce introuvable.',
};
let dead = false;
let ads = [];
let editing = null;     // annonce en cours de modification
let image = '';         // image (data:) de l'annonce en cours

async function call(fn, ...a) {
  const r = await fn(pass(), ...a);
  if (r && r.error) {
    if (r.error === 'forbidden' || r.error === 'locked') dead = true;
    throw Object.assign(new Error(r.error), { code: r.error });
  }
  return r;
}

/* ---------- Image : réduite et compressée dans le navigateur ---------- */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
    im.src = url;
  });
}
async function shrink(file) {
  const im = await loadImage(file);
  for (const side of [480, 360, 280, 200]) {
    const k = Math.min(1, side / Math.max(im.width, im.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL('image/jpeg', q);
      if (d.length <= MAX_IMG_CHARS) return d;
    }
  }
  throw new Error('bad_image');
}
function showImage(d) {
  image = d || '';
  const p = $('ad-preview');
  if (image) { p.src = image; p.hidden = false; } else { p.removeAttribute('src'); p.hidden = true; }
  $('ad-img-remove').hidden = !image;
}
$('ad-f-img').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { say(ERR.bad_image); return; }
  try { showImage(await shrink(f)); say(''); } catch { say(ERR.bad_image); }
});
$('ad-img-remove').addEventListener('click', () => showImage(''));

/* ---------- Formulaire ---------- */
function resetForm() {
  editing = null;
  $('ad-form').reset();
  showImage('');
  $('ad-save').textContent = 'Publier l\'annonce';
  $('ad-cancel').hidden = true;
}
function edit(ad) {
  editing = ad;
  $('ad-f-title').value = ad.title || '';
  $('ad-f-text').value = ad.text || '';
  $('ad-f-cta').value = ad.cta || '';
  $('ad-f-url').value = ad.url || '';
  showImage(ad.image || '');
  $('ad-save').textContent = 'Enregistrer les modifications';
  $('ad-cancel').hidden = false;
  say('');
  $('ad-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('ad-cancel').addEventListener('click', () => { resetForm(); say(''); });

$('ad-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('ad-save');
  btn.disabled = true;
  try {
    const url = $('ad-f-url').value.trim();
    if (url && !/^https:\/\//i.test(url)) throw Object.assign(new Error('bad_url'), { code: 'bad_url' });
    await call(adminAdSave, {
      id: editing ? editing.id : null,
      title: $('ad-f-title').value, text: $('ad-f-text').value, cta: $('ad-f-cta').value, url, image,
      active: editing ? editing.active : true,
    });
    const wasNew = !editing;
    resetForm();
    say(wasNew ? 'Annonce publiée.' : 'Annonce modifiée.', true);
    await load();
  } catch (err) { say(ERR[err.code] || 'Opération impossible. Réessayez.'); }
  btn.disabled = false;
});

/* ---------- Liste ---------- */
async function act(ad, action) {
  if (action === 'delete' && !confirm('Supprimer définitivement cette annonce ?')) return;
  try {
    await call(adminAdAction, ad.id, action);
    if (editing && editing.id === ad.id && action === 'delete') resetForm();
    say(action === 'delete' ? 'Annonce supprimée.' : (action === 'on' ? 'Annonce activée.' : 'Annonce désactivée.'), true);
    await load();
  } catch (err) { say(ERR[err.code] || 'Opération impossible. Réessayez.'); }
}
function render() {
  const ul = $('ad-list');
  ul.textContent = '';
  if (!ads.length) { ul.appendChild(mk('li', 'muted', 'Aucune annonce : le panneau est masqué sur l\'accueil.')); return; }
  for (const ad of ads) {
    const li = mk('li');
    li.style.cssText = 'display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;padding:10px;border:1px solid #DCE3F4;border-radius:14px;background:#fff';
    if (ad.image && /^data:image\/(png|jpeg|webp);base64,/.test(ad.image)) {
      const im = mk('img'); im.src = ad.image; im.alt = ''; im.style.cssText = 'width:56px;height:56px;border-radius:12px;object-fit:cover';
      li.appendChild(im);
    } else { li.style.gridTemplateColumns = 'minmax(0,1fr)'; }
    const body = mk('div'); body.style.minWidth = '0';
    body.appendChild(mk('strong', '', ad.title));
    body.appendChild(mk('span', ad.active ? 'ok' : 'muted', ad.active ? '  ● active' : '  ○ désactivée'));
    if (ad.text) { const t = mk('div', 'muted', ad.text); t.style.fontSize = '.9rem'; body.appendChild(t); }
    if (ad.url) { const u = mk('small', 'muted', (ad.cta ? ad.cta + ' → ' : '') + ad.url); u.style.cssText = 'display:block;overflow-wrap:anywhere'; body.appendChild(u); }
    const row = mk('div', 'item-actions'); row.style.marginTop = '8px';
    const b1 = mk('button', 'btn secondary small', 'Modifier'); b1.type = 'button'; b1.onclick = () => edit(ad);
    const b2 = mk('button', 'btn secondary small', ad.active ? 'Désactiver' : 'Activer'); b2.type = 'button'; b2.onclick = () => act(ad, ad.active ? 'off' : 'on');
    const b3 = mk('button', 'btn ghost small', 'Supprimer'); b3.type = 'button'; b3.onclick = () => act(ad, 'delete');
    row.append(b1, b2, b3); body.appendChild(row);
    li.appendChild(body); ul.appendChild(li);
  }
}
async function load() {
  try { ads = (await call(adminAdsList)).ads || []; render(); }
  catch (err) { say(ERR[err.code] || 'Chargement impossible.'); }
}

function start() {
  if ($('view-panel').hidden || !pass()) return;
  dead = false; card.hidden = false;
  load();
}
new MutationObserver(start).observe($('view-panel'), { attributes: true, attributeFilter: ['hidden'] });
start();
