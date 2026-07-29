//javascript
// ============================================================
// ai-ncards — App (frontend) Integrated with New Worker Backend
// Uses OpenRouter streaming (SSE) with model inclusionai/ling-2.6-flash
// and pipes SSE directly from the worker proxy.
// ============================================================

const KEY = 'ai_ncards_v3';
const DEF_PROXY = 'https://orproxy.ai-n.workers.dev';
const SYS = `You are ai-ncards, a card-based document builder.
- Style with !theme:Name,Bg,CardBg,Text,Border,Primary! or !bg:#hex! !text:#hex! etc
- Edit request: "New Request: [text]" / response: "New Response: [text]"
- Actions: !action:merge !action:clear !action:view:grid
User speaks naturally. Build the doc.`;

class App {
  constructor() {
    this.cards = [];
    this.hist = [];
    this.sid = 'sess_' + Date.now();
    this.uid = 'user_' + Math.random().toString(36).slice(2, 9);
    this.sel = new Set();
    this.ctxId = null;
    this.fsId = null;
    this.fsFlip = false;
    this.stId = null;
    this.pCtx = null;
    this.ab = null;
    this.dec = new TextDecoder();
  }

  // ─── Init ───
  init() {
    this.load();
    this.applyTheme();
    this.applyView();
    this.bind();
    this.render();
    this.updToggles();
    const p = ge('proxyUrl');
    if (p && this.settings?.proxyUrl) p.value = this.settings.proxyUrl;
    ge('stPad').oninput = e => ge('stPadV').textContent = e.target.value;
    ge('stRad').oninput = e => ge('stRadV').textContent = e.target.value;
  }

  proxyUrl() {
    const v = ge('proxyUrl')?.value.trim();
    if (v) {
      this.settings.proxyUrl = v;
      this.save();
      return v;
    }
    return this.settings?.proxyUrl || DEF_PROXY;
  }

  // ─── Events ───
  bind() {
    ge('sendBtn').onclick = () => this.send();
    ge('input').onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    };
    ge('menuBtn').onclick = () => this.openModal('modalProxy');
    ge('viewFab').onclick = () => this.cycleView();
    ge('undoBtn').onclick = () => this.undo();
    ge('cancelSel').onclick = () => this.clearSel();
    ge('mergeSel').onclick = () => this.prompt('merge');
    ge('deleteSel').onclick = () => this.bulkDel();
    ge('splitSel').onclick = () => this.prompt('split');
    ge('promptGo').onclick = () => this.execPrompt();

    ge('ctxMenu').onclick = e => {
      const b = e.target.closest('button');
      if (!b || !this.ctxId) return;
      const a = b.dataset.act;
      if (a === 'continue' || a === 'magic' || a === 'merge' || a === 'split') this.handleAction(a, this.ctxId);
      else {
        if (a === 'undo') this.undo();
        else this.handleAction(a, this.ctxId);
      }
      this.closeCtx();
    };

