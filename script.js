// runtime proxy for OpenRouter (deploy this as a Worker/endpoint)
const RUNTIME_PROXY = 'https://ai.nspired.cc/chat'; // <- deploy the runtime proxy at this URL

const MSG = `You are ai-ncards, a card-based document builder.
- Style with !theme:Name,Bg,CardBg,Text,Border,Primary!
- Edit request: "New Request: [text]" / response: "New Response: [text]"
- Actions: !action:merge !action:clear !action:view:grid
User speaks naturally. Build the doc.`;

const ls = (k, v) => (v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v));
const toast = (m) => { const t = el('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); };
const el = (s) => document.querySelector(s);
const qs = (s) => document.querySelector(s);

const app = {
  cards: [], hist: [], sid: null, uid: 'u_' + Math.random().toString(36).slice(2, 9),
  sel: new Set(), ctxId: null, fsId: null, fsFlip: false, stId: null, pCtx: null, ab: null,
  dec: new TextDecoder(), settings: { view: 'grid', proxyUrl: '' },
  theme: { name: 'ai-ncards', primary: '#c41e3a', bg: '#0d0d0d', cardBg: '#1a1a2e', text: '#e8e8e8', border: '#2a2a3e', locked: false },

  save() { try { ls('ai_ncards', JSON.stringify({ cards: this.cards, theme: this.theme, settings: this.settings, sessionId: this.sid, userId: this.uid })); } catch {} },
  load() { try { const d = JSON.parse(ls('ai_ncards')); if (!d) return; this.cards = d.cards || []; this.theme = { ...this.theme, ...d.theme }; this.settings = { ...this.settings, ...d.settings }; this.sid = d.sessionId || null; this.uid = d.userId || this.uid; } catch {} },
  applyTheme() { Object.entries(this.theme).forEach(([k, v]) => document.documentElement.style.setProperty(`--${k === 'primary' ? 'p' : k}`, v)); },
  applyView() { document.body.className = 'view-' + this.settings.view; },
  toggleTheme() { this.theme.bg = this.theme.bg === '#0d0d0d' ? '#f5f5f5' : '#0d0d0d'; this.theme.cardBg = this.theme.bg === '#f5f5f5' ? '#ffffff' : '#1a1a2e'; this.theme.text = this.theme.bg === '#f5f5f5' ? '#222' : '#e8e8e8'; this.applyTheme(); this.save(); },
  toggleLock() { this.theme.locked = !this.theme.locked; this.applyTheme(); this.save(); toast(this.theme.locked ? 'Locked' : 'Unlocked'); },
  setView(v) { this.settings.view = v; this.applyView(); this.save(); this.closeModal('Proxy'); },
  proxyUrl() {
    // prefer runtime proxy, fall back to optional param
    const runtime = RUNTIME_PROXY || '';
    const fromInput = el('proxyUrl')?.value.trim();
    return fromInput || runtime || '';
  },

  pushHist(t) { if (this.hist.length > 10) this.hist.shift(); this.hist.push({ cards: structuredClone(this.cards), theme: { ...this.theme }, ts: Date.now(), action: t }); },
  undo() { if (!this.hist.length) return toast('Nothing to undo'); const s = this.hist.pop(); this.cards = s.cards; if (!this.theme.locked) this.theme = s.theme; this.save(); this.render(); this.applyTheme(); toast('Undid: ' + s.action); },

  addCard(q, r, st = {}) { const id = crypto.randomUUID(); this.cards.push({ id, q, r, styles: st }); this.pushHist('Add'); this.renderCard(this.cards[this.cards.length - 1], true); return id; },
  delCard(id) { this.cards = this.cards.filter(c => c.id !== id); qs(`.card[data-id="${id}"]`)?.remove(); if (this.fsId === id) this.closeFs(); this.save(); },
  updCard(id, q, r) {
    const c = this.cards.find(x => x.id === id); if (!c) return;
    if (q !== null) c.q = q; if (r !== null) c.r = r;
    const el = qs(`.card[data-id="${id}"]`);
    if (el) { if (q !== null) el.querySelector('.face:first-child .face-c').innerHTML = this.md(q); if (r !== null) { const re = el.querySelector('.face-c:last-child'); if (re) re.innerHTML = this.md(r); } }
    this.save();
  },

  render() { el('grid').innerHTML = ''; this.updCount(); this.cards.forEach(c => this.renderCard(c, false)); },
  renderCard(card, isNew) {
    const div = document.createElement('div'); div.className = `card${isNew ? ' new' : ''}`; div.dataset.id = card.id; div.tabIndex = 0;
    if (card.styles?.locked) div.classList.add('locked');
    const isStream = card.r === '...'; const rHtml = isStream ? '<div class="thinking"><span>Thinking</span></div>' : this.md(card.r);
    div.innerHTML = `<div class="card-body">
      <div class="face"><div class="face-h"><span>Request</span><div class="actions"><button onclick="openCtxFor('${card.id}', event.clientX, event.clientY)" title="More"><i class="fas fa-ellipsis-v"></i></button><button onclick="app.toggleSel('${card.id}', event)" title="Select"><i class="fas fa-check-circle"></i></button></div></div><div class="face-c">${this.md(card.q)}</div></div>
      <div class="face back"><div class="face-h"><span>Response</span><div class="actions"><button onclick="app.readTTS('${card.id}', event)" title="Play TTS"><i class="fas fa-volume-up"></i></button><button onclick="openCtxFor('${card.id}', event.clientX, event.clientY)" title="More"><i class="fas fa-ellipsis-v"></i></button></div></div><div class="face-c">${rHtml}</div></div></div>`;
    if (card.styles) this.applyStyle(div, card.styles);
    this.attachEv(div, card.id); el('grid').appendChild(div); this.updCount();
  },
  attachEv(div, id) {
    div.onclick = e => {
      if (e.target.closest('button') || e.target.closest('.actions')) return;
      if (this.sel.size) { e.stopPropagation(); this.toggleSel(id, e); return; }
      div.classList.toggle('flip');
    };
    let t;
    div.ontouchend = e => { clearTimeout(t); t = setTimeout(() => openCtxFor(id, e.clientX, e.clientY), 400); };
    div.ondblclick = e => { if (!e.target.closest('button')) this.openFs(id); };
    let pt;
    div.ontouchstart = e => { if (this.sel.size) return; pt = setTimeout(() => { openCtxFor(id, e.clientX, e.clientY); navigator.vibrate?.(50); }, 400); };
    div.ontouchend = () => clearTimeout(pt); div.ontouchmove = () => clearTimeout(pt);
  },
  updCount() { el('cardCount').textContent = this.cards.length; },

  async send() {
    const inp = el('input'); let v = inp.value.trim(); if (!v) return; inp.value = '';
    const msgs = [{ role: 'system', content: MSG }];
    if (this.sel.size) {
      this.sel.forEach(id => { const c = this.cards.find(x => x.id === id); if (c) msgs.push({ role: 'user', content: c.q }, { role: 'assistant', content: c.r }); });
      this.clearSel(); this.updSelUI();
    }
    msgs.push({ role: 'user', content: v });
    this.sid = this.addCard(v, '...', {});
    const elCard = qs(`.card[data-id="${this.sid}"]`);
    if (elCard) elCard.classList.add('flip');
    this.ab = new AbortController();
    await this.pipeChat(msgs, elCard);
  },
  async pipeChat(msgs, el) {
    const cardId = this.sid;
    const container = el || qs(`.card[data-id="${cardId}"]`);
    const answerEl = container?.querySelector('.face-c:last-child');
    let buf = '', first = true;
    if (answerEl) answerEl.innerHTML = '<span class="cursor"></span>';
    try {
      const body = { messages: msgs, model: 'inclusionai/ling-2.6-flash', stream: true, max_tokens: 2000 };
      const res = await fetch(`${this.proxyUrl()}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.settings.openRouterKey ? { 'Authorization': `Bearer ${this.settings.openRouterKey}` } : {})
        },
        signal: this.ab.signal,
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Proxy: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const raw of lines) {
          const s = raw.replace('data: ', '').trim();
          if (!s || s === '[DONE]') continue;
          try {
            const j = JSON.parse(s);
            const c = j.choices?.[0]?.delta?.content;
            if (c) { if (first) { this.updateAnswer(cardId, c, answerEl, true); first = false; } else this.updateAnswer(cardId, c, answerEl, false); }
          } catch {}
        }
      }
      this.finalize(cardId, '', true);
    } catch (err) {
      if (err.name === 'AbortError') this.finalize(cardId, '[Stopped]');
      else this.finalize(cardId, '<span style="color:#ff5252;font-weight:700">' + err.message + '</span>');
    } finally { this.ab = null; }
  },
  updateAnswer(id, chunk, el, full) {
    const fsCont = el('fsContent');
    const clean = chunk.replace(/<span class="cursor"><\/span>/g, '');
    if (full && el) el.innerHTML = this.md(clean);
    if (el) el.innerHTML = el.innerHTML.replace(/<span class="cursor"><\/span>/g, '') + this.md(clean) + '<span class="cursor"></span>';
    if (fsCont) fsCont.innerHTML = fsCont.innerHTML.replace(/<span class="cursor"><\/span>/g, '') + this.md(clean) + '<span class="cursor"></span>';
  },
  finalize(id, ch = '', app = false) {
    if (!id) return;
    const el = qs(`.card[data-id="${id}"] .face-c`);
    const fsCont = el('fsContent');
    const mdCh = this.md(ch);
    if (app) { if (el) el.innerHTML = mdCh; if (fsCont) fsCont.innerHTML = mdCh; } else { if (el) el.innerHTML = mdCh; if (fsCont) fsCont.innerHTML = mdCh; }
  },

  openCtx(id, ex, ey) {
    this.ctxId = id;
    const m = el('ctxMenu');
    let x = ex || innerWidth / 2;
    let y = ey || innerHeight / 2;
    if (x + 180 > innerWidth) x = innerWidth - 190;
    if (y + 260 > innerHeight) y = innerHeight - 270;
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    m.classList.add('show');
  },
  closeCtx() { el('ctxMenu')?.classList.remove('show'); this.ctxId = null; },
  handleAction(a, id) {
    this.closeCtx();
    const c = this.cards.find(x => x.id === id);
    if (!c) return;
    switch (a) {
      case 'continue': this.prompt('continue', id); break;
      case 'split': this.prompt('split', id); break;
      case 'merge':
        this.sel.add(id); qs(`.card[data-id="${id}"]`)?.classList.add('sel');
        if (this.sel.size < 2) toast('Select 2+ cards');
        this.updSelUI();
        this.prompt('merge');
        break;
      case 'magic': this.prompt('magic', id); break;
      case 'copy': navigator.clipboard?.writeText((c.r || c.q || '')); toast('Copied'); break;
      case 'fullscreen': this.openFs(id); break;
      case 'delete': if (confirm('Delete?')) { this.delCard(id); toast('Deleted'); this.closeCtx(); } break;
      case 'style': this.stId = id; this.loadStyle(c.styles || {}); this.openModal('modalStyle'); break;
    }
  },

  toggleSel(id, e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const el = qs(`.card[data-id="${id}"]`);
    if (this.sel.has(id)) { this.sel.delete(id); el?.classList.remove('sel'); }
    else { this.sel.add(id); el?.classList.add('sel'); }
    this.updSelUI();
  },
  updSelUI() {
    const bar = el('selectionBar');
    if (this.sel.size) { bar.classList.add('show'); el('selCount').textContent = this.sel.size; }
    else bar.classList.remove('show');
  },
  clearSel() { this.sel.forEach(id => qs(`.card[data-id="${id}"]`)?.classList.remove('sel')); this.sel.clear(); this.updSelUI(); },
  bulkDel() {
    if (!this.sel.size) return;
    if (confirm(`Delete ${this.sel.size} card${this.sel.size > 1 ? 's' : ''}?`)) {
      this.pushHist('Bulk Delete');
      Array.from(this.sel).forEach(id => this.delCard(id));
      this.clearSel();
    }
  },

  prompt(a, id = null) {
    if (!id && this.sel.size) id = Array.from(this.sel)[0];
    if (!id && a !== 'merge') return;
    this.pCtx = { action: a, id: id };
    const ti = el('promptTitle'), de = el('promptDesc'), ar = el('promptArea');
    const labels = { magic: ['Magic Action', 'Edit text, change styles, or use !action:...', 'Execute'], continue: ['Continue', 'Continue the response.', 'Continue'], split: ['Split Card', 'How to split this content?', 'Split'], merge: ['Merge Cards', 'Combine selected cards.', `Merge (${this.sel.size})`] };
    const [l, t, bt] = labels[a] || ['Action', '', 'Go'];
    ti.textContent = l; de.textContent = t; ar.placeholder = 'Instructions';
    if (a === 'merge') {
      const content = Array.from(this.sel).map(id => { const c = this.cards.find(x => x.id === id); return c ? `---\n${c.q}\n${c.r}` : ''; }).join('\n');
      ar.value = `Merge these based on: \n\n${content}`;
    } else ar.value = '';
    this.openModal('Prompt');
  },
  execPrompt() {
    const ins = el('promptArea').value.trim();
    const { action, id } = this.pCtx;
    const c = this.cards.find(x => x.id === id);
    this.closeModal('Prompt');
    el('promptArea').value = '';
    if (action === 'merge') { this.mergeCards(ins); return; }
    if (!c) return;
    if (action === 'magic') this.streamReq(`Current Request: "${c.q}". Current Response: "${c.r}". INSTRUCTIONS: ${ins}`, id);
    else if (action === 'continue') this.streamReq(`CONTINUE: Original: "${c.q}". Current: "${c.r}". Instruct: ${ins}`, id);
    else if (action === 'split') this.streamReq(`SPLIT: ${ins}. Text: ${c.r}`, null);
    toast('Processing');
  },
  mergeCards(inst = '') {
    if (this.sel.size < 2) return toast('Select 2+ cards');
    const objs = Array.from(this.sel).map(id => this.cards.find(c => c.id === id)).filter(Boolean);
    const content = objs.map(c => `---\n${c.q}\n${c.r}`).join('\n');
    const prompt = inst ? `Merge these based on: ${inst}\n\n${content}` : `Combine these:\n\n${content}`;
    const id = this.addCard('Merged cards', '...', {});
    this.sid = id;
    this.clearSel();
    this.streamReq(prompt, id);
  },

  loadStyle(st) {
    el('lockStyle')?.classList.toggle('on', !!st.locked);
    el('stColor')!.value = st.color || '#e8e8e8';
    el('stBg')!.value = st.backgroundColor || '#1a1a2e';
    el('stBorder')!.value = st.borderColor || '#2a2a3e';
    el('stPad')!.value = parseInt(st.padding || '14');
    el('stRad')!.value = parseInt(st.borderRadius || '12');
    el('stPadV')!.textContent = parseInt(st.padding || '14') + 'px';
    el('stRadV')!.textContent = parseInt(st.borderRadius || '12') + 'px';
  },
  saveStyle() {
    if (!this.stId) return;
    const s = {
      locked: el('lockStyle')?.classList.contains('on'),
      color: el('stColor')!.value,
      backgroundColor: el('stBg')!.value,
      borderColor: el('stBorder')!.value,
      padding: el('stPad')!.value + 'px',
      borderRadius: el('stRad')!.value + 'px',
    };
    const c = this.cards.find(x => x.id === this.stId);
    if (c) {
      c.styles = { ...c.styles, ...s };
      this.save();
      const tpl = qs(`.card[data-id="${this.stId}"]`);
      if (tpl) {
        this.applyStyle(tpl, s);
        if (s.locked) tpl.classList.add('locked'); else tpl.classList.remove('locked');
      }
      this.pushHist('Style');
      this.closeModal('Style');
    }
  },

  openFs(id) {
    const c = this.cards.find(x => x.id === id);
    if (!c) return;
    this.fsId = id; this.fsFlip = false;
    el('fsContent')!.innerHTML = this.md(c.r);
    this.openModal('Fullscreen');
  },
  closeFs() { el('fullscreen')?.classList.remove('show'); this.fsId = null; this.fsFlip = false; },
  toggleFsFlip() { this.fsFlip = !this.fsFlip; const c = this.cards.find(x => x.id === this.fsId); if (!c) return; el('fsContent')!.innerHTML = this.md(this.fsFlip ? c.q : c.r); },
  toggleNative() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); },

  cycleView() { const v = ['list', 'grid', 'full']; const i = v.indexOf(this.settings.view); this.settings.view = v[(i + 1) % v.length]; this.applyView(); this.save(); this.closeModal('Proxy'); },

  md(t) { return t ? marked.parse(t) : ''; }
};

function openModal(id) {
  const container = el('#modalContainer');
  if (!container) return;
  if (id === 'modalProxy') {
    const existing = container.querySelector('#modalProxy');
    if (existing) return;
    const wrap = document.createElement('div');
    wrap.className = 'overlay show';
    wrap.id = 'modalProxy';
    wrap.innerHTML = `<div class="modal" id="modalProxyContent" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>ai-ncards</h3><button class="btn" id="closeProxy">✕</button></div>
      <div class="modal-b">
        <div class="section"><h4>API Proxy Settings</h4>
          <div class="cp"><span>Custom Proxy</span><input id="proxyUrl" type="text" placeholder="https://ai.nspired.cc/chat" /></div>
          <div class="btn-group"><button class="btn primary" id="saveProxy">Save</button><button class="btn" id="resetProxy">Reset</button></div>
          <small>Overrides default endpoint.</small>
        </div>
        <div class="section"><h4>Viewport</h4>
          <div class="btn-group"><button class="tgl" id="viewList" onclick="app.setView('list')">List</button><button class="tgl" id="viewGrid" onclick="app.setView('grid')">Grid</button><button class="tgl" id="viewFull" onclick="app.setView('full')">Full</button></div>
        </div>
        <div class="section"><h4>Theme Presets</h4>
          <div class="btn-group"><button class="btn" onclick="app.toggleTheme()">Toggle Light/Dark</button><button class="btn" onclick="app.toggleLock()">Toggle Locked</button></div>
        </div>
        <div class="section"><h4>Sync</h4>
          <div class="btn-group"><button class="btn" onclick="app.syncToWorker()">Push to Cloud</button><button class="btn" onclick="app.syncFromWorker()">Pull from Cloud</button></div>
        </div>
        <div class="section"><h4>Import / Export</h4>
          <div class="btn-group"><button class="btn" onclick="exportData()">Export JSON</button><label class="btn">Import JSON<input type="file" id="importFile" accept=".json" onchange="importData(event)" style="display:none" /></label></div>
        </div>
        <div class="section"><h4>Clear</h4><div class="btn-group"><button class="btn danger" onclick="clearAll()">Clear All</button></div></div>
      </div>
      <div class="modal-f"><button class="btn" id="closeProxyM">Close</button></div>
    </div></div>`;
    container.appendChild(wrap);
    el('#closeProxy')?.addEventListener('click', () => el('#modalProxy')?.remove());
    el('#closeProxyM')?.addEventListener('click', () => el('#modalProxy')?.remove());
    el('#saveProxy')?.addEventListener('click', () => { app.settings.proxyUrl = app.proxyUrl(); app.save(); });
    el('#resetProxy')?.addEventListener('click', () => { el('#proxyUrl').value = RUNTIME_PROXY; app.settings.proxyUrl = ''; app.save(); });
  } else {
    const existing = container.querySelector('#' + id);
    if (existing) return;
    let html = '';
    if (id === 'modalStyle') html = `<div class="modal" id="modalStyleContent" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>Style Card</h3><button class="btn" id="closeStyle">✕</button></div>
      <div class="modal-b">
        <div class="sl"><span class="desc">Locked</span><button class="tgl" id="lockStyle">Off</button></div>
        <div class="cp"><span class="desc">Text</span><input id="stColor" type="text" /></div>
        <div class="cp"><span class="desc">Background</span><input id="stBg" type="text" /></div>
        <div class="cp"><span class="desc">Border</span><input id="stBorder" type="text" /></div>
        <div class="sl"><span class="desc">Padding</span><input id="stPad" type="text" value="14" /></div>
        <div class="sl"><span class="desc">Radius</span><input id="stRad" type="text" value="12" /></div>
        <div class="btn-group"><button class="btn primary" id="saveStyle">Apply</button></div>
        <small id="stPadV" style="display:none"></small><small id="stRadV" style="display:none"></small>
      </div>
    </div></div>`;
    else if (id === 'modalPrompt') html = `<div class="modal" id="modalPromptContent" role="dialog" aria-modal="true">
      <div class="modal-h"><h3 id="promptTitle"></h3><button class="btn" id="closePrompt">✕</button></div>
      <div class="modal-b">
        <div class="desc"><span id="promptDesc"></span></div>
        <textarea id="promptArea" placeholder="Instructions"></textarea>
        <div class="btn-group"><button class="btn primary" id="promptGo">Go</button><button class="btn" id="promptAreaHelp">Use !theme / !action syntax</button></div>
      </div>
    </div></div>`;
    else if (id === 'modalFullscreen') html = `<div class="modal" id="modalFullscreenContent" role="dialog" aria-modal="true">
      <div class="modal-h">
        <div class="fs-header">
          <span><i class="fas fa-expand"></i> Fullscreen</span>
          <div class="btn-group"><button class="btn" id="fsFlipBtn"><i class="fas fa-sync-alt"></i> Flip</button><button class="btn" id="fsReadBtn"><i class="fas fa-volume-up"></i> Speak</button><button class="btn" id="fsClose">Close</button></div>
        </div>
      </div>
      <div class="fs-body" id="fsContent"></div>
    </div></div>`;
    const wrap = document.createElement('div');
    wrap.className = 'overlay show';
    wrap.id = id;
    wrap.innerHTML = html;
    container.appendChild(wrap);

    if (id === 'modalStyle') {
      el('#closeStyle')?.addEventListener('click', () => el('#modalStyle')?.remove());
      el('#lockStyle')?.addEventListener('click', () => app.saveStyle());
      el('#saveStyle')?.addEventListener('click', () => app.saveStyle());
      loadStyleInputs();
    } else if (id === 'modalPrompt') {
      el('#closePrompt')?.addEventListener('click', () => el('#modalPrompt')?.remove());
      el('#promptGo')?.addEventListener('click', () => app.execPrompt());
      el('promptArea')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); app.execPrompt(); } });
    } else if (id === 'modalFullscreen') {
      el('#fsClose')?.addEventListener('click', () => el('#modalFullscreen')?.remove());
      el('#fsFlipBtn')?.addEventListener('click', () => app.toggleFsFlip());
      el('#fsReadBtn')?.addEventListener('click', () => app.toggleNative());
    }
  }
}
function closeModal(id) { el('#' + id)?.remove(); }
function loadStyleInputs() {
  const st = app.theme;
  el('#lockStyle')?.classList.toggle('on', !!st.locked);
  el('#stColor')!.value = st.color || '#e8e8e8';
  el('#stBg')!.value = st.bg || '#1a1a2e';
  el('#stBorder')!.value = st.border || '#2a2a3e';
  el('#stPad')!.value = parseInt(st.padding || '14');
  el('#stRad')!.value = parseInt(st.borderRadius || '12');
  el('#stPadV')!.textContent = parseInt(st.padding || '14') + 'px';
  el('#stRadV')!.textContent = parseInt(st.borderRadius || '12') + 'px';
}

document.addEventListener('DOMContentLoaded', () => {
  app.load();
  app.applyTheme();
  app.applyView();
  app.render();
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); app.send(); }
  if (e.key === 'Escape') { el('#modalProxy')?.remove(); el('#modalStyle')?.remove(); el('#modalPrompt')?.remove(); el('#modalFullscreen')?.remove(); app.closeCtx(); }
});

el('sendBtn')?.addEventListener('click', () => app.send());
el('input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); app.send(); } });