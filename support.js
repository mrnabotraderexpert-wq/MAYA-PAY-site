// Bulle « Assistance » : un assistant automatique (local, sans API externe) + la messagerie avec l'équipe MAYA-PAY.
import { supportSend, supportFetch, serverReady } from './api.js';
import { answer, reply, starters } from './assistant.js';

const online = serverReady();
const KEY = 'mayapay.support';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignoré */ } };
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const ERR = {
  rate: 'Trop de messages, réessayez dans une heure.',
  busy: 'Le service est très sollicité, réessayez dans un moment.',
  message: 'Message vide ou trop long (1000 caractères maximum).',
  network: 'Connexion impossible. Réessayez.',
};

let st = load();
let msgs = [];          // messages de l'équipe
let lastId = 0;
let seen = Number(st.seen) || 0;
let open = false;
let sending = false;
let tab = 'bot';        // 'bot' | 'team'
let bot = [];           // conversation avec l'assistant (en mémoire seulement, jamais enregistrée)
let ctx = {};
let lastQuestion = '';

const css = document.createElement('style');
css.textContent = `
#sp-fab{position:fixed;right:14px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;align-items:center;gap:8px;height:48px;padding:0 16px;border:0;border-radius:24px;background:var(--orange,#F7870F);color:#fff;font:700 14px Montserrat,system-ui,sans-serif;box-shadow:0 4px 14px rgba(10,31,77,.25);cursor:pointer}
#sp-fab[hidden]{display:none}
#sp-fab svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
body:has(#view-pay:not([hidden])) #sp-fab{width:48px;padding:0;justify-content:center}
body:has(#view-pay:not([hidden])) #sp-fab .sp-lbl{display:none}
#sp-fab{position:fixed}
#sp-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#B3261E;color:#fff;font-size:12px;line-height:20px;text-align:center;padding:0 5px}
#sp-panel{position:fixed;right:0;bottom:0;left:0;z-index:70;display:none;flex-direction:column;max-height:88vh;height:560px;background:var(--card,#fff);border-radius:16px 16px 0 0;box-shadow:0 -6px 24px rgba(10,31,77,.3);font-family:Montserrat,system-ui,sans-serif;color:var(--ink,#0A1F4D);padding-bottom:env(safe-area-inset-bottom,0px)}
@media(min-width:520px){#sp-panel{left:auto;right:14px;bottom:14px;width:380px;border-radius:16px}}
#sp-panel.on{display:flex}
#sp-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--navy,#0A1F4D);color:#fff;border-radius:16px 16px 0 0}
#sp-head b{font-size:15px}#sp-head small{display:block;font-size:12px;opacity:.8}
#sp-x{border:0;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
#sp-tabs{display:flex;gap:4px;padding:8px 12px 0;background:var(--paper,#F3F6FE)}
#sp-tabs button{position:relative;flex:1;border:0;border-bottom:3px solid transparent;background:transparent;padding:8px 4px;font:600 13px inherit;color:var(--mute,#3F4F7C);cursor:pointer}
#sp-tabs button[aria-selected=true]{color:var(--ink,#0A1F4D);border-bottom-color:var(--orange,#F7870F)}
#sp-tabs .tb{display:inline-block;margin-left:6px;min-width:18px;height:18px;border-radius:9px;background:#B3261E;color:#fff;font-size:11px;line-height:18px;padding:0 5px}
#sp-list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--paper,#F3F6FE)}
.sp-m{max-width:86%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.sp-m small{display:block;font-size:11px;opacity:.65;margin-top:3px}
.sp-me{align-self:flex-end;background:var(--orange,#F7870F);color:#fff;border-bottom-right-radius:4px}
.sp-ad{align-self:flex-start;background:#fff;border:1px solid var(--line,#DCE3F4);border-bottom-left-radius:4px}
.sp-m a{color:var(--orange-d,#E07408);font-weight:600}
.sp-empty{margin:auto;text-align:center;color:var(--mute,#3F4F7C);font-size:14px;padding:0 16px}
.sp-chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:100%}
.sp-chip{border:1.5px solid var(--line,#DCE3F4);background:#fff;border-radius:16px;padding:6px 12px;font:600 12.5px inherit;color:var(--ink,#0A1F4D);cursor:pointer;text-align:left}
.sp-chip:hover,.sp-chip:focus-visible{border-color:var(--orange,#F7870F)}
.sp-chip.team{background:var(--navy,#0A1F4D);border-color:var(--navy,#0A1F4D);color:#fff}
.sp-note{font-size:11.5px;color:var(--mute,#3F4F7C);text-align:center;padding:2px 8px}
.sp-typing{align-self:flex-start;background:#fff;border:1px solid var(--line,#DCE3F4);border-radius:14px;padding:8px 14px;font-size:18px;letter-spacing:2px;color:var(--mute,#3F4F7C)}
#sp-id{display:none;gap:6px;padding:8px 12px 0}
#sp-id.on{display:flex}
#sp-id input,#sp-in{border:1px solid var(--line,#DCE3F4);border-radius:12px;font:inherit;font-size:14px;padding:8px 10px;min-width:0}
#sp-id input{width:auto}
#sp-id input{flex:1}
#sp-form{display:flex;gap:8px;padding:10px 12px;align-items:stretch}
#sp-in{flex:1;resize:none;height:44px;min-height:0;width:auto;line-height:1.3}
#sp-send{border:0;border-radius:12px;background:var(--orange,#F7870F);color:#fff;font:700 14px Montserrat,system-ui,sans-serif;padding:0 16px;cursor:pointer;height:44px}
#sp-send:disabled{opacity:.6}
#sp-err{color:#B3261E;font-size:12px;padding:0 14px 6px;min-height:0}
@media (prefers-reduced-motion:no-preference){.sp-m,.sp-chips{animation:spin .18s ease-out}@keyframes spin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}}`;
document.head.appendChild(css);