    qsa('.overlay').forEach(o => {
      o.onclick = e => {
        if (e.target === o) this.closeModal(o.id);
      };
    });
  }

  // ─── Storage ───
  save() {
    ls(KEY, JSON.stringify({
      cards: this.cards,
      theme: this.theme,
      settings: this.settings,
      sessionId: this.sid,
      userId: this.uid
    }));
  }

  load() {
    try {
      const d = JSON.parse(ls(KEY));
      if (!d) return;
      this.cards = d.cards || [];
      this.theme = { ...this.theme, ...d.theme };
      this.settings = { ...this.settings, ...d.settings };
      this.sid = d.sessionId || this.sid;
      this.uid = d.userId || this.uid;
    } catch {
      /* ignore */
    }
  }

  pushHist(t) {
    if (this.hist.length > 10) this.hist.shift();
    this.hist.push({
      cards: JSON.parse(JSON.stringify(this.cards)),
      theme: { ...this.theme },
      ts: Date.now(),
      action: t
    });
  }

  undo() {
    if (!this.hist.length) return toast('Nothing to undo');
    const s = this.hist.pop();
    this.cards = s.cards;
    if (!this.theme.locked) this.theme = s.theme;
    this.save();
    this.render();
    this.applyTheme();
    toast('Undid: ' + s.action);
  }

  // ─── Cards ───
  addCard(q, r, s = {}) {
    const id = crypto.randomUUID();
    const c = { id, q, r, styles: s };
    this.cards.push(c);
    this.pushHist('Add');
    this.renderCard(c, true);
    return id;
  }

  delCard(id) {
    this.cards = this.cards.filter(c => c.id !== id);
    qs(`.card[data-id="${id}"]`)?.remove();
    if (this.fsId === id) this.closeFs();
    this.save();
  }

  updCard(id, q, r) {
    const c = this.cards.find(x => x.id === id);
    if (!c) return;
    if (q !== null) c.q = q;
    if (r !== null) c.r = r;
    const el = qs(`.card[data-id="${id}"]`);
    if (el) {
      if (q !== null) el.querySelector('.face:first-child .face-c').innerHTML = this.md(q);
      if (r !== null) {
        const re = el.querySelector('.face-c:last-child');
        if (re) re.innerHTML = this.md(r);
      }
    }
    this.save();
  }

  // ─── Render ───
  render() {
    const g = ge('grid');
    g.innerHTML = '';
    this.updCount();
    this.cards.forEach(c => this.renderCard(c, false));
  }

  renderCard(card, isNew) {
    const g = ge('grid');
    const div = document.createElement('div');
    div.className = `card${isNew ? ' new' : ''}`;
    div.dataset.id = card.id;
    div.tabIndex = 0;
    if (card.styles?.locked) div.classList.add('locked');

    const isStream = card.r === '...';
    const rHtml = isStream ? '<div class="thinking"><span>Thinking</span></div>' : this.md(card.r);

    div.innerHTML = `
      <div class="card-body">
        <div class="face">
          <div class="face-h"><span>Request</span>
            <div class="actions">
              <button onclick="app.openCtx('${card.id}',event)"><i class="fas fa-ellipsis-v"></i></button>
              <button onclick="app.toggleSel('${card.id}',event)"><i class="fas fa-check-circle"></i></button>
            </div>
          </div>
          <div class="face-c">${this.md(card.q)}</div>
        </div>
        <div class="face back">
          <div class="face-h"><span>Response</span>
            <div class="actions">
              <button onclick="app.readTTS('${card.id}',event)"><i class="fas fa-volume-up"></i></button>
              <button onclick="app.openCtx('${card.id}',event)"><i class="fas fa-ellipsis-v"></i></button>
            </div>
          </div>
          <div class="face-c">${rHtml}</div>
        </div>
      </div>`;

    if (card.styles) this.applyStyle(div, card.styles);
    this.attachEv(div, card.id);
    g.appendChild(div);
    this.updCount();
  }

  attachEv(div, id) {
    div.onclick = e => {
      if (e.target.closest('button') || e.target.closest('.actions')) return;
      if (this.sel.size) {
        e.stopPropagation();
        this.toggleSel(id, e);
        return;
      }
      div.classList.toggle('flip');
    };

    let lastTap = 0;
    div.ontouchend = e => {
      const t = Date.now() - lastTap;
      if (t < 300 && t > 0) {
        if (!e.target.closest('button')) {
          this.openFs(id);
          e.preventDefault();
        }
      }
      lastTap = Date.now();
    };

    div.ondblclick = e => {
      if (!e.target.closest('button')) this.openFs(id);
    };

    let pt;
    div.ontouchstart = e => {
      if (this.sel.size) return;
      pt = setTimeout(() => {
        this.openCtx(id, e);
        navigator.vibrate?.(50);
      }, 400);
    };
    div.ontouchend = () => clearTimeout(pt);
    div.ontouchmove = () => clearTimeout(pt);
  }

  updCount() {
    ge('cardCount').textContent = this.cards.length;
  }

  // ─── Send / AI ───
  send() {
    const inp = ge('input');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';

    // Build messages in OpenRouter chat format
    const msgs = [{ role: 'system', content: SYS }];
    if (this.sel.size) {
      this.sel.forEach(id => {
        const c = this.cards.find(x => x.id === id);
        if (c) {
          msgs.push({ role: 'user', content: c.q });
          msgs.push({ role: 'assistant', content: c.r });
        }
      });
      this.clearSel();
      this.updSelUI();
    }
    msgs.push({ role: 'user', content: v });

    this.sid = this.addCard('...', '...', {});
    const el = qs(`.card[data-id="${this.sid}"]`);
    if (el) el.classList.add('flip');

    this.ab = new AbortController();
    this.pipeChat(msgs, el);
  }

  async pipeChat(msgs, el) {
    this.sid = this.sid || (() => { const id = crypto.randomUUID(); this.addCard('...', '...', {}); return id; })();
    const cardId = this.sid;
    const container = el || qs(`.card[data-id="${cardId}"]`);
    const answerEl = container ? container.querySelector('.face-c:last-child') : null;
    if (answerEl) answerEl.innerHTML = '<span class="cursor"></span>';

    try {
      const url = this.proxyUrl();
      const res = await fetch(`${url}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://ai.nspired.cc',
          'X-Title': 'ai-ncards'
        },
        signal: this.ab.signal,
        body: JSON.stringify({
          messages: msgs,
          model: 'inclusionai/ling-2.6-flash',
          stream: true,
          max_tokens: 2000
        })
      });

      if (!res.ok) throw new Error(`Proxy: ${res.status}`);
      await this.pipeSSE(res.body, answerEl);
    } catch (err) {
      if (err.name === 'AbortError') this.finalize(cardId, '[Stopped]');
      else this.finalize(cardId, '<span style="color:#ff5252;font-weight:700">' + err.message + '</span>');
      this.ab = null;
    }
  }

  async pipeSSE(readable, answerEl) {
    const decoder = new TextDecoder();
    const cardId = this.sid;
    let buffer = '';

    if (answerEl) answerEl.innerHTML = '<span class="cursor"></span>';

    try {
      const reader = readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const raw of lines) {
          const s = raw.replace('data: ', '').trim();
          if (!s || s === '[DONE]') continue;
          try {
            const j = JSON.parse(s);
            const c = j.choices?.[0]?.delta?.content;
            if (c) this.updateAnswer(cardId, c, answerEl);
          } catch {
            /* ignore malformed chunks */
          }
        }
      }
      this.finalize(cardId, '', true);
    } catch (e) {
      this.finalize(cardId, e.message);
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  updateAnswer(cardId, chunk, explicitEl) {
    const el = explicitEl || qs(`.card[data-id="${cardId}"] .face-c:last-child`);
    const fsCont = ge('fsContent');
    const clean = chunk.replace(/<span class="cursor"><\/span>/g, '');
    if (el) el.innerHTML = el.innerHTML.replace(/<span class="cursor"><\/span>/g, '') + this.md(clean) + '<span class="cursor"></span>';
    if (fsCont) fsCont.innerHTML = fsCont.innerHTML.replace(/<span class="cursor"><\/span>/g, '') + this.md(clean) + '<span class="cursor"></span>';
  }

  finalize(id, chunk = '', append = true) {
    if (!id) return;
    const el = qs(`.card[data-id="${id}"] .face-c`);
    const fsCont = ge('fsContent');
    if (append) {
      if (el) el.innerHTML = el.innerHTML.replace(/<span class="cursor"><\/span>/g, '') + this.md(chunk) + '<span class="cursor"></span>';
      if (fsCont) fsCont.innerHTML = fsCont.innerHTML.replace(/<span class="cursor"><\/span>/g, '') + this.md(chunk) + '<span class="cursor"></span>';
    } else {
      if (el) el.innerHTML = this.md(chunk);
      if (fsCont) fsCont.innerHTML = this.md(chunk);
    }
    if (this.sid === id) {
      const gridAnswer = qs('.face-c:last-child');
      if (gridAnswer) gridAnswer.innerHTML = gridAnswer.innerHTML.replace(/<span class="cursor"><\/span>/g, '');
    }
  }

  // ─── Context Menu ───
  openCtx(id, e) {
    const b = e.target.closest('button');
    if (!b) return;
    this.ctxId = id;
    const m = ge('ctxMenu');
    let x = e.clientX || window.innerWidth / 2;
    let y = e.clientY || window.innerHeight / 2;
    if (x + 180 > innerWidth) x = innerWidth - 190;
    if (y + 260 > innerHeight) y = innerHeight - 270;
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    m.classList.add('show');
  }

  closeCtx() {
    ge('ctxMenu').classList.remove('show');
    this.ctxId = null;
  }

  handleAction(action, id) {
    const c = this.cards.find(x => x.id === id);
    if (!c) return;
    switch (action) {
      case 'continue':
        this.prompt('continue', id);
        break;
      case 'split':
        this.prompt('split', id);
        break;
      case 'merge':
        this.sel.add(id);
        qs(`.card[data-id="${id}"]`)?.classList.add('sel');
        if (this.sel.size < 2) toast('Select 2+ cards');
        this.updSelUI();
        this.prompt('merge');
        break;
      case 'magic':
        this.prompt('magic', id);
        break;
      case 'copy':
        navigator.clipboard?.writeText((c.r || c.q || ''));
        toast('Copied');
        break;
      case 'fullscreen':
        this.openFs(id);
        break;
      case 'delete':
        if (confirm('Delete?')) {
          this.delCard(id);
          toast('Deleted');
        }
        break;
      case 'style':
        this.stId = id;
        this.loadStyle(c.styles || {});
        this.openModal('modalStyle');
        break;
    }
  }

  // ─── Selection ───
  toggleSel(id, e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const el = qs(`.card[data-id="${id}"]`);
    if (this.sel.has(id)) {
      this.sel.delete(id);
      el?.classList.remove('sel');
    } else {
      this.sel.add(id);
      el?.classList.add('sel');
    }
    this.updSelUI();
  }

  updSelUI() {
    const b = ge('selectionBar');
    if (this.sel.size) {
      b.classList.add('show');
      ge('selCount').textContent = this.sel.size;
    } else {
      b.classList.remove('show');
    }
  }

  clearSel() {
    this.sel.forEach(id => qs(`.card[data-id="${id}"]`)?.classList.remove('sel'));
    this.sel.clear();
    this.updSelUI();
  }

  // ─── Prompt Actions ───
  prompt(action, id = null) {
    if (!id && this.sel.size) id = Array.from(this.sel)[0];
    if (!id && action !== 'merge') return;

    this.pCtx = { action, id };
    const ti = ge('promptTitle');
    const de = ge('promptDesc');
    const ar = ge('promptArea');

    const labels = {
      magic: ['Magic Action', 'Edit text, change styles, or use !action:...', 'Execute', 'e.g., Make professional'],
      continue: ['Continue', 'Continue the response.', 'Continue', 'Continue the thought...'],
      split: ['Split Card', 'How to split this content?', 'Split', 'Split into points...'],
      merge: ['Merge Cards', 'Combine selected cards.', `Merge (${this.sel.size})`, 'Merge into summary...']
    };

    const [l, t, bt, p] = labels[action] || ['Action', '', 'Go', ''];
    ti.textContent = l;
    de.textContent = t;
    ar.placeholder = p || 'Instructions...';

    if (action === 'merge') {
      const content = Array.from(this.sel).map(id => {
        const c = this.cards.find(x => x.id === id);
        return c ? `---\n${c.q}\n${c.r}` : '';
      }).join('\n');
      ar.value = `Merge these based on: \n\n${content}`;
    }

    this.openModal('modalPrompt');
  }

  execPrompt() {
    const instructions = ge('promptArea').value.trim();
    const { action, id } = this.pCtx;
    const c = this.cards.find(x => x.id === id);

    this.closeModal('modalPrompt');
    ge('promptArea').value = '';
    if (!c && action !== 'merge') return;

    if (action === 'merge') {
      this.mergeCards(instructions);
      return;
    }

    if (!c) return;

    if (action === 'magic') this.streamReq(`Current Request: "${c.q}". Current Response: "${c.r}". INSTRUCTIONS: ${instructions}`, id);
    else if (action === 'continue') this.streamReq(`CONTINUE: Original: "${c.q}". Current: "${c.r}". Instruct: ${instructions}`, id);
    else if (action === 'split') this.streamReq(`SPLIT: ${instructions}. Text: ${c.r}`, null);
    toast('Processing...');
  }

  mergeCards(instructions = '') {
    if (this.sel.size < 2) return toast('Select 2+ cards');
    const sel = Array.from(this.sel);
    const cardObjs = sel.map(id => this.cards.find(c => c.id === id)).filter(Boolean);
    const content = cardObjs.map(c => `---\n${c.q}\n${c.r}`).join('\n');
    const prompt = instructions ? `Merge these based on: ${instructions}\n\n${content}` : `Combine these:\n\n${content}`;
    const id = this.addCard('Merged cards', '...', {});
    this.sid = id;
    this.clearSel();
    this.streamReq(prompt, id);
  }

  // ─── Style Modal ───
  loadStyle(styles) {
    ge('lockStyle').checked = !!styles.locked;
    ge('stColor').value = styles.color || '#e8e8e8';
    ge('stBg').value = styles.backgroundColor || '#1a1a2e';
    ge('stBorder').value = styles.borderColor || '#2a2a3e';
    ge('stPad').value = parseInt(styles.padding || '14');
    ge('stRad').value = parseInt(styles.borderRadius || '12');
    ge('stPadV').textContent = parseInt(styles.padding || '14');
    ge('stRadV').textContent = parseInt(styles.borderRadius || '12');
  }

  saveStyle() {
    if (!this.stId) return;
    const styles = {
      locked: ge('lockStyle').checked,
      color: ge('stColor').value,
      backgroundColor: ge('stBg').value,
      borderColor: ge('stBorder').value,
      padding: ge('stPad').value + 'px',
      borderRadius: ge('stRad').value + 'px'
    };
    const card = this.cards.find(c => c.id === this.stId);
    if (card) {
      card.styles = { ...card.styles, ...styles };
      this.save();
      const el = qs(`.card[data-id="${this.stId}"]`);
      if (el) {
        this.applyStyle(el, styles);
        if (styles.locked) el.classList.add('locked');
        else el.classList.remove('locked');
      }
      this.pushHist('Style');
      this.closeModal('modalStyle');
    }
  }

  // ─── Fullscreen ───
  openFs(id) {
    const c = this.cards.find(x => x.id === id);
    if (!c) return;
    this.fsId = id;
    this.fsFlip = false;
    ge('fsContent').innerHTML = this.md(c.r);
    ge('fullscreen').classList.add('show');
  }

  closeFs() {
    ge('fullscreen').classList.remove('show');
    this.fsId = null;
    this.fsFlip = false;
  }

  toggleFsFlip() {
    this.fsFlip = !this.fsFlip;
    const c = this.cards.find(x => x.id === this.fsId);
    if (!c) return;
    ge('fsContent').innerHTML = this.md(this.fsFlip ? c.q : c.r);
  }

  toggleNative() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  // ─── View ───
  cycleView() {
    const v = ['list', 'grid', 'full'];
    const i = v.indexOf(this.settings.view);
    this.settings.view = v[(i + 1) % v.length];
    this.applyView();
    this.save();
  }

  setView(v) {
    this.settings.view = v;
    this.applyView();
    this.save();
    this.closeModal('modalProxy');
  }

  applyView() {
    document.body.className = 'view-' + this.settings.view;
    const m = { list: 'fas fa-list', grid: 'fas fa-th', full: 'fas fa-expand' };
    ge('#viewFab i').className = m[this.settings.view] || 'fas fa-columns';
  }

  // ─── Theme ───
  applyTheme() {
    const r = document.documentElement;
    r.style.setProperty('--p', this.theme.primary);
    r.style.setProperty('--bg', this.theme.bg);
    r.style.setProperty('--cb', this.theme.cardBg);
    r.style.setProperty('--t', this.theme.text);
    r.style.setProperty('--b', this.theme.border);
  }

  // ─── Cloud Sync ───
  async syncToWorker() {
    const url = this.proxyUrl();
    const api = url.replace('/chat', '');
    try {
      const res = await fetch(`${api}/api/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Bulk sync', response: JSON.stringify(this.cards) })
      });
      toast(res.ok ? 'Pushed to cloud' : 'Sync failed');
    } catch {
      toast('Sync failed');
    }
  }

  async syncFromWorker() {
    const url = this.proxyUrl();
    const api = url.replace('/chat', '');
    try {
      const res = await fetch(`${api}/api/cards`);
      const d = await res.json();
      if (d?.cards?.length) {
        this.pushHist('Cloud Pull');
        this.cards = d.cards.map(c => ({ id: c.id, q: c.q, r: c.r, styles: c.styles || {} }));
        this.save();
        this.render();
        toast(`Pulled ${d.cards.length} cards`);
      }
    } catch {
      toast('Pull failed');
    }
  }

  // ─── Helpers ───
  closeModal(id) {
    ge(id).classList.remove('show');
    if (id === 'modalPrompt') this.pCtx = null;
    if (id === 'modalStyle') this.stId = null;
  }
}

// ─── Helpers ───
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const ge = i => document.getElementById(i);
const qs = $;
function ls(k, v) {
  if (v === undefined) return localStorage.getItem(k);
  localStorage.setItem(k, v);
}
function toast(m) {
  const t = ge('toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(ge('_tt'));
  ge('_tt') = setTimeout(() => t.classList.remove('show'), 1800);
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});