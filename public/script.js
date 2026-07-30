const DEFAULT_PROXY_URL = "https://ai.nspired.cc/chat";
const STORAGE_KEY = "ai_ndraft_data_v2";

const SYSTEM_PROMPT = `You are a helpful, casual AI assistant. You can control styling and app behavior.

1. VISUAL STYLING (Start of response):
   - Page Theme: !theme:Name,BgHex,CardBgHex,TextHex,BorderHex,PrimaryHex!
   - Card Style: !bg:#hex! !text:#hex! !border:#hex! !pad:px! !radius:px! !bold! !italic!

2. APP ACTIONS (Hidden commands, put at end):
   - !action:merge! (Merges current selection)
   - !action:clear! (Clears the entire board)
   - !action:view:grid! or !action:view:list! or !action:view:full! (Changes view)

User requests are natural language. Be efficient.`;

class App {
    constructor() {
        this.cards = [];
        this.history = []; 
        this.sessionId = "sess_" + Date.now();
        this.theme = {
            name: 'cards',
            primary: '#c41e3a',
            bg: '#121212',
            cardBg: '#1e1e1e',
            text: '#f5f5f5',
            border: '#333',
            locked: false
        };
        this.settings = {
            view: 'list',
            autoTTS: false,
            asrEnabled: false,
            proxyUrl: '',
            streamEnabled: false
        };

        this.streamingId = null;
        this.selectedIds = new Set();
        this.contextMenuTargetId = null;
        this.fullscreenId = null;
        this.fsFlipped = false;
        this.editingId = null; 
        this.editingField = null;
        this.stylingId = null; 
        this.promptContext = null; 

        this.recognizer = null;
        this.isListening = false;

        this.decoder = new TextDecoder();
        this.abortController = null;
    }

    async init() {
        this.loadState();
        this.applyTheme();
        this.applyView();
        this.bindEvents();
        this.initASR();
        this.renderAll();
        this.updateToggles();
        
        const proxyInput = document.getElementById('proxyUrlInput');
        if (proxyInput && this.settings.proxyUrl) proxyInput.value = this.settings.proxyUrl;

        document.getElementById('stylePadding').addEventListener('input', (e) => document.getElementById('valPad').textContent = e.target.value + 'px');
        document.getElementById('styleRadius').addEventListener('input', (e) => document.getElementById('valRad').textContent = e.target.value + 'px');
        document.getElementById('styleWidth').addEventListener('input', (e) => document.getElementById('valWid').textContent = e.target.value + 'px');
    }

    getProxyUrl() {
        const inputVal = document.getElementById('proxyUrlInput')?.value.trim();
        if (inputVal) {
            this.settings.proxyUrl = inputVal;
            this.saveState();
            return inputVal;
        }
        return this.settings.proxyUrl || DEFAULT_PROXY_URL;
    }