const mk = (tag, attrs = {}, text) => { const e = document.createElement(tag); Object.assign(e, attrs); if (text != null) e.textContent = text; return e; };

const fab = mk('button', { id: 'sp-fab', type: 'button' });
fab.setAttribute('aria-label', 'Assistance');
fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z"/></svg>';
fab.appendChild(mk('span', { className: 'sp-lbl' }, 'Assistance'));
const badge = mk('span', { id: 'sp-badge' }); badge.hidden = true; fab.appendChild(badge);

const panel = mk('div', { id: 'sp-panel' });
panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Assistance MAYA-PAY');
const head = mk('div', { id: 'sp-head' });
const ht = mk('div'); const htTitle = mk('b', {}, 'Assistance MAYA-PAY'); const htSub = mk('small'); ht.append(htTitle, htSub);
const xb = mk('button', { id: 'sp-x', type: 'button' }, '×'); xb.setAttribute('aria-label', 'Fermer');
head.append(ht, xb);

const tabs = mk('div', { id: 'sp-tabs' });
tabs.setAttribute('role', 'tablist');
const tBot = mk('button', { type: 'button' }, 'Assistant');
const tTeam = mk('button', { type: 'button' }, 'Équipe');
for (const b of [tBot, tTeam]) b.setAttribute('role', 'tab');
const tbBadge = mk('span', { className: 'tb' }); tbBadge.hidden = true; tTeam.appendChild(tbBadge);
tabs.append(tBot);
if (online) tabs.append(tTeam);

const list = mk('div', { id: 'sp-list' });
list.setAttribute('aria-live', 'polite');
const idBox = mk('div', { id: 'sp-id' });
const iName = mk('input', { placeholder: 'Nom (facultatif)', maxLength: 60 });
const iPhone = mk('input', { placeholder: 'Numéro (facultatif)', type: 'tel', maxLength: 20 });
idBox.append(iName, iPhone);
const err = mk('div', { id: 'sp-err' });
const form = mk('form', { id: 'sp-form' });
const inp = mk('textarea', { id: 'sp-in', maxLength: 1000, rows: 1 });
const sendBtn = mk('button', { id: 'sp-send', type: 'submit' }, 'Envoyer');
form.append(inp, sendBtn);
panel.append(head, tabs, list, idBox, err, form);
document.body.append(fab, panel);

const hm = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const inPay = () => { const v = document.getElementById('view-pay'); return Boolean(v && !v.hidden); };

// ——— Assistant ———
function botSay(r) {
  bot.push({ who: 'bot', text: r.text, links: r.links });
  if (r.topic) ctx.last = r.topic;
  const chips = (r.chips || []).map((c) => ({ label: c.label, ask: c.ask }));
  if (r.human && online) chips.push({ label: 'Écrire à l’équipe', team: true });
  if (chips.length) bot.push({ who: 'chips', chips });
}
function botGreet() {
  ctx = { client: inPay() };
  bot = [{ who: 'bot', text: 'Bonjour, je suis l’assistant MAYA-PAY. Je réponds tout de suite aux questions sur les liens, les paiements, la confirmation par SMS et la sécurité.' },
    { who: 'chips', chips: starters(ctx).map((c) => ({ label: c.label, ask: c.ask })) }];
}
function ask(text) {
  lastQuestion = text;
  bot = bot.filter((m) => m.who !== 'chips');
  bot.push({ who: 'me', text });
  render();
  const typing = mk('div', { className: 'sp-typing' }, '•••'); list.appendChild(typing); list.scrollTop = list.scrollHeight;
  setTimeout(() => { ctx.client = inPay(); botSay(answer(text, ctx)); render(); }, 350);
}
function pick(c) {
  if (c.team) return switchTab('team', true);
  const r = reply(c.ask);
  bot = bot.filter((m) => m.who !== 'chips');
  bot.push({ who: 'me', text: c.label });
  botSay(r); render();
}

