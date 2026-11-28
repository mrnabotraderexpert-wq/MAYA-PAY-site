// Confiance et sécurité : interrupteurs (comptes, inscription obligatoire, vérification NINA, signalements),
// vendeurs à vérifier et signalements reçus. Le mot de passe admin est revérifié par le serveur à chaque appel.
// Les interrupteurs agissent tout de suite sur le site et l'application : aucun build, aucun déploiement.
import { adminTrustGet, adminTrustSet, adminVendors, adminVendorSet, adminReports, adminReportSet, validId } from './api.js';

const PASS_KEY = 'mayapay.admin';
const pass = () => { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch { return ''; } };
const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

const card = $('trust-card');
const msg = $('trust-msg');
const say = (t, ok) => { msg.textContent = t || ''; msg.className = 'msg ' + (t ? (ok ? 'ok' : 'bad') : ''); };
const ERR = {
  forbidden: 'Mot de passe refusé : reconnectez-vous.', locked: 'Trop de tentatives. Réessayez dans 15 minutes.',
  invalid: 'Réglage invalide.', not_found: 'Introuvable (déjà supprimé ?).', invalid_action: 'Action invalide.', invalid_status: 'Statut invalide.',
};
let dead = false;

async function call(fn, ...a) {
  const r = await fn(pass(), ...a);
  if (r && r.error) {
    if (r.error === 'forbidden' || r.error === 'locked') dead = true;
    throw Object.assign(new Error(r.error), { code: r.error });
  }
  return r;
}
const fail = (err) => say(ERR[err.code] || 'Opération impossible. Réessayez.');

/* ---------- Interrupteurs ---------- */
const SW = ['auth', 'required', 'kyc', 'reports'];
const sw = (k) => $('t-' + k);
function paintTrust(t) {
  for (const k of SW) sw(k).checked = t[k] === true;
  sw('required').disabled = !sw('auth').checked;
  $('t-accounts').textContent = t.accounts ?? '–';
  $('t-verified').textContent = t.verified ?? '–';
  $('t-pending').textContent = t.pending ?? '–';
  $('t-newreports').textContent = t.new_reports ?? '–';
  const todo = Number(t.pending || 0) + Number(t.new_reports || 0);
  $('trust-badge').hidden = !todo;
  $('trust-badge').textContent = todo + ' à traiter';
}
async function loadTrust() {
  try { paintTrust(await call(adminTrustGet)); say(''); } catch (e) { fail(e); }
}
async function saveSwitches(changed) {
  const t = {}; for (const k of SW) t[k] = sw(k).checked;
  sw('required').disabled = !t.auth;
  try {
    await call(adminTrustSet, t);
    say('Enregistré : effet immédiat (les téléphones l’appliquent à la prochaine ouverture de page).', true);
    loadTrust();
  } catch (e) { changed.checked = !changed.checked; sw('required').disabled = !sw('auth').checked; fail(e); }
}
for (const k of SW) sw(k).addEventListener('change', (e) => saveSwitches(e.target));

/* ---------- Vendeurs ---------- */
const V_STATUS = { none: ['', 'Sans demande'], pending: ['warn', 'À vérifier'], verified: ['ok', 'Vérifié'], rejected: ['bad', 'Refusé'], suspended: ['bad', 'Suspendu'] };
function askNote(text) { const n = window.prompt(text, ''); return n === null ? null : n.trim(); }
async function vendorAct(v, action, note) {
  try { await call(adminVendorSet, v.id, action, note); say('Fait.', true); await Promise.all([loadVendors(), loadTrust(), loadReports()]); } catch (e) { fail(e); }
}
function renderVendors(list) {
  const ul = $('t-vendors');
  ul.replaceChildren();
  if (!list.length) { ul.appendChild(mk('li', 'muted', 'Aucun vendeur pour ce filtre.')); return; }
  for (const v of list) {
    if (!UUID.test(String(v.id))) continue;
    const st = V_STATUS[v.status] || V_STATUS.none;
    const li = mk('li', 'item');
    const head = mk('div', 'item-head');
    head.append(mk('strong', null, String(v.name || v.email || 'Sans nom').slice(0, 60)), mk('span', 'badge ' + st[0], st[1]));
    li.appendChild(head);
    const info = [v.email, v.phone, v.last4 ? 'NINA ••••' + String(v.last4).slice(-4) : '', v.shops ? v.shops + ' vitrine(s)' + (v.shop_names ? ' : ' + v.shop_names : '') : 'aucune vitrine'].filter(Boolean).join(' · ');
    li.appendChild(mk('small', null, info));
    const more = [v.requested_at ? 'Demande : ' + fmt(v.requested_at) : '', v.decided_at ? 'Décision : ' + fmt(v.decided_at) : '', Number(v.reports_30d) ? '⚠ ' + v.reports_30d + ' signalement(s) en 30 jours' : '', v.note ? 'Note : ' + v.note : ''].filter(Boolean).join(' · ');
    if (more) li.appendChild(mk('small', null, more));
    const row = mk('div', 'item-actions');
    const add = (label, cls, fn) => { const b = mk('button', 'btn ' + cls + ' small', label); b.type = 'button'; b.onclick = fn; row.appendChild(b); };
    if (v.status !== 'verified') add('Vérifier', 'primary', () => vendorAct(v, 'verify', null));
    if (v.status === 'pending' || v.status === 'none') add('Refuser', 'secondary', () => { const n = askNote('Motif du refus (affiché au vendeur, facultatif) :'); if (n !== null) vendorAct(v, 'reject', n); });
    if (v.status !== 'suspended') add('Suspendre', 'secondary', () => { const n = askNote('Motif de la suspension (facultatif) :'); if (n !== null) vendorAct(v, 'suspend', n); });
    if (v.status !== 'none') add('Réinitialiser', 'ghost', () => vendorAct(v, 'reset', null));
    li.appendChild(row);
    ul.appendChild(li);
  }
}
async function loadVendors() {
  try { renderVendors((await call(adminVendors, $('t-v-status').value, $('t-v-q').value.trim())).vendors || []); } catch (e) { fail(e); }
}

