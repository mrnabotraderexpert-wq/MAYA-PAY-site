// Bulle « Assistance » : messagerie client ↔ administrateur MAYA-PAY, sans compte.
import { supportSend, supportFetch, serverReady } from './api.js';

if (serverReady()) {
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
  let msgs = [];
  let lastId = 0;
  let seen = Number(st.seen) || 0;
  let open = false;
  let sending = false;

  const css = document.createElement('style');
  css.textContent = `
  #sp-fab{position:fixed;right:14px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;align-items:center;gap:8px;height:48px;padding:0 16px;border:0;border-radius:24px;background:var(--orange,#F7870F);color:#fff;font:700 14px Montserrat,system-ui,sans-serif;box-shadow:0 4px 14px rgba(10,31,77,.25);cursor:pointer}
  #sp-fab[hidden]{display:none}
  #sp-fab svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  #sp-badge{min-width:20px;height:20px;border-radius:10px;background:#B3261E;color:#fff;font-size:12px;line-height:20px;text-align:center;padding:0 5px}
  #sp-panel{position:fixed;right:0;bottom:0;left:0;z-index:70;display:none;flex-direction:column;max-height:85vh;height:520px;background:var(--card,#fff);border-radius:16px 16px 0 0;box-shadow:0 -6px 24px rgba(10,31,77,.3);font-family:Montserrat,system-ui,sans-serif;color:var(--ink,#0A1F4D);padding-bottom:env(safe-area-inset-bottom,0px)}
  @media(min-width:520px){#sp-panel{left:auto;right:14px;bottom:14px;width:380px;border-radius:16px}}
  #sp-panel.on{display:flex}
  #sp-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--navy,#0A1F4D);color:#fff;border-radius:16px 16px 0 0}
  #sp-head b{font-size:15px}#sp-head small{display:block;font-size:12px;opacity:.8}
  #sp-x{border:0;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
  #sp-list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--paper,#F3F6FE)}
  .sp-m{max-width:82%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
  .sp-m small{display:block;font-size:11px;opacity:.65;margin-top:3px}
  .sp-me{align-self:flex-end;background:var(--orange,#F7870F);color:#fff;border-bottom-right-radius:4px}
  .sp-ad{align-self:flex-start;background:#fff;border:1px solid var(--line,#DCE3F4);border-bottom-left-radius:4px}
  .sp-empty{margin:auto;text-align:center;color:var(--mute,#3F4F7C);font-size:14px;padding:0 16px}
  #sp-id{display:none;gap:6px;padding:8px 12px 0}
  #sp-id.on{display:flex}
  #sp-id input,#sp-in{border:1px solid var(--line,#DCE3F4);border-radius:12px;font:inherit;font-size:14px;padding:8px 10px;min-width:0}
  #sp-id input{flex:1}
  #sp-form{display:flex;gap:8px;padding:10px 12px}
  #sp-in{flex:1;resize:none;height:42px}
  #sp-send{border:0;border-radius:12px;background:var(--orange,#F7870F);color:#fff;font:700 14px inherit;padding:0 16px;cursor:pointer}
  #sp-send:disabled{opacity:.6}
  #sp-err{color:#B3261E;font-size:12px;padding:0 14px 6px;min-height:0}`;
  document.head.appendChild(css);

  const mk = (tag, attrs = {}, text) => { const e = document.createElement(tag); Object.assign(e, attrs); if (text != null) e.textContent = text; return e; };

  const fab = mk('button', { id: 'sp-fab', type: 'button' });
  fab.setAttribute('aria-label', 'Assistance');
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z"/></svg>';
  fab.appendChild(mk('span', {}, 'Assistance'));
  const badge = mk('span', { id: 'sp-badge' }); badge.hidden = true; fab.appendChild(badge);

  const panel = mk('div', { id: 'sp-panel' });
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Assistance MAYA-PAY');
  const head = mk('div', { id: 'sp-head' });
  const ht = mk('div'); ht.appendChild(mk('b', {}, 'Assistance MAYA-PAY')); ht.appendChild(mk('small', {}, 'Écrivez-nous, nous répondons dès que possible.'));
  const xb = mk('button', { id: 'sp-x', type: 'button' }, '×'); xb.setAttribute('aria-label', 'Fermer');
  head.append(ht, xb);
  const list = mk('div', { id: 'sp-list' });
  const idBox = mk('div', { id: 'sp-id' });
  const iName = mk('input', { placeholder: 'Votre nom (facultatif)', maxLength: 60 });
  const iPhone = mk('input', { placeholder: 'Votre numéro (facultatif)', type: 'tel', maxLength: 20 });
  idBox.append(iName, iPhone);
  const err = mk('div', { id: 'sp-err' });
  const form = mk('form', { id: 'sp-form' });
  const inp = mk('textarea', { id: 'sp-in', placeholder: 'Votre message…', maxLength: 1000, rows: 1 });
  const sendBtn = mk('button', { id: 'sp-send', type: 'submit' }, 'Envoyer');
  form.append(inp, sendBtn);
  panel.append(head, list, idBox, err, form);
  document.body.append(fab, panel);

  const hm = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function render() {
    list.textContent = '';
    if (!msgs.length) list.appendChild(mk('p', { className: 'sp-empty' }, 'Une question sur un paiement ou un lien ? Écrivez votre message ci-dessous.'));
    for (const m of msgs) {
      const b = mk('div', { className: 'sp-m ' + (m.from_admin ? 'sp-ad' : 'sp-me') }, m.body);
      b.appendChild(mk('small', {}, (m.from_admin ? 'MAYA-PAY · ' : '') + hm(m.created_at)));
      list.appendChild(b);
    }
    list.scrollTop = list.scrollHeight;
    idBox.classList.toggle('on', !st.token);
  }

  function updateBadge() {
    const n = msgs.filter((m) => m.from_admin && m.id > seen).length;
    badge.hidden = !n || open; badge.textContent = String(n);
  }

  async function poll() {
    if (!st.token || document.visibilityState !== 'visible') return;
    try {
      const r = await supportFetch(st.token, lastId);
      const add = (r && r.messages) || [];
      if (add.length) {
        msgs = msgs.concat(add); lastId = msgs[msgs.length - 1].id;
        if (open) { seen = lastId; st.seen = seen; save(st); render(); }
      }
      updateBadge();
    } catch { /* ignoré : nouvel essai au prochain passage */ }
  }

  function setOpen(v) {
    open = v; panel.classList.toggle('on', v); fab.hidden = v;
    if (v) { seen = lastId; st.seen = seen; save(st); updateBadge(); render(); poll(); setTimeout(() => inp.focus(), 50); }
  }
  fab.onclick = () => setOpen(true);
  xb.onclick = () => setOpen(false);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = inp.value.trim();
    if (!body || sending) return;
    sending = true; sendBtn.disabled = true; err.textContent = '';
    try {
      if (!st.token) { st.token = newToken(); st.name = iName.value.trim(); st.phone = iPhone.value.trim(); save(st); }
      const r = await supportSend(st.token, st.name, st.phone, body);
      if (r && r.error) err.textContent = ERR[r.error] || 'Envoi impossible.';
    else { inp.value = ''; await poll(); }
    } catch { err.textContent = ERR.network; }
    sending = false; sendBtn.disabled = false; render();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  if (st.token) poll();
  setInterval(() => { if (st.token) poll(); }, 6000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
}