function renderBot() {
  list.textContent = '';
  for (const m of bot) {
    if (m.who === 'chips') {
      const row = mk('div', { className: 'sp-chips' });
      for (const c of m.chips) {
        const b = mk('button', { type: 'button', className: 'sp-chip' + (c.team ? ' team' : '') }, c.label);
        b.onclick = () => pick(c);
        row.appendChild(b);
      }
      list.appendChild(row);
      continue;
    }
    const b = mk('div', { className: 'sp-m ' + (m.who === 'me' ? 'sp-me' : 'sp-ad') }, m.text);
    for (const l of m.links || []) { b.appendChild(document.createTextNode('\n')); const a = mk('a', { href: l.href, target: '_blank', rel: 'noopener' }, l.label); b.appendChild(a); }
    list.appendChild(b);
  }
  list.appendChild(mk('p', { className: 'sp-note' }, 'Assistant automatique : il connaît MAYA-PAY mais ne voit ni votre compte ni vos paiements.'));
  // Une réponse longue se lit depuis son début ; une question de l'utilisateur, on descend en bas.
  const last = [...bot].reverse().find((m) => m.who !== 'chips');
  const bubbles = list.querySelectorAll('.sp-ad');
  if (last && last.who === 'bot' && bubbles.length) {
    const b = bubbles[bubbles.length - 1];
    list.scrollTop += b.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
  } else list.scrollTop = list.scrollHeight;
}

function renderTeam() {
  list.textContent = '';
  if (!msgs.length) list.appendChild(mk('p', { className: 'sp-empty' }, 'Une question sur un paiement ou un lien ? Écrivez votre message ci-dessous : l’équipe répond dès que possible.'));
  for (const m of msgs) {
    const b = mk('div', { className: 'sp-m ' + (m.from_admin ? 'sp-ad' : 'sp-me') }, m.body);
    b.appendChild(mk('small', {}, (m.from_admin ? 'MAYA-PAY · ' : '') + hm(m.created_at)));
    list.appendChild(b);
  }
  list.scrollTop = list.scrollHeight;
}

function render() {
  const isBot = tab === 'bot';
  tBot.setAttribute('aria-selected', String(isBot)); tTeam.setAttribute('aria-selected', String(!isBot));
  htSub.textContent = isBot ? 'Assistant automatique · réponses immédiates' : 'Écrivez-nous, nous répondons dès que possible.';
  inp.placeholder = isBot ? 'Posez votre question…' : 'Votre message à l’équipe…';
  sendBtn.textContent = isBot ? 'Demander' : 'Envoyer';
  idBox.classList.toggle('on', !isBot && !st.token);
  err.textContent = '';
  if (isBot) renderBot(); else renderTeam();
}

function switchTab(t, prefill) {
  tab = t;
  if (t === 'team') { seen = lastId; st.seen = seen; save(st); updateBadge(); if (prefill && lastQuestion && !inp.value) inp.value = lastQuestion; poll(); }
  render(); setTimeout(() => inp.focus(), 50);
}
tBot.onclick = () => switchTab('bot');
tTeam.onclick = () => switchTab('team');

function updateBadge() {
  const n = msgs.filter((m) => m.from_admin && m.id > seen).length;
  badge.hidden = !n || open; badge.textContent = String(n);
  tbBadge.hidden = !n || tab === 'team'; tbBadge.textContent = String(n);
}

async function poll() {
  if (!online || !st.token || document.visibilityState !== 'visible') return;
  try {
    const r = await supportFetch(st.token, lastId);
    const add = (r && r.messages) || [];
    if (add.length) {
      msgs = msgs.concat(add); lastId = msgs[msgs.length - 1].id;
      if (open && tab === 'team') { seen = lastId; st.seen = seen; save(st); renderTeam(); }
    }
    updateBadge();
  } catch { /* ignoré : nouvel essai au prochain passage */ }
}

function setOpen(v) {
  open = v; panel.classList.toggle('on', v); fab.hidden = v;
  if (v) {
    if (!bot.length) botGreet();
    // S'il y a une réponse non lue de l'équipe, on ouvre directement la messagerie.
    tab = msgs.some((m) => m.from_admin && m.id > seen) ? 'team' : tab;
    if (tab === 'team') { seen = lastId; st.seen = seen; save(st); }
    updateBadge(); render(); poll(); setTimeout(() => inp.focus(), 50);
  }
}
fab.onclick = () => setOpen(true);
xb.onclick = () => setOpen(false);

form.onsubmit = async (e) => {
  e.preventDefault();
  const body = inp.value.trim();
  if (!body || sending) return;
  if (tab === 'bot') { inp.value = ''; ask(body); return; }
  sending = true; sendBtn.disabled = true; err.textContent = '';
  try {
    if (!st.token) { st.token = newToken(); st.name = iName.value.trim(); st.phone = iPhone.value.trim(); save(st); }
    const r = await supportSend(st.token, st.name, st.phone, body);
    if (r && r.error) err.textContent = ERR[r.error] || 'Envoi impossible.';
    else { inp.value = ''; await poll(); }
  } catch { err.textContent = ERR.network; }
  sending = false; sendBtn.disabled = false;
  const msg = err.textContent; render(); err.textContent = msg;
};
inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });

if (online && st.token) poll();
setInterval(() => { if (online && st.token) poll(); }, 6000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