/* ---------- Signalements ---------- */
const REASON = { not_delivered: 'Payé, commande non reçue', not_as_described: 'Produit non conforme', scam: 'Arnaque / faux vendeur', harassment: 'Harcèlement', other: 'Autre' };
const R_STATUS = { new: ['warn', 'Nouveau'], reviewing: ['', 'En cours'], resolved: ['ok', 'Traité'], dismissed: ['', 'Rejeté'] };
async function reportAct(r, status, note) {
  try { await call(adminReportSet, r.id, status, note); say('Fait.', true); await Promise.all([loadReports(), loadTrust()]); } catch (e) { fail(e); }
}
function renderReports(list) {
  const ul = $('t-rlist');
  ul.replaceChildren();
  if (!list.length) { ul.appendChild(mk('li', 'muted', 'Aucun signalement pour ce filtre.')); return; }
  for (const r of list) {
    if (!UUID.test(String(r.id))) continue;
    const st = R_STATUS[r.status] || R_STATUS.new;
    const li = mk('li', 'item');
    const head = mk('div', 'item-head');
    head.append(mk('strong', null, String(r.vendor_name || 'Vendeur').slice(0, 60)), mk('span', 'badge ' + st[0], st[1]));
    li.appendChild(head);
    li.appendChild(mk('small', null, [REASON[r.reason] || r.reason, r.kind === 'shop' ? 'Vitrine' : 'Lien de paiement', fmt(r.created_at), Number(r.people_30d) > 1 ? '⚠ ' + r.people_30d + ' personnes différentes en 30 jours' : '1 personne en 30 jours'].join(' · ')));
    li.appendChild(mk('p', 'detail', String(r.details || '')));
    const extra = [r.contact ? 'Contact : ' + r.contact : '', r.order_ref ? 'Commande : ' + r.order_ref : '', r.vendor_status ? 'Compte vendeur : ' + (V_STATUS[r.vendor_status] || V_STATUS.none)[1] : '', r.admin_note ? 'Note : ' + r.admin_note : ''].filter(Boolean).join(' · ');
    if (extra) li.appendChild(mk('small', null, extra));
    const row = mk('div', 'item-actions');
    const add = (label, cls, fn) => { const b = mk('button', 'btn ' + cls + ' small', label); b.type = 'button'; b.onclick = fn; row.appendChild(b); };
    if (validId(r.target_id)) {
      const a = mk('a', 'btn ghost small', r.kind === 'shop' ? 'Voir la vitrine' : 'Voir le lien');
      a.href = (r.kind === 'shop' ? 'index.html#/express?s=' : 'index.html#/pay?i=') + r.target_id;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      row.appendChild(a);
    }
    if (r.status !== 'reviewing') add('En cours', 'secondary', () => reportAct(r, 'reviewing', null));
    if (r.status !== 'resolved') add('Traité', 'primary', () => { const n = askNote('Note interne (facultatif) :'); if (n !== null) reportAct(r, 'resolved', n); });
    if (r.status !== 'dismissed') add('Rejeter', 'secondary', () => { const n = askNote('Pourquoi rejeter ? (facultatif)'); if (n !== null) reportAct(r, 'dismissed', n); });
    if (UUID.test(String(r.owner_id || '')) && r.vendor_status !== 'suspended') add('Suspendre le vendeur', 'secondary', () => { const n = askNote('Motif de la suspension (facultatif) :'); if (n !== null) vendorAct({ id: r.owner_id }, 'suspend', n); });
    li.appendChild(row);
    ul.appendChild(li);
  }
}
async function loadReports() {
  try { renderReports((await call(adminReports, $('t-r-status').value)).reports || []); } catch (e) { fail(e); }
}

$('t-v-status').addEventListener('change', loadVendors);
let timer;
$('t-v-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadVendors, 350); });
$('t-r-status').addEventListener('change', loadReports);

function start() {
  if ($('view-panel').hidden || !pass()) return;
  dead = false;
  card.hidden = false;
  loadTrust(); loadVendors(); loadReports();
}
new MutationObserver(start).observe($('view-panel'), { attributes: true, attributeFilter: ['hidden'] });
start();
