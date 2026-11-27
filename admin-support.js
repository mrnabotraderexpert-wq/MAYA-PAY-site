// Onglet « Assistance » de l'administration : liste des conversations et réponses.
import { supportAdminList, supportAdminGet, supportAdminReply, supportAdminClose } from './api.js';

const PASS_KEY = 'mayapay.admin';
const pass = () => { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch { return ''; } };
const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const card = $('support-card');
const box = $('support-box');
const msg = $('support-msg');
let cur = null;       // conversation ouverte {id, name, phone, closed}
let lastId = 0;
let dead = false;     // mot de passe refusé : on arrête d'interroger le serveur
let timer = 0;

const panelVisible = () => !$('view-panel').hidden && pass() && !dead;
const say = (t) => { msg.textContent = t || ''; msg.className = 'msg ' + (t ? 'bad' : ''); };

async function call(fn, ...a) {
  const r = await fn(pass(), ...a);
  if (r && r.error) { if (r.error === 'forbidden' || r.error === 'locked') dead = true; throw new Error(r.error); }
  return r;
}

async function showList() {
  cur = null; lastId = 0;
  try {
    const r = await call(supportAdminList);
    box.textContent = '';
    const ul = mk('ul', 'list');
    const th = r.threads || [];
    const unread = th.reduce((n, t) => n + (Number(t.unread_admin) || 0), 0);
    const tag = $('support-unread');
    tag.textContent = unread + ' non lu' + (unread > 1 ? 's' : '');
    tag.hidden = !unread;
    if (!th.length) ul.appendChild(mk('li', 'muted', 'Aucune conversation pour le moment.'));
    for (const t of th) {
      const li = mk('li');
      const b = mk('button', 'btn secondary block', '');
      b.type = 'button'; b.style.textAlign = 'left';
      const who = (t.name || '').trim() || (t.phone || '').trim() || 'Client anonyme';
      b.appendChild(mk('strong', '', who + (t.unread_admin ? '  ● ' + t.unread_admin + ' non lu' + (t.unread_admin > 1 ? 's' : '') : '') + (t.closed ? '  (clôturée)' : '')));
      b.appendChild(mk('br'));
      b.appendChild(mk('small', 'muted', fmt(t.last_at) + ' — ' + String(t.last || '').slice(0, 80)));
      b.onclick = () => openThread(t);
      li.appendChild(b); ul.appendChild(li);
    }
    box.appendChild(ul);
    say('');
  } catch { say('Chargement impossible.'); }
}

function renderMessages(list, add) {
  for (const m of add) {
    const b = mk('div', '', m.body);
    b.style.cssText = 'max-width:85%;padding:8px 12px;border-radius:12px;margin:4px 0;white-space:pre-wrap;word-break:break-word;' +
      (m.from_admin ? 'margin-left:auto;background:#F7870F;color:#fff' : 'background:#fff;border:1px solid #DCE3F4');
    b.appendChild(mk('small', '', ' ')); b.lastChild.style.cssText = 'display:block;font-size:11px;opacity:.7';
    b.lastChild.textContent = fmt(m.created_at);
    list.appendChild(b);
  }
  if (add.length) { list.scrollTop = list.scrollHeight; lastId = add[add.length - 1].id; }
}

async function openThread(t) {
  cur = t; lastId = 0;
  box.textContent = '';
  const bar = mk('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap';
  const back = mk('button', 'btn ghost small', '← Conversations'); back.type = 'button'; back.onclick = showList;
  const title = mk('strong', '', ((t.name || '').trim() || 'Client anonyme') + (t.phone ? ' · ' + t.phone : ''));
  const close = mk('button', 'btn secondary small', t.closed ? 'Rouvrir' : 'Clôturer'); close.type = 'button';
  close.onclick = async () => { try { await call(supportAdminClose, t.id, !t.closed); t.closed = !t.closed; close.textContent = t.closed ? 'Rouvrir' : 'Clôturer'; } catch { say('Action impossible.'); } };
  bar.append(back, title, close);
  const list = mk('div'); list.id = 'support-thread';
  list.style.cssText = 'height:320px;overflow-y:auto;padding:8px;background:#F3F6FE;border-radius:12px';
  const form = mk('form'); form.style.cssText = 'display:flex;gap:8px;margin-top:8px';
  const ta = mk('textarea'); ta.maxLength = 1000; ta.placeholder = 'Votre réponse…'; ta.rows = 2;
  ta.style.cssText = 'flex:1;border:1px solid #CFC8BE;border-radius:12px;padding:8px 10px;font:inherit;resize:none';
  const send = mk('button', 'btn primary', 'Envoyer'); send.type = 'submit';
  form.append(ta, send);
  box.append(bar, list, form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = ta.value.trim(); if (!body) return;
    send.disabled = true;
    try { await call(supportAdminReply, t.id, body); ta.value = ''; await pollThread(); say(''); }
    catch { say('Envoi impossible.'); }
    send.disabled = false;
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  await pollThread();
}

async function pollThread() {
  if (!cur) return;
  try {
    const r = await call(supportAdminGet, cur.id, lastId);
    const list = $('support-thread');
    if (list && cur) renderMessages(list, r.messages || []);
  } catch { /* ignoré */ }
}

async function tick() {
  if (!panelVisible() || document.visibilityState !== 'visible') return;
  if (cur) await pollThread(); else await showList();
}

// Démarre (ou redémarre après une reconnexion) dès que le tableau de bord est affiché.
function start() {
  if ($('view-panel').hidden || !pass()) return;
  dead = false; card.hidden = false;
  if (!timer) timer = setInterval(tick, 8000);
  showList();
}
new MutationObserver(start).observe($('view-panel'), { attributes: true, attributeFilter: ['hidden'] });
start();
