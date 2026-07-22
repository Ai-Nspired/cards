              const DEFAULT_PROXY_URL = "https://orproxy.ai-n.workers.dev";
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

        const el = document.querySelector(`.flip-card[data-id="${this.streamingId}"] .response-content`);
        if (el) {
            if (replace) {
                el.innerHTML = this.md(visible);
            } else {
                el.innerHTML = this.md(visible) + '<div class="streaming"><span class="cursor"></span></div>';
            }
            this.scrollToStreamingContent(el);
        }

        if (this.fullscreenId === this.streamingId) {
            const fsPane = document.getElementById('fsResponsePane');
            if (fsPane) {
                if (replace) {
                    document.getElementById('fsResponse').innerHTML = this.md(visible);
                } else {
                    document.getElementById('fsResponse').innerHTML = this.md(visible) + '<div class="streaming"><span class="cursor"></span></div>';
                }
                this.scrollToStreamingContent(fsPane);
            }
        }
    }

    finalizeResponse(fullText) {
        const id = this.streamingId;
        if (!id) return;

        const { cleanText, styles, themeUpdate, actions } = this.parseCommands(fullText);
        const card = this.cards.find(c => c.id === id);

        if (card) {
            // Specific Logic for "New Request" or "New Response" extraction from cleanText
            // If the AI followed instructions, it might have output text like "New Request: ... \n New Response: ..."
            // Or it might have just output the new Response.
            // We will rely on the fact that if the prompt asked to edit the request, the AI should ideally return the structure.
            // However, to be safe, we update the Card properties directly if we detect specific patterns in cleanText.
            // But since the AI is smart, we usually just update the Card content based on what came back.

            // Check if cleanText contains "New Request:" or "New Response:"
            let newQ = null;
            let newR = null;

            const reqMatch = cleanText.match(/New Request:\s*(.+)/i);
            const respMatch = cleanText.match(/New Response:\s*(.+)/i);

            if (reqMatch) {
                newQ = reqMatch[1].trim();
            }
            if (respMatch) {
                newR = respMatch[1].trim();
            }

            // If we found explicit instructions, update accordingly
            if (newQ) {
                card.q = newQ;
                // If only request was edited, we might want to keep the old response or clear it? 
                // Let's keep the old response if only Request changed.
                if (!newR) newR = card.r; 
            }

            if (newR) {
                card.r = newR;
            }

            // If no explicit markers, treat the whole output as the new Response (unless card was empty)
            if (!newQ && !newR) {
                 if (card.styles && card.styles.locked) {
                    this.showToast("Card Locked - Style changes ignored");
                } else {
                    if (Object.keys(styles).length > 0) {
                        card.styles = { ...card.styles, ...styles };
                    }
                }
                // Only update response if we aren't explicitly editing request
                if (cleanText) card.r = cleanText;
            }

            // If a new Q was set, update it now
            if (newQ) {
                card.q = newQ;
            }
        }

        const finalDisplayText = card ? card.r : cleanText; 
        const cleanHtml = this.md(finalDisplayText);

        const el = document.querySelector(`.flip-card[data-id="${id}"] .response-content`);
        if (el) el.innerHTML = cleanHtml;

        if (this.fullscreenId === id) {
            document.getElementById('fsResponse').innerHTML = cleanHtml;
        }

        // Apply theme updates
        if (themeUpdate && !this.theme.locked) {
            this.theme = { ...this.theme, ...themeUpdate };
            this.applyTheme();
        }

        // Apply card styles
        if (card && !(card.styles && card.styles.locked)) {
            if (Object.keys(styles).length > 0) {
                card.styles = { ...card.styles, ...styles };
                const cardEl = document.querySelector(`.flip-card[data-id="${id}"]`);
                if (cardEl) this.applyCardStyleToEl(cardEl, card.styles);
            }
        }

        // Handle actions
        actions.forEach(action => {
            if (action === 'merge') this.promptAction('merge');
            if (action === 'clear') this.clearAll();
            if (action.startsWith('view:')) {
                const view = action.split(':')[1];
                this.settings.view = view;
                this.applyView();
            }
        });

        this.saveState();
        this.streamingId = null;

        // Auto-read if enabled
        if (this.settings.autoTTS && card && card.r) {
            setTimeout(() => this.readCard(id), 500);
        }
    }

    parseCommands(text) {
        const cmdRegex = /!(theme|bg|text|border|pad|radius|font|bold|italic|css|action):?([^!]+)!/gi;
        let styles = {};
        let actions = [];
        let themeUpdate = null;
        let match;
        let safeText = text;

        while ((match = cmdRegex.exec(text)) !== null) {
            const type = match[1].toLowerCase();
            const val = match[2].trim();

            if (type === 'theme') {
                const [name, bg, cardBg, textC, border, primary] = val.split(',').map(s => s.trim());
                themeUpdate = { name, bg, cardBg, text: textC, border, primary };
            } else if (type === 'bg') styles.backgroundColor = val;
            else if (type === 'text') styles.color = val;
            else if (type === 'border') styles.borderColor = val;
            else if (type === 'pad') styles.padding = val.endsWith('px') ? val : val + 'px';
            else if (type === 'radius') styles.borderRadius = val.endsWith('px') ? val : val + 'px';
            else if (type === 'font') styles.fontSize = val.endsWith('px') ? val : val + 'px';
            else if (type === 'bold') styles.fontWeight = 'bold';
            else if (type === 'italic') styles.fontStyle = 'italic';
            else if (type === 'css') styles.customCSS = val;
            else if (type === 'action') actions.push(val);

            safeText = safeText.replace(match[0], '');
        }

        return { cleanText: safeText.trim(), styles, themeUpdate, actions };
    }

    applyCardStyleToEl(el, styles) {
        const face = el.querySelectorAll('.card-face');
        face.forEach(f => {
            if (styles.color) f.style.color = styles.color;
            if (styles.backgroundColor) f.style.backgroundColor = styles.backgroundColor;
            if (styles.fontSize) f.style.fontSize = styles.fontSize;
            if (styles.fontWeight) f.style.fontWeight = styles.fontWeight;
            if (styles.fontStyle) f.style.fontStyle = styles.fontStyle;
            if (styles.padding) f.style.padding = styles.padding;
        });

        if (styles.borderColor) el.style.borderColor = styles.borderColor;
        if (styles.borderRadius) el.style.borderRadius = styles.borderRadius;

        if (styles.customCSS) {
            const id = `style-${el.dataset.id}`;
            let styleTag = document.getElementById(id);
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = id;
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = `[data-id="${el.dataset.id}"] ${styles.customCSS}`;
        }
    }

    openCardMenu(id, e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();

        this.contextMenuTargetId = id;
        const menu = document.getElementById('cardMenu');

        let x, y;
        if (e && e.clientX) {
            x = e.clientX;
            y = e.clientY;
        } else if (e && e.touches && e.touches[0]) {
            x = e.touches[0].clientX;
            y = e.touches[0].clientY;
        } else {
            const el = document.querySelector(`.flip-card[data-id="${id}"]`);
            if (el) {
                const rect = el.getBoundingClientRect();
                x = rect.left + rect.width / 2;
                y = rect.top + rect.height / 2;
            } else {
                x = window.innerWidth / 2;
                y = window.innerHeight / 2;
            }
        }

        if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
        if (y + 350 > window.innerHeight) y = window.innerHeight - 360;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.add('active');
    }

    closeCardMenu() {
        document.getElementById('cardMenu').classList.remove('active');
        this.contextMenuTargetId = null;
    }

    handleCardAction(action, id) {
        const card = this.cards.find(c => c.id === id);
        if (!card) return;

        switch (action) {
            case 'continue': this.promptAction('continue', id); break;
            case 'split': this.promptAction('split', id); break;
            case 'merge':
                if (!this.selectedIds.has(id)) {
                    this.selectedIds.add(id);
                    const el = document.querySelector(`.flip-card[data-id="${id}"]`);
                    if (el) el.classList.add('selected');
                }
                if (this.selectedIds.size < 2) {
                    this.showToast("Need at least 2 cards to merge");
                    this.updateSelectionUI();
                    return;
                }
                this.updateSelectionUI();
                this.promptAction('merge');
                break;
            case 'ai-edit': 
                // This is the "Magic Action" entry point
                this.promptAction('magic', id); 
                break;
            case 'copy': 
                navigator.clipboard.writeText(card.r || card.q || '');
                this.showToast('Copied to clipboard');
                break;
            case 'fullscreen': this.openFullscreen(id); break;
            case 'delete': 
                if(confirm("Delete this card?")) {
                    this.deleteCard(id);
                    this.showToast('Card deleted');
                }
                break;
            case 'style':
                this.stylingId = id;


                this.loadStyleValues(card.styles || {});
                this.openModal('styleModal');
                break;
        }
    }

    openModal(id) {
        document.getElementById(id).classList.add('active');
    }

    closeModal(id) {
        document.getElementById(id).classList.remove('active');
        if (id === 'promptModal') this.promptContext = null;
        if (id === 'styleModal') this.stylingId = null;
        if (id === 'textEditorModal') { this.editingId = null; this.editingField = null; }
    }

    openEditor(text, title) {
        document.getElementById('textEditorArea').value = text;
        document.getElementById('editorTitle').textContent = title;
        this.openModal('textEditorModal');
    }

    saveManualEdit() {
        const val = document.getElementById('textEditorArea').value.trim();
        if (this.editingId && this.editingField) {
            this.pushHistory("Manual Edit");
            this.updateCardContent(this.editingId, this.editingField === 'q' ? val : null, this.editingField === 'r' ? val : null);
            this.closeModal('textEditorModal');
        }
    }

    loadStyleValues(styles) {
        const lockCheck = document.getElementById('styleLocked');
        lockCheck.checked = !!styles.locked;

        document.getElementById('styleColor').value = styles.color || '#f5f5f5';
        document.getElementById('styleBg').value = styles.backgroundColor || '#1e1e1e';
        document.getElementById('styleBorder').value = styles.borderColor || '#333333';
        document.getElementById('stylePadding').value = parseInt(styles.padding || '16');
        document.getElementById('styleRadius').value = parseInt(styles.borderRadius || '16');
        document.getElementById('styleWidth').value = parseInt(styles.borderWidth || '1');
        document.getElementById('styleCustom').value = styles.customCSS || '';

        document.getElementById('valPad').textContent = (parseInt(styles.padding || '16')) + 'px';
        document.getElementById('valRad').textContent = (parseInt(styles.borderRadius || '16')) + 'px';
        document.getElementById('valWid').textContent = (parseInt(styles.borderWidth || '1')) + 'px';

        document.querySelectorAll('.toggle-btn[data-style-prop]').forEach(btn => {
            const prop = btn.dataset.styleProp;
            const val = btn.dataset.styleVal;
            const current = styles[prop];
            if ((prop === 'textDecoration' && current === 'underline') || current === val) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    saveStyles() {
        if (!this.stylingId) return;

        if (this.theme.locked) {
            this.showToast("Global Theme Locked - Cannot change card styles");
            this.closeModal('styleModal');
            return;
        }

        const isLocked = document.getElementById('styleLocked').checked;

        const styles = {
            locked: isLocked,
            color: document.getElementById('styleColor').value,
            backgroundColor: document.getElementById('styleBg').value,
            borderColor: document.getElementById('styleBorder').value,
            padding: document.getElementById('stylePadding').value + 'px',
            borderRadius: document.getElementById('styleRadius').value + 'px',
            borderWidth: document.getElementById('styleWidth').value + 'px',
            customCSS: document.getElementById('styleCustom').value
        };

        document.querySelectorAll('.toggle-btn.active').forEach(btn => {
            const prop = btn.dataset.styleProp;
            const val = btn.dataset.styleVal;
            if (prop === 'textDecoration') {
                styles.textDecoration = val;
            } else {
                styles[prop] = val;
            }
        });

        const card = this.cards.find(c => c.id === this.stylingId);
        if (card) {
            card.styles = { ...(card.styles || {}), ...styles };
            this.saveState();

            const el = document.querySelector(`.flip-card[data-id="${this.stylingId}"]`);
            if (el) {
                this.applyCardStyleToEl(el, styles);
                if(isLocked) el.classList.add('locked');
                else el.classList.remove('locked');
            }

            this.pushHistory("Style Change");
            this.closeModal('styleModal');
        }
    }

    promptAction(action, id = null) {
        if (!id && this.selectedIds.size > 0) {
            id = Array.from(this.selectedIds)[0];
        }
        if (!id && action !== 'merge') return; 

        this.promptContext = { action, id };
        const title = document.getElementById('promptTitle');
        const desc = document.getElementById('promptDesc');
        const btn = document.getElementById('promptConfirmBtn');
        const area = document.getElementById('promptArea');

        if (action === 'magic') {
            title.textContent = "Magic Action";
            desc.textContent = "Edit text, change styles, or use !action:...";
            btn.textContent = "Execute";
            area.placeholder = "e.g., 'Edit Request to be professional', 'Make response bold', 'Merge'";
        } else if (action === 'continue') {
            title.textContent = "Continue Card";
            desc.textContent = "Instruct the AI on how to continue the response.";
            btn.textContent = "Continue";
            area.placeholder = "Continue the thought...";
        } else if (action === 'split') {
            title.textContent = "Split Card";
            desc.textContent = "How should the AI split this content?";
            btn.textContent = "Split";
            area.placeholder = "Split into two points...";
        } else if (action === 'merge') {
            title.textContent = "Merge Cards";
            desc.textContent = "Combine selected cards. Instructions?";
            btn.textContent = `Merge (${this.selectedIds.size})`;
            area.placeholder = "Merge into a summary...";
        }

        this.openModal('promptModal');
    }

    executePromptAction() {
        const instructions = document.getElementById('promptArea').value.trim();
        const { action, id } = this.promptContext;
        const card = this.cards.find(c => c.id === id);

        this.closeModal('promptModal');
        document.getElementById('promptArea').value = '';

        if (action === 'merge') {
            this.merge(instructions);
            return;
        }

        if (!card) return;
        let userPrompt = "";

        // LOGIC: "Magic Action" puts the card context + instructions into the prompt.
        // The AI (via SYSTEM_PROMPT) knows to look for "New Request:" or specific commands.
        if (action === 'magic') {
            userPrompt = `Current Request: "${card.q}". Current Response: "${card.r}". INSTRUCTIONS: ${instructions}`;
            this.sendRequest(userPrompt, id);
        }
        else if (action === 'continue') {
            userPrompt = `CONTINUE: Original: "${card.q}". Current: "${card.r}". Instruct: ${instructions}`;
            this.sendRequest(userPrompt, id);
        } 
        else if (action === 'split') {
            userPrompt = `SPLIT: ${instructions}. Text: ${card.r}`;
            this.sendRequest(userPrompt, null);
        }

        this.showToast("Processing...");
    }

    merge(instructions = "") {
        if (this.selectedIds.size < 2) {
            this.showToast("Select 2+ cards to merge");
            return;
        }

        const sel = Array.from(this.selectedIds).map(id => this.cards.find(c => c.id === id));
        const content = sel.map(c => `---\n${c.q}\n${c.r}`).join('\n');
        const prompt = instructions 
            ? `Merge these into one based on: ${instructions}\n\n${content}`
            : `Combine these into one coherent response:\n\n${content}`;

        const id = this.addCard(`Merged ${sel.length} cards`, '...', {});
        this.streamingId = id;
        this.clearSelection(); 
        this.requestMergeUpdate(id, prompt);
    }

    async requestMergeUpdate(id, prompt) {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            const url = this.getProxyUrl();
            const res = await fetch(`${url}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: prompt }
                    ],
                    model: '@preset/default',
                    userId: this.userId,
                    sessionId: this.sessionId,
                    enableSearch: false,
                    maxContext: 32000
                }),
                signal
            });
            if (!res.ok) throw new Error("Proxy Error");

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
                const el = document.querySelector(`.flip-card[data-id="${id}"] .response-content`);
                if (el) el.innerHTML += '<div style="color:#ff6b6b;">[Merge Stopped]</div>';
                return;
            }
            const el = document.querySelector(`.flip-card[data-id="${id}"] .response-content`);
            if (el) el.innerHTML = `<span style="color: #ff6b6b;">Merge Failed: ${err.message}</span>`;
        } finally {
            this.abortController = null;
        }
    }

    applyAITheme() {
        const desc = document.getElementById('aiThemePrompt').value.trim();
        if (!desc) return;

        if (this.theme.locked) {
            this.showToast("Global Theme Locked");
            this.closeModal('aiThemeModal');
            return;
        }

        const prompt = `Generate ONLY a style definition in this exact format:
!theme:Name,BgHex,CardBgHex,TextHex,BorderHex,PrimaryHex!
Based on this vibe: ${desc}
Do not output any other text.`;

        this.closeModal('aiThemeModal');
        this.showToast("Generating Theme...");

        const url = this.getProxyUrl();
        fetch(`${url}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: prompt }
                ],
                model: '@preset/default',
                userId: this.userId,
                sessionId: this.sessionId,
                enableSearch: false,
                maxContext: 32000
            })
        })
        .then(res => {
            const reader = res.body.getReader();
            let fullText = "";
            const processChunk = () => {
                return reader.read().then(({done, value}) => {
                    if (done) {
                        const { themeUpdate } = this.parseCommands(fullText);
                        if (themeUpdate) {
                            this.theme = { ...this.theme, ...themeUpdate };
                            this.applyTheme();
                            this.saveState();
                            this.showToast(`Theme: ${themeUpdate.name}`);
                        } else {
                            this.showToast("Theme generation failed (parse error)");
                        }
                        return;
                    }
                    const text = this.decoder.decode(value, { stream: true });
                    fullText += text;
                    return processChunk();
                });
            };
            return processChunk();
        })
        .catch(e => {
            this.showToast("Theme generation failed");
        });
    }

    toggleSelect(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const el = document.querySelector(`.flip-card[data-id="${id}"]`);
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
            el.classList.remove('selected');
        } else {
            this.selectedIds.add(id);
            el.classList.add('selected');
        }
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const bar = document.getElementById('selectionBar');
        const count = document.getElementById('selectCount');
        if (this.selectedIds.size > 0) {
            bar.classList.add('active');
            count.textContent = this.selectedIds.size;
        } else {
            bar.classList.remove('active');
        }
    }

    clearSelection() {
        this.selectedIds.forEach(id => {
            const el = document.querySelector(`.flip-card[data-id="${id}"]`);
            if (el) el.classList.remove('selected');
        });
        this.selectedIds.clear();
        this.updateSelectionUI();
    }

    bulkDelete() {
        if (this.selectedIds.size === 0) return;
        if (confirm(`Delete ${this.selectedIds.size} selected cards?`)) {
            this.pushHistory("Bulk Delete");
            this.selectedIds.forEach(id => this.deleteCard(id));
            this.clearSelection();
            this.showToast(`Deleted ${this.selectedIds.size} cards`);
        }
    }

    openFullscreen(id) {
        const card = this.cards.find(c => c.id === id);
        if (!card) return;

        this.fullscreenId = id;
        this.fsFlipped = false;

        document.getElementById('fsRequest').innerHTML = this.md(card.q);
        document.getElementById('fsResponse').innerHTML = this.md(card.r);

        document.getElementById('fsRequestPane').style.display = 'none';
        document.getElementById('fsResponsePane').style.display = 'block';

        document.getElementById('fullscreenOverlay').classList.add('active');
    }

    closeFullscreen() {
        document.getElementById('fullscreenOverlay').classList.remove('active');
        this.fullscreenId = null;
        this.fsFlipped = false;
    }

    toggleFullscreenFlip() {
        this.fsFlipped = !this.fsFlipped;
        const reqPane = document.getElementById('fsRequestPane');
        const resPane = document.getElementById('fsResponsePane');
        if (this.fsFlipped) {
            reqPane.style.display = 'block';
            resPane.style.display = 'none';
        } else {
            reqPane.style.display = 'none';
            resPane.style.display = 'block';
        }
    }

    toggleNativeFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    readCurrentFullscreen() {
        if (!this.fullscreenId) return;
        const card = this.cards.find(c => c.id === this.fullscreenId);
        if (!card) return;

        if (typeof responsiveVoice === 'undefined' || !responsiveVoice) {
            this.showToast('TTS not available');
            return;
        }

        const text = this.fsFlipped ? card.q : card.r;
        if (text) {
            if (responsiveVoice.isPlaying()) {
                responsiveVoice.cancel();
            } else {
                const cleanText = text.replace(/[#*_`>~-]/g, '').substring(0, 2000);
                responsiveVoice.speak(cleanText, "US English Female", { rate: 1.1 });
            }
        }
    }

    cycleView() {
        const views = ['list', 'grid', 'full'];
        const current = views.indexOf(this.settings.view);
        this.settings.view = views[(current + 1) % views.length];
        this.applyView();
        this.saveState();
        this.showToast(`View: ${this.settings.view}`);
    }

    setCardView(view) {
        this.settings.view = view;
        this.applyView();
        this.saveState();
        this.showToast(`View: ${view}`);
    }

    applyView() {
        document.body.className = `view-${this.settings.view}`;
        const icon = document.querySelector('#viewFab i');
        if (this.settings.view === 'list') icon.className = 'fas fa-list';
        else if (this.settings.view === 'grid') icon.className = 'fas fa-th';
        else if (this.settings.view === 'full') icon.className = 'fas fa-expand';
    }

    applyTheme() {
        const root = document.documentElement;
        root.style.setProperty('--primary', this.theme.primary);
        root.style.setProperty('--bg', this.theme.bg);
        root.style.setProperty('--card-bg', this.theme.cardBg);
        root.style.setProperty('--text', this.theme.text);
        root.style.setProperty('--border', this.theme.border);

        document.getElementById('brandPlaceholder').textContent = this.theme.name;

        const lockBtn = document.getElementById('lockLabel');
        if (lockBtn) lockBtn.textContent = this.theme.locked ? 'Unlock Theme' : 'Lock Theme';
    }

    toggleThemeMode() {
        const isDark = this.theme.bg === '#121212';
        if (isDark) {
            this.theme.bg = '#f8f9fa';
            this.theme.cardBg = '#ffffff';
            this.theme.text = '#222';
            this.theme.border = '#ddd';
        } else {
            this.theme.bg = '#121212';
            this.theme.cardBg = '#1e1e1e';
            this.theme.text = '#f5f5f5';
            this.theme.border = '#333';
        }
        this.applyTheme();
        this.saveState();
        this.showToast(isDark ? 'Light Mode' : 'Dark Mode');
    }

    toggleThemeLock() {
        this.theme.locked = !this.theme.locked;
        this.applyTheme();
        this.saveState();
        this.showToast(this.theme.locked ? 'Theme Locked' : 'Theme Unlocked');
    }

    initASR() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isListening = true;
                const btn = document.getElementById('sendBtn');
                btn.innerHTML = '<i class="fas fa-microphone"></i>';
                btn.classList.add('listening');
                btn.title = "Listening...";
            };

            this.recognition.onerror = (event) => {
                this.isListening = false;
                const btn = document.getElementById('sendBtn');
                btn.innerHTML = '⏎';
                btn.classList.remove('listening');
                btn.title = "Send";
                this.showToast("Speech recognition error");
            };

            this.recognition.onend = () => {
                this.isListening = false;
                const btn = document.getElementById('sendBtn');
                btn.innerHTML = '⏎';
                btn.classList.remove('listening');
                btn.title = "Send";
            };

            this.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                document.getElementById('userInput').value = transcript;
            };
        }
    }

    toggleASR() {
        this.settings.asrEnabled = !this.settings.asrEnabled;
        this.updateToggles();
        this.saveState();
    }

    toggleTTS() {
        this.settings.autoTTS = !this.settings.autoTTS;
        this.updateToggles();
        this.saveState();
    }

    updateToggles() {
        const asrBtn = document.getElementById('asrToggle');
        const ttsBtn = document.getElementById('ttsToggle');
        if (asrBtn) asrBtn.classList.toggle('active', this.settings.asrEnabled);
        if (ttsBtn) ttsBtn.classList.toggle('active', this.settings.autoTTS);
    }

    readCard(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const card = this.cards.find(c => c.id === id);
        if (!card || !card.r) return;

        if (typeof responsiveVoice === 'undefined' || !responsiveVoice) {
            this.showToast('TTS not available');
            return;
        }

        if (responsiveVoice.isPlaying()) {
            responsiveVoice.cancel();
        } else {
            const text = card.r.replace(/[#*_`>~-]/g, '').substring(0, 2000);
            responsiveVoice.speak(text, "US English Female", { rate: 1.1 });
        }
    }

    showToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }

    md(text) {
        if (!text) return '';
        try {
            return DOMPurify.sanitize(marked.parse(text));
        } catch (e) {
            console.error("Markdown parsing error", e);
            return text;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});