    bindEvents() {
        const sendBtn = document.getElementById('sendBtn');
        sendBtn.addEventListener('click', () => this.handleSendClick());
        
        const input = document.getElementById('userInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendClick();
            }
        });

        document.getElementById('menuFab').addEventListener('click', () => this.openModal('settingsModal'));
        document.getElementById('viewFab').addEventListener('click', () => this.cycleView());
        document.getElementById('undoFabTop').addEventListener('click', () => this.undo());

        document.getElementById('cancelSelect').addEventListener('click', () => this.clearSelection());
        document.getElementById('mergeSelected').addEventListener('click', () => this.promptAction('merge'));
        document.getElementById('deleteSelected').addEventListener('click', () => this.bulkDelete());
        document.getElementById('splitSelected').addEventListener('click', () => this.promptAction('split'));

        document.getElementById('cardMenu').addEventListener('click', (e) => {
            const btn = e.target.closest('.menu-item');
            if (btn && this.contextMenuTargetId) {
                const action = btn.dataset.action;
                if (action === 'undo') {
                    this.undo();
                } else {
                    this.handleCardAction(action, this.contextMenuTargetId);
                }
                this.closeCardMenu();
            }
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    const id = overlay.id;
                    this.closeModal(id);
                }
            });
        });

        document.getElementById('promptConfirmBtn').addEventListener('click', () => this.executePromptAction());

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#cardMenu') && !e.target.closest('.card-actions') && !e.target.closest('.flip-card')) {
                this.closeCardMenu();
            }
        });
    }

    saveState() {
        const data = {
            cards: this.cards,
            theme: this.theme,
            settings: this.settings,
            sessionId: this.sessionId
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    loadState() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const data = JSON.parse(raw);
                this.cards = data.cards || [];
                this.theme = { ...this.theme, ...data.theme };
                this.settings = { ...this.settings, ...data.settings };
                this.sessionId = data.sessionId || this.sessionId;
            } catch (e) {
                console.error("Load failed", e);
            }
        }
    }

    pushHistory(actionType) {
        if (this.history.length > 10) this.history.shift();
        this.history.push({
            cards: JSON.parse(JSON.stringify(this.cards)),
            theme: { ...this.theme },
            timestamp: Date.now(),
            action: actionType
        });
        this.showToast(`Saved: ${actionType}`);
    }

    undo() {
        if (this.history.length === 0) {
            this.showToast("Nothing to undo");
            return;
        }
        const lastState = this.history.pop();
        this.cards = lastState.cards;
        if (!this.theme.locked) this.theme = lastState.theme;
        
        this.saveState();
        this.renderAll();
        this.applyTheme();
        this.showToast("Undid: " + lastState.action);
    }

    exportData() {
        const data = {
            cards: this.cards,
            theme: this.theme,
            settings: this.settings,
            sessionId: this.sessionId
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_ncards_export_${Date.now()}.json`;
        a.click();
        this.showToast("Export downloaded");
    }

    importData(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.pushHistory("Pre-Import Backup");
                this.cards = data.cards || [];
                this.theme = data.theme || this.theme;
                this.settings = data.settings || this.settings;
                this.sessionId = data.sessionId || this.sessionId;
                
                this.renderAll();
                this.applyTheme();
                this.applyView();
                this.saveState();
                this.showToast("Import Successful");
                this.closeModal('settingsModal');
            } catch (err) {
                this.showToast("Import failed");
            }
            input.value = '';
        };
        reader.readAsText(file);
    }

    renderAll() {
        this.renderCards();
        this.renderSelectionToolbar();
        this.updateToggles();
        this.updateStyleControls();
    }

    renderCards() {
        const container = document.getElementById('cardContainer');
        container.innerHTML = '';
        this.cards.forEach((card, index) => {
            const el = this.createCardElement(card, index);
            container.appendChild(el);
        });
    }

    createCardElement(card, index) {
        const div = document.createElement('div');
        div.className = 'card' + (this.fullscreenId === index ? ' fullscreen' : '') + (this.selectedIds.has(index) ? ' selected' : '');
        div.dataset.index = index;
        
        const q = card.q || '';
        const a = card.a || '';
        
        div.innerHTML = `
            <div class="card-inner">
                <div class="card-face card-front">
                    <div class="card-header">
                        <span class="card-index">#${index + 1}</span>
                        <div class="card-actions">
                            <button class="btn-icon" data-action="favorite">★</button>
                            <button class="btn-icon" data-action="duplicate">↕</button>
                            <button class="btn-icon" data-action="delete">×</button>
                        </div>
                    </div>
                    <div class="card-content">
                        <div class="card-field-label">Question</div>
                        <div class="card-field" contenteditable="true" data-field="q">${this.escapeHTML(q)}</div>
                    </div>
                    <div class="card-content">
                        <div class="card-field-label">Answer</div>
                        <div class="card-field ${a ? '' : 'empty'}" contenteditable="true" data-field="a">${a ? this.escapeHTML(a) : 'Click to add answer...'}</div>
                    </div>
                </div>
                <div class="card-face card-back">
                    <div class="card-header">
                        <span class="card-index">#${index + 1}</span>
                        <div class="card-actions">
                            <button class="btn-icon" data-action="favorite">★</button>
                            <button class="btn-icon" data-action="duplicate">↕</button>
                            <button class="btn-icon" data-action="delete">×</button>
                        </div>
                    </div>
                    <div class="card-content">
                        <div class="card-field-label">Answer</div>
                        <div class="card-field" contenteditable="true" data-field="a">${this.escapeHTML(a)}</div>
                    </div>
                    <div class="card-content">
                        <div class="card-field-label">Question</div>
                        <div class="card-field ${q ? '' : 'empty'}" contenteditable="true" data-field="q">${q ? this.escapeHTML(q) : 'Click to add question...'}</div>
                    </div>
                </div>
            </div>
        `;

        // Bind inner field events
        const fields = div.querySelectorAll('.card-field');
        fields.forEach(f => {
            f.addEventListener('input', (e) => {
                const newVal = e.target.textContent;
                const otherField = f.dataset.field === 'q' 
                    ? div.querySelector('.card-back .card-field[data-field="q"]')
                    : div.querySelector('.card-front .card-field[data-field="a"]');
                // Update other face preview if not empty
                if (otherField) otherField.textContent = newVal || (f.dataset.field === 'q' ? 'Click to add question...' : 'Click to add answer...');
                card[f.dataset.field] = newVal;
            });
            f.addEventListener('focus', () => {
                this.editingId = index;
                this.editingField = f.dataset.field;
                this.stylingId = index;
            });
        });

        // Card actions (inner)
        const actionButtons = div.querySelectorAll('.btn-icon');
        actionButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'delete') {
                    this.deleteCard(index);
                } else if (action === 'duplicate') {
                    this.duplicateCard(index);
                }
            });
        });

        // Flip card on click
        div.addEventListener('click', (e) => {
            // If clicking on controls, don't flip
            if (e.target.closest('.card-actions') || e.target.closest('.btn-icon') || e.target.isContentEditable) return;
            this.flipCard(index);
        });

        return div;
    }

    renderSelectionToolbar() {
        const toolbar = document.getElementById('selectionToolbar');
        const count = this.selectedIds.size;
        if (count === 0) {
            toolbar.classList.remove('visible');
            return;
        }
        toolbar.classList.add('visible');
        document.getElementById('selCount').textContent = count + ' selected';
    }

    updateToggles() {
        document.getElementById('toggleStream').checked = this.settings.streamEnabled;
    }

    updateStyleControls() {
        document.getElementById('stylePadding').value = this.styleVal('pad', 8);
        document.getElementById('valPad').textContent = this.styleVal('pad', 8) + 'px';
        document.getElementById('styleRadius').value = this.styleVal('radius', 12);
        document.getElementById('valRad').textContent = this.styleVal('radius', 12) + 'px';
        document.getElementById('styleWidth').value = this.styleVal('width', 2);
        document.getElementById('valWid').textContent = this.styleVal('width', 2) + 'px';
    }

    styleVal(key, def) {
        return this.theme[key] !== undefined ? this.theme[key] : def;
    }

    handleSendClick() {
        const input = document.getElementById('userInput');
        const prompt = input.value.trim();
        if (!prompt) return;
        input.value = '';
        this.addUserCard(prompt);
        this.processWithAgent(prompt);
    }

    addUserCard(text) {
        this.cards.push({ q: text, a: '' });
        this.renderAll();
        this.saveState();
    }

    showToast(message, type = 'info') {
        let toast = document.getElementById('liveToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'liveToast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = 'toast show ' + type;
        setTimeout(() => { toast.className = 'toast'; }, 3000);
    }

    // --- Core Agent Processing ---
    async processWithAgent(prompt) {
        const cardsState = JSON.stringify(this.cards.map(c => ({ q: c.q, r: c.a })));
        const body = {
            prompt: prompt,
            cards: this.cards
        };

        const url = this.getProxyUrl();
        const headers = { 'Content-Type': 'application/json' };

        // Show thinking state
        this.showToast('Thinking...', 'info');

        try {
            if (this.settings.streamEnabled) {
                await this.streamFetchCompletion(url, headers, body, (token) => {
                    const latest = this.cards[this.cards.length - 1];
                    if (latest) {
                        latest.a = (latest.a || '') + token;
                        this.renderAll();
                    }
                });
            } else {
                const response = await this.fetchWithTimeout(url, { method: 'POST', headers, body });
                const data = await response.json();
                const answer = data.response || 'No response';
                this.cards.push({ q: prompt, a: answer });
                this.renderAll();
                this.saveState();
                this.showToast('Response complete');
            }
        } catch (error) {
            console.error('Agent error:', error);
            this.showToast('Error: ' + error.message, 'error');
        }
    }

    async streamFetchCompletion(url, headers, body, onToken) {
        const fullBody = JSON.stringify(body);
        const controller = new AbortController();
        this.abortController = controller;

        const res = await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: fullBody,
            signal: controller.signal
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error('HTTP ' + res.status + ': ' + text);
        }

        const ct = res.headers.get('Content-Type');
        if (ct && ct.includes('text/event-stream')) {
            const reader = res.body.getReader();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += this.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    if (trimmed === '[DONE]') continue;
                    if (trimmed.startsWith('data: ')) {
                        const raw = trimmed.slice(6).trim();
                        try {
                            const obj = JSON.parse(raw);
                            if (obj.response) onToken(obj.response);
                        } catch (e) {
                            // ignore malformed lines
                        }
                    }
                }
            }
            if (buffer) {
                try {
                    const obj = JSON.parse(buffer.trim());
                    if (obj.response) onToken(obj.response);
                } catch (e) {}
            }
        } else {
            // Fallback: assume JSON
            const text = await res.text();
            try {
                const obj = JSON.parse(text);
                onToken(obj.response || text);
            } catch {
                onToken(text);
            }
        }
    }

    async fetchWithTimeout(url, options, timeout = 120000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            return res;
        } catch (err) {
            clearTimeout(id);
            throw err;
        }
    }

    // --- Card Operations ---
    deleteCard(index) {
        this.cards.splice(index, 1);
        this.renderAll();
        this.saveState();
    }

    duplicateCard(index) {
        const original = this.cards[index];
        this.cards.push({ q: original.q, a: original.a });
        this.renderAll();
        this.saveState();
    }

    flipCard(index) {
        this.cards[index].flipped = !this.cards[index].flipped;
        this.renderAll();
        this.saveState();
    }

    bulkDelete() {
        if (this.selectedIds.size === 0) return;
        const ordered = [...this.selectedIds].sort((a, b) => b - a);
        ordered.forEach(i => this.cards.splice(i, 1));
        this.clearSelection();
        this.renderAll();
        this.saveState();
    }

    // --- Selection ---
    toggleSelection(index) {
        if (this.selectedIds.has(index)) {
            this.selectedIds.delete(index);
        } else {
            this.selectedIds.add(index);
        }
        this.renderSelectionToolbar();
        this.renderAll();
    }

    clearSelection() {
        this.selectedIds.clear();
        this.renderSelectionToolbar();
        this.renderAll();
    }

    // --- Prompt Action ---
    executePromptAction() {
        const action = document.getElementById('promptAction').value;
        const promptInput = document.getElementById('userInput');
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        promptInput.value = '';
        this.addUserCard(prompt);
        if (action === 'merge' && this.cards.length > 1) {
            const last = this.cards[this.cards.length - 1];
            const allQ = this.cards.map(c => c.q).join('\n');
            last.q = allQ;
        }
        this.processWithAgent(prompt);
    }

    // --- Undo/History ---
    undo() {
        if (this.history.length === 0) {
            this.showToast("Nothing to undo");
            return;
        }
        const lastState = this.history.pop();
        this.cards = lastState.cards;
        if (!this.theme.locked) this.theme = lastState.theme;
        this.saveState();
        this.renderAll();
        this.applyTheme();
        this.showToast("Undid: " + lastState.action);
    }

    // --- Export/Import ---
    exportData() {
        const data = {
            cards: this.cards,
            theme: this.theme,
            settings: this.settings,
            sessionId: this.sessionId
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_ncards_export_${Date.now()}.json`;
        a.click();
        this.showToast("Export downloaded");
    }

    importData(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.pushHistory("Pre-Import Backup");
                this.cards = data.cards || [];
                this.theme = data.theme || this.theme;
                this.settings = data.settings || this.settings;
                this.sessionId = data.sessionId || this.sessionId;
                this.renderAll();
                this.applyTheme();
                this.applyView();
                this.saveState();
                this.showToast("Import Successful");
                this.closeModal('settingsModal');
            } catch (err) {
                this.showToast("Import failed");
            }
            input.value = '';
        };
        reader.readAsText(file);
    }

    // --- Filter & Search ---
    handleFilter() {
        const term = document.getElementById('filterInput').value.toLowerCase();
        const cards = document.querySelectorAll('#cardContainer .card');
        cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            card.style.display = text.includes(term) ? '' : 'none';
        });
    }

    // --- Keyboard ---
    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.clearSelection();
            this.closeAllModals();
        }
        if (e.key === 'Delete' && this.selectedIds.size > 0) {
            const ordered = [...this.selectedIds].sort((a, b) => b - a);
            ordered.forEach(i => this.cards.splice(i, 1));
            this.clearSelection();
            this.renderAll();
            this.saveState();
        }
    }
}

const app = new App();
app.init();

// Global bindings for inline onclick
window.kardsApp = app;
window.showToast = (msg, type) => app.showToast(msg, type);