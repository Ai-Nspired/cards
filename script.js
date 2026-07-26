const DEFAULT_PROXY_URL = "https://ai-proxy.ai-n.workers.dev";
const STORAGE_KEY = "ai_ndraft_data_v2";
const SYSTEM_PROMPT = `You are a helpful AI Document Drafter. You help build documents card by card.`;

class App {
    constructor() {
        this.cards = [];
        this.history = [];
        this.sessionId = "sess_" + Date.now();
        this.userId = "user_" + Math.random().toString(36).substr(2, 9);
        this.theme = { name: 'ai-Ncards', primary: '#c41e3a', bg: '#121212', cardBg: '#1e1e1e', text: '#f5f5f5', border: '#333', locked: false };
        this.settings = { view: 'list', autoTTS: false, asrEnabled: false, proxyUrl: '' };
        this.streamingId = null;
        this.selectedIds = new Set();
        this.contextMenuTargetId = null;
        this.fullscreenId = null;
        this.fsFlipped = false;
        this.editingId = null;
        this.stylingId = null;
        this.promptContext = null;
        this.recognizer = null;
        this.isListening = false;
        this.decoder = new TextDecoder();
        this.abortController = null;
        this.connected = false;
    }

    async init() {
        this.loadState();
        this.applyTheme();
        this.applyView();
        this.bindEvents();
        this.initASR();
        this.renderAll();
        this.updateToggles();
        this.checkConnection();
    }

    getProxyUrl() {
        const inputVal = document.getElementById('proxyUrlInput')?.value?.trim();
        if (inputVal) { this.settings.proxyUrl = inputVal; this.saveState(); return inputVal; }
        return this.settings.proxyUrl || DEFAULT_PROXY_URL;
    }

    async checkConnection() {
        try { await fetch(`${this.getProxyUrl()}/health`, { method: 'GET', mode: 'no-cors', credentials: 'omit' }); this.connected = true; } catch (e) { this.connected = false; }
    }

    saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: this.cards, theme: this.theme, settings: this.settings, sessionId: this.sessionId, userId: this.userId })); }

    loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) { const d = JSON.parse(raw); this.cards = d.cards || []; this.theme = { ...this.theme, ...d.theme }; this.settings = { ...this.settings, ...d.settings }; this.sessionId = d.sessionId || this.sessionId; this.userId = d.userId || this.userId; }
        } catch (e) { console.error("Load failed", e); }
    }

    pushHistory(actionType) {
        if (this.history.length > 10) this.history.shift();
        this.history.push({ cards: JSON.parse(JSON.stringify(this.cards)), theme: { ...this.theme }, timestamp: Date.now(), action: actionType });
        this.showToast(`Saved: ${actionType}`);
    }

    async undo() {
        if (this.history.length === 0) { this.showToast("Nothing to undo"); return; }
        const lastState = this.history.pop();
        this.cards = lastState.cards;
        if (!this.theme.locked) this.theme = lastState.theme;
        this.saveState();
        this.renderAll();
        this.applyTheme();
        this.showToast("Undid: " + lastState.action);
    }

    renderAll() {
        const grid = document.getElementById('grid');
        const empty = document.getElementById('emptyState');
        grid.innerHTML = '';
        if (this.cards.length === 0) { empty.style.display = 'flex'; }
        else { empty.style.display = 'none'; this.cards.forEach(c => this.renderCard(c, false)); }
    }

    renderCard(card, isNew) {
        const grid = document.getElementById('grid');
        const empty = document.getElementById('emptyState');
        if (empty && empty.parentNode) empty.remove();
        const div = document.createElement('div');
        div.className = `flip-card ${isNew ? 'new' : ''}`;
        div.dataset.id = card.id;
        div.tabIndex = 0;
        if (card.styles && card.styles.locked) div.classList.add('locked');
        const rHtml = (card.r === '...') ? (this.streamingId === card.id ? '<div class="streaming"><span class="thinking-indicator">Thinking...</span><button class="stop-stream-btn" onclick="app.stopStream()">Stop</button></div>' : '<div class="streaming"><span class="thinking-indicator">Thinking...</span></div>') : this.md(card.r);
        div.innerHTML = `
            <div class="flip-card-inner">
                <div class="card-face">
                    <div class="card-header">
                        <span style="font-size:11px; opacity:0.5;">REQ</span>
                        <div class="card-actions">
                            <button onclick="app.openCardMenu('${card.id}', event)"><i class="fas fa-ellipsis-v"></i></button>
                            <button onclick="app.toggleSelect('${card.id}', event)"><i class="fas fa-check-circle"></i></button>
                        </div>
                    </div>
                    <div class="content">${this.md(card.q)}</div>
                </div>
                <div class="card-face card-back">
                    <div class="card-header">
                        <span style="font-size:11px; opacity:0.5;">RESPONSE</span>
                        <div class="card-actions">
                            <button onclick="app.readCard('${card.id}', event)"><i class="fas fa-volume-up"></i></button>
                            <button onclick="app.openCardMenu('${card.id}', event)"><i class="fas fa-ellipsis-v"></i></button>
                        </div>
                    </div>
                    <div class="response-content">${rHtml}</div>
                </div>
            </div>
        `;
        if (card.styles) this.applyCardStyleToEl(div, card.styles);
        this.attachCardEvents(div, card.id);
        grid.appendChild(div);
    }

    attachCardEvents(div, id) {
        div.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.card-actions')) return;
            if (this.selectedIds.size > 0) { e.stopPropagation(); this.toggleSelect(id, e); return; }
            div.classList.toggle('flipped');
        });
        let lastTap = 0;
        div.addEventListener('touchend', (e) => {
            const t = new Date().getTime();
            if (t - lastTap < 300 && t - lastTap > 0) { if (e.target.closest('button')) return; this.openFullscreen(id); e.preventDefault(); }
            lastTap = t;
        });
        let pressTimer;
        div.addEventListener('touchstart', (e) => {
            if (this.selectedIds.size > 0) return;
            pressTimer = setTimeout(() => { this.openCardMenu(id, e); if (navigator.vibrate) navigator.vibrate(50); }, 400);
        });
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('touchmove', () => clearTimeout(pressTimer));
        div.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') div.classList.toggle('flipped');
            if (e.key === ' ' && e.shiftKey) { e.preventDefault(); this.openCardMenu(id); }
        });
    }

    async sendRequest(prompt, contextCardId = null) {
        this.streamingId = contextCardId ? contextCardId : this.addCard(prompt, '...', {});
        const cardEl = document.querySelector(`.flip-card[data-id="${this.streamingId}"]`);
        if (cardEl && !contextCardId) setTimeout(() => cardEl.classList.add('flipped'), 100);
        const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
        if (contextCardId) {
            const oldCard = this.cards.find(c => c.id === contextCardId);
            if (oldCard) {
                messages.push({ role: 'user', content: oldCard.q });
                messages.push({ role: 'assistant', content: oldCard.r });
            }
        }
        messages.push({ role: 'user', content: prompt });
        this.abortController = new AbortController();
        try {
            const res = await fetch(`${this.getProxyUrl()}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages, model: '@preset/default', userId: this.userId, sessionId: this.sessionId, enableSearch: false, maxContext: 32000 }),
                signal: this.abortController.signal,
                credentials: 'omit'
            });
            if (!res.ok) throw new Error(`Proxy Error: ${res.status}`);
            const reader = res.body.getReader();
            let buffer = '', accumulated = '';
            const processChunk = async () => {
                const { done, value } = await reader.read();
                if (done) { this.streamingId = null; return; }
                buffer += this.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    try {
                        const json = JSON.parse(jsonStr);
                        const chunk = json.choices?.[0]?.delta?.content;
                        if (chunk) { accumulated += chunk; this.updateStreamingContent(accumulated, lines.indexOf(line) === 0); }
                    } catch { }
                }
                setTimeout(processChunk, 1);
            };
            processChunk();
        } catch (err) {
            if (err.name === 'AbortError') { const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`); if (el) el.innerHTML += '<div style="color:#ff6b6b; margin-top:10px;">[Stopped]</div>'; }
            else { const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`); if (el) el.innerHTML = `<span style="color: #ff6b6b; font-weight: bold;">Error: ${err.message}</span>`; }
            this.streamingId = null;
        } finally { this.abortController = null; }
    }

    stopStream() { if (this.abortController) { this.abortController.abort(); this.abortController = null; } }

    updateStreamingContent(text, isFirst) {
        const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`);
        if (el) { el.innerHTML = this.md(text); if (isFirst) el.parentElement.parentElement.classList.add('flipped'); this.scrollToStreamingContent(el); }
    }

    finalizeResponse(text) { const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`); if (el) el.innerHTML = this.md(text); this.streamingId = null; }

    scrollToStreamingContent(el) { if (!el) return; const isNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 150; if (isNearBottom) el.scrollTop = el.scrollHeight; }

    addCard(q, r, styles = {}) {
        const id = Math.random().toString(36).substr(2, 9);
        this.cards.push({ id, q, r, styles });
        this.pushHistory("Add Card");
        this.renderCard({ id, q, r, styles }, true);
        return id;
    }

    deleteCard(id) {
        this.cards = this.cards.filter(c => c.id !== id);
        const el = document.querySelector(`.flip-card[data-id="${id}"]`);
        if (el) el.remove();
        if (this.fullscreenId === id) this.closeFullscreen();
        this.saveState();
    }

    updateCardContent(id, q, r) {
        const card = this.cards.find(c => c.id === id);
        if (!card) return;
        if (q !== null) card.q = q;
        if (r !== null) card.r = r;
        const el = document.querySelector(`.flip-card[data-id="${id}"]`);
        if (el) {
            if (q !== null) el.querySelector('.card-face:first-child .content').innerHTML = this.md(card.q);
            if (r !== null) {
                const rEl = el.querySelector('.response-content');
                if (rEl) rEl.innerHTML = this.md(r);
            }
        }
        this.saveState();
    }

    bindEvents() {
        document.getElementById('sendBtn').addEventListener('click', () => this.handleSendClick());
        const input = document.getElementById('userInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSendClick(); }
        });
        document.getElementById('menuFab').addEventListener('click', () => this.openModal('settingsModal'));
        document.getElementById('viewFab').addEventListener('click', () => this.cycleView());
        document.getElementById('undoFabTop').addEventListener('click', () => this.undo());
        document.getElementById('cancelSelect').addEventListener('click', () => this.clearSelection());
        document.getElementById('mergeSelected').addEventListener('click', () => this.promptAction('merge'));
        document.getElementById('deleteSelected').addEventListener('click', () => this.bulkDelete());
        document.getElementById('splitSelected').addEventListener('click', () => this.promptAction('split'));
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => { if (e.target === overlay) { const id = overlay.id; this.closeModal(id); } });
        });
        document.getElementById('promptConfirmBtn').addEventListener('click', () => this.executePromptAction());
        document.getElementById('styleApply').addEventListener('click', () => this.applyStyle());
        document.getElementById('themeConfirm').addEventListener('click', () => this.applyAITheme());
        document.getElementById('closeFs').addEventListener('click', () => this.closeFullscreen());
    }

    handleSendClick() {
        const input = document.getElementById('userInput');
        const val = input.value.trim();
        if (!val) return;
        if (this.isListening) { this.recognition.stop(); return; }
        this.sendRequest(val);
        input.value = '';
    }

    toggleSelect(id, e) {
        if (e) e.stopPropagation();
        const el = document.querySelector(`.flip-card[data-id="${id}"]`);
        if (this.selectedIds.has(id)) { this.selectedIds.delete(id); el.classList.remove('selected'); }
        else { this.selectedIds.add(id); el.classList.add('selected'); }
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const bar = document.getElementById('selectionBar');
        const cnt = document.getElementById('selectCount');
        if (this.selectedIds.size > 0) { bar.classList.add('active'); cnt.textContent = this.selectedIds.size; }
        else bar.classList.remove('active');
    }

    clearSelection() {
        this.selectedIds.forEach(id => { const el = document.querySelector(`.flip-card[data-id="${id}"]`); if (el) el.classList.remove('selected'); });
        this.selectedIds.clear(); this.updateSelectionUI();
    }

    bulkDelete() {
        if (this.selectedIds.size === 0) return;
        if (confirm(`Delete ${this.selectedIds.size} cards?`)) {
            this.pushHistory("Bulk Delete");
            this.selectedIds.forEach(id => this.deleteCard(id));
            this.clearSelection();
        }
    }

    openModal(id) { document.getElementById(id).classList.add('active'); }
    closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

    promptAction(action, id = null) {
        if (!id && this.selectedIds.size > 0) id = Array.from(this.selectedIds)[0];
        if (!id && action !== 'merge') return;
        this.promptContext = { action, id };
        const title = document.getElementById('promptTitle'), desc = document.getElementById('promptDesc'), btn = document.getElementById('promptConfirmBtn'), area = document.getElementById('promptArea');
        if (action === 'magic') { title.textContent = "Magic Action"; desc.textContent = "Edit text, change styles, or use !action:..."; btn.textContent = "Execute"; area.placeholder = "e.g., 'Edit Request to be professional'"; }
        else if (action === 'continue') { title.textContent = "Continue Card"; desc.textContent = "Instruct the AI on how to continue the response."; btn.textContent = "Continue"; area.placeholder = "Continue the thought..."; }
        else if (action === 'split') { title.textContent = "Split Card"; desc.textContent = "How should the AI split this content?"; btn.textContent = "Split"; area.placeholder = "Split into two points..."; }
        else if (action === 'merge') { title.textContent = "Merge Cards"; desc.textContent = "Combine selected cards. Instructions?"; btn.textContent = `Merge (${this.selectedIds.size})`; area.placeholder = "Merge into a summary..."; }
        this.openModal('promptModal');
    }

    executePromptAction() {
        const instructions = document.getElementById('promptArea').value.trim();
        const { action, id } = this.promptContext;
        const card = this.cards.find(c => c.id === id);
        this.closeModal('promptModal'); document.getElementById('promptArea').value = '';
        if (!card && action !== 'merge') return;
        if (action === 'merge') { this.merge(instructions); return; }
        let userPrompt = "";
        if (action === 'magic') userPrompt = `Current Request: "${card.q}". Current Response: "${card.r}". INSTRUCTIONS: ${instructions}`;
        else if (action === 'continue') userPrompt = `CONTINUE: Original: "${card.q}". Current: "${card.r}". Instruct: ${instructions}`;
        else if (action === 'split') userPrompt = `SPLIT: ${instructions}. Text: ${card.r}`;
        this.sendRequest(userPrompt, (action === 'magic' || action === 'continue') ? id : null);
        this.showToast("Processing...");
    }

    applyStyle() {
        const bg = document.getElementById('styleBg').value, text = document.getElementById('styleText').value, border = document.getElementById('styleBorder').value, primary = document.getElementById('stylePrimary').value, locked = document.getElementById('styleLocked').checked;
        this.theme = { ...this.theme, bg, text, border, primary, locked };
        this.applyTheme(); this.saveState(); this.closeModal('styleModal');
    }

    applyCardStyleToEl(el, styles) {
        if (styles.color) el.querySelector('.content').style.color = styles.color;
        if (styles.bg) el.style.background = styles.bg;
        if (styles.border) el.style.borderColor = styles.border;
    }

    applyTheme() {
        const r = document.documentElement; r.style.setProperty('--primary', this.theme.primary); r.style.setProperty('--bg', this.theme.bg); r.style.setProperty('--card-bg', this.theme.cardBg); r.style.setProperty('--text', this.theme.text); r.style.setProperty('--border', this.theme.border);
        document.getElementById('brand').textContent = this.theme.name;
    }

    applyAITheme() {
        const desc = document.getElementById('aiThemePrompt').value.trim();
        if (!desc || this.theme.locked) { if (this.theme.locked) this.showToast("Theme Locked"); this.closeModal('themeModal'); return; }
        const prompt = `Generate ONLY a style definition in this exact format:\n!theme:Name,BgHex,CardBgHex,TextHex,BorderHex,PrimaryHex!\nBased on this vibe: ${desc}\nDo not output any other text.`;
        this.closeModal('themeModal'); this.showToast("Generating Theme...");
        fetch(`${this.getProxyUrl()}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }], model: '@preset/default', userId: this.userId, sessionId: this.sessionId, enableSearch: false, maxContext: 32000 }),
            credentials: 'omit'
        }).then(res => {
            const reader = res.body.getReader(); let full = '', buf = '';
            const read = () => reader.read().then(({ done, value }) => {
                if (done) { const m = full.match(/!theme:([^!]+)!,([^,]+),([^,]+),([^,.]+),([^,]+),(.+)/);
                    if (m) { this.theme = { name: m[1], bg: m[2], cardBg: m[3], text: m[4], border: m[5], primary: m[6], locked: false }; this.applyTheme(); this.saveState(); this.showToast(`Theme: ${m[1]}`); }
                    else this.showToast("Theme parse failed");
                    return;
                }
                buf += this.decoder.decode(value, { stream: true });
                const lines = buf.split('\n\n');
                buf = lines.pop() || '';
                lines.forEach(l => { const s = l.replace('data: ', '').trim(); if (s && s !== '[DONE]') try { const j = JSON.parse(s); const c = j.choices?.[0]?.delta?.content; if (c) full += c; } catch {}});
                read();
            }); read();
        }).catch(() => this.showToast("Theme failed"));
    }

    updateToggles() {
        const a = document.getElementById('asrToggle'), t = document.getElementById('ttsToggle');
        if (a) a.classList.toggle('active', this.settings.asrEnabled);
        if (t) t.classList.toggle('active', this.settings.autoTTS);
    }

    toggleASR() { this.settings.asrEnabled = !this.settings.asrEnabled; this.updateToggles(); this.saveState(); }
    toggleTTS() { this.settings.autoTTS = !this.settings.autoTTS; this.updateToggles(); this.saveState(); }

    initASR() {
        const Sr = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Sr) { this.showToast('Speech not supported'); return; }
        this.recognition = new Sr();
        this.recognition.continuous = false; this.recognition.interimResults = false; this.recognition.lang = 'en-US';
        this.recognition.onstart = () => { this.isListening = true; const b = document.getElementById('sendBtn'); b.innerHTML = '<i class="fas fa-microphone"></i>'; b.classList.add('listening'); };
        this.recognition.onerror = () => { this.isListening = false; const b = document.getElementById('sendBtn'); b.innerHTML = '🎤'; b.classList.remove('listening'); };
        this.recognition.onend = () => { this.isListening = false; const b = document.getElementById('sendBtn'); b.innerHTML = '🎤'; b.classList.remove('listening'); };
        this.recognition.onresult = (e) => { document.getElementById('userInput').value = e.results[0][0].transcript; };
    }

    cycleView() { const v = ['list','grid','full']; const i = v.indexOf(this.settings.view); this.settings.view = v[(i+1)%v.length]; this.applyView(); this.saveState(); this.showToast(`View: ${this.settings.view}`); }
    setCardView(v) { this.settings.view = v; this.applyView(); this.saveState(); this.showToast(`View: ${v}`); }
    applyView() { document.body.className = `view-${this.settings.view}`; }
    toggleThemeMode() { this.theme.bg = this.theme.bg === '#121212' ? '#f8f9fa' : '#121212'; this.theme.cardBg = this.theme.bg === '#121212' ? '#1e1e1e' : '#ffffff'; this.applyTheme(); this.saveState(); this.showToast(this.theme.bg === '#121212' ? 'Dark Mode' : 'Light Mode'); }
    toggleThemeLock() { this.theme.locked = !this.theme.locked; this.applyTheme(); this.saveState(); this.showToast(this.theme.locked ? 'Theme Locked' : 'Theme Unlocked'); }
    showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); window.app.init(); });
