              const DEFAULT_PROXY_URL = "https://ai-proxy.ai-n.workers.dev";
const STORAGE_KEY = "ai_ndraft_data_v2";

// UPDATED PROMPT: "Document Drafter" persona
const SYSTEM_PROMPT = `You are a helpful AI Document Drafter. You help build documents card by card.

1. VISUAL STYLING (Start of response):
   - Page Theme: !theme:Name,BgHex,CardBgHex,TextHex,BorderHex,PrimaryHex!
   - Card Style: !bg:#hex! !text:#hex! !border:#hex! !pad:px! !radius:px! !bold! !italic!

2. APP ACTIONS (Hidden commands, put at end):
   - !action:merge! (Merges current selection)
   - !action:clear! (Clears the entire board)
   - !action:view:grid! or !action:view:list! or !action:view:full! (Changes view)

3. CARD EDITING:
   - To EDIT the REQUEST: Say "New Request: [text]".
   - To EDIT the RESPONSE: Say "New Response: [text]" or simply provide the improved answer.
   - To STYLE: Use !text:#hex! !bold! etc.

User requests are natural language. You are building a document.`;

class App {
    constructor() {
        this.cards = [];
        this.history = []; 
        this.sessionId = "sess_" + Date.now();
        this.userId = "user_" + Math.random().toString(36).substr(2, 9);
        this.theme = {
            name: 'ai-Ncards',
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
            proxyUrl: ''
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
            sessionId: this.sessionId,
            userId: this.userId
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
                this.userId = data.userId || this.userId;
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
            sessionId: this.sessionId,
            userId: this.userId
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
                this.userId = data.userId || this.userId;

                this.renderAll();
                this.applyTheme();
                this.applyView();
                this.saveState();
                this.showToast("Import Successful");
                this.closeModal('settingsModal');
            } catch (err) {
                alert("Invalid JSON file");
            }
        };
        reader.readAsText(file);
        input.value = ''; 
    }

    clearAll() {
        if (confirm("Are you sure you want to delete ALL cards? This cannot be undone.")) {
            this.pushHistory("Clear All");
            this.cards = [];
            this.saveState();
            this.renderAll();
            this.closeModal('settingsModal');
            this.showToast("Grid Cleared");
        }
    }

    resetApp() {
        if (confirm("WARNING: This will delete ALL data, settings, and history. The app will restart to the welcome screen. Are you sure?")) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
        }
    }

    addCard(q, r, styles = {}) {
        const id = crypto.randomUUID();
        const card = { id, q, r, styles };
        this.cards.push(card);
        this.pushHistory("Add Card");
        this.renderCard(card, true);
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
            if (q !== null) el.querySelector('.card-face:first-child .content').innerHTML = this.md(q);
            if (r !== null) {
                const rEl = el.querySelector('.response-content');
                if (rEl) rEl.innerHTML = this.md(r);
            }
        }
        this.saveState();
    }

    renderAll() {
        const grid = document.getElementById('grid');
        const empty = document.getElementById('emptyState');
        grid.innerHTML = '';

        if (this.cards.length === 0) {
            grid.appendChild(empty);
            empty.style.display = 'flex';
        } else {
            empty.style.display = 'none';
            this.cards.forEach(c => this.renderCard(c, false));
        }
    }

    renderCard(card, isNew) {
        const grid = document.getElementById('grid');
        const empty = document.getElementById('emptyState');
        if (empty && empty.parentNode) empty.remove();

        const div = document.createElement('div');
        div.className = `flip-card ${isNew ? 'new' : ''}`;
        div.dataset.id = card.id;
        div.tabIndex = 0;

        if (card.styles && card.styles.locked) {
            div.classList.add('locked');
        }

        let rHtml;
        if (card.r === '...') {
            if (this.streamingId === card.id) {
                rHtml = '<div class="streaming"><span class="thinking-indicator">Thinking...</span><button class="stop-stream-btn" onclick="app.stopStream()">Stop</button></div>';
            } else {
                rHtml = '<div class="streaming"><span class="thinking-indicator">Thinking...</span></div>';
            }
        } else {
            rHtml = this.md(card.r);
        }

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
            if (this.selectedIds.size > 0) {
                e.stopPropagation();
                this.toggleSelect(id, e);
                return;
            }
            div.classList.toggle('flipped');
        });

        let lastTap = 0;
        div.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            if (tapLength < 300 && tapLength > 0) {
                if (e.target.closest('button') || e.target.closest('.card-actions')) return;
                this.openFullscreen(id);
                e.preventDefault();
            }
            lastTap = currentTime;
        });
        div.addEventListener('dblclick', (e) => {
            if (!e.target.closest('button')) this.openFullscreen(id);
        });

        let pressTimer;
        div.addEventListener('touchstart', (e) => {
            if (this.selectedIds.size > 0) return;
            pressTimer = setTimeout(() => {
                this.openCardMenu(id, e);
                if (navigator.vibrate) navigator.vibrate(50);
            }, 400);
        });
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('touchmove', () => clearTimeout(pressTimer));

             div.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') div.classList.toggle('flipped');
            if (e.key === ' ' && e.shiftKey) {
                e.preventDefault();
                this.openCardMenu(id);
            }
        });
    }

    handleSendClick() {
        const input = document.getElementById('userInput');
        const val = input.value.trim();
        if (!val) return;

        if (this.isListening) {
            this.recognition.stop();
        }

        this.sendRequest(val);
        input.value = '';
    }

    scrollToStreamingContent(element) {
        if (!element) return;
        const isNearBottom = (element.scrollHeight - element.scrollTop - element.clientHeight) < 150;
        if (isNearBottom) {
            element.scrollTop = element.scrollHeight;
        }
    }

    async sendRequest(prompt, contextCardId = null) {
        this.streamingId = contextCardId ? contextCardId : this.addCard(prompt, '...', {});

        const cardEl = document.querySelector(`.flip-card[data-id="${this.streamingId}"]`);
        if(cardEl && !contextCardId) setTimeout(() => cardEl.classList.add('flipped'), 100);

        // Prepare messages for your backend
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT }
        ];

        if (contextCardId) {
            const oldCard = this.cards.find(c => c.id === contextCardId);
            if (oldCard) {
                messages.push({ role: 'user', content: oldCard.q });
                messages.push({ role: 'assistant', content: oldCard.r });
            }
        }

        messages.push({ role: 'user', content: prompt });

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            const url = this.getProxyUrl();
            const res = await fetch(`${url}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: messages,
                    model: '@preset/default',
                    userId: this.userId,
                    sessionId: this.sessionId,
                    enableSearch: false,
                    maxContext: 32000
                }),
                signal
            });

            if (!res.ok) throw new Error(`Proxy Error: ${res.status}`);

            const reader = res.body.getReader();
            let buffer = '';
            let accumulated = '';
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += this.decoder.decode(value, { stream: true });

                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    try {
                        const json = JSON.parse(jsonStr);
                        const chunk = json.choices?.[0]?.delta?.content;
                        if (chunk) {
                            accumulated += chunk;
                            if (isFirstChunk) {
                                this.updateStreamingContent(accumulated, true);
                                isFirstChunk = false;
                            } else {
                                this.updateStreamingContent(accumulated, false);
                            }
                        }
                    } catch {}
                }
            }

            this.finalizeResponse(accumulated);

        } catch (err) {
            if (err.name === 'AbortError') {
                const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`);
                if (el) el.innerHTML += '<div style="color:#ff6b6b; margin-top:10px;">[Stopped]</div>';
            } else {
                const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`);
                if (el) el.innerHTML = `<span style="color: #ff6b6b; font-weight: bold;">Error: ${err.message}</span>`;
            }
            this.streamingId = null;
        } finally {
            this.abortController = null;
        }
    }

    stopStream() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.showToast("Streaming stopped");
        }
    }

    updateStreamingContent(text, replace = false) {
        if (!this.streamingId) return;
        const visible = text.replace(/![^!]+!/g, '');

  