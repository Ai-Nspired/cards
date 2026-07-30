class App {
  constructor() {
    this.stateKey = 'kards_state_v1';
    this.settings = this.loadSettings();
    this.sessionId = this.generateSessionId();
    this.isStreaming = false;
    this.abortController = null;
    this.debugLogs = [];
    this.cardIndex = 0;
  }

  generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  loadSettings() {
    try {
      const raw = localStorage.getItem(this.stateKey);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {
      view: 'list',
      autoTTS: false,
      asrEnabled: false,
      proxyUrl: '',
      streamEnabled: false
    };
  }

  saveSettings() {
    try {
      localStorage.setItem(this.stateKey, JSON.stringify(this.settings));
    } catch(e) {}
  }

  getProxyUrl() {
    return this.settings.proxyUrl || "https://ai.nspired.cc/chat";
  }

  async handleSendClick() {
    if (this.isStreaming && this.abortController) {
      this.abortController.abort();
      this.showToast('Request cancelled');
      return;
    }
    const input = document.getElementById('userInput');
    const proxyInput = document.getElementById('proxyInput');
    if (proxyInput && proxyInput.value) {
      this.settings.proxyUrl = proxyInput.value.trim();
      this.saveSettings();
    }
    const prompt = input.value.trim();
    if (!prompt) return;
    this.addCard('user', prompt);
    input.value = '';
    this.debugLogs = [];
    this.renderDebug();
    await this.streamFetchCompletion(prompt, this.addCard.bind(this));
  }

  getStoredInferences() {
    try { return JSON.parse(localStorage.getItem('kards_inferences') || '[]'); } catch { return []; }
  }

  addInference(item) {
    const list = this.getStoredInferences();
    list.unshift(item);
    if (list.length > 50) list.length = 50;
    try { localStorage.setItem('kards_inferences', JSON.stringify(list)); } catch(e) {}
    this.renderInferenceList();
  }

  streamFetchCompletion(prompt, onToken) {
    this.isStreaming = this.settings.streamEnabled;
    this.abortController = new AbortController();
    const url = this.getProxyUrl();
    const body = JSON.stringify({ prompt, cards: [] });

    this.debugLog(`POST ${url}`);
    this.debugLog('body:', body);

    const headers = { 'Content-Type': 'application/json' };

    const doFetch = async (signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: signal || undefined
      });
      this.debugLog('status:', res.status);
      this.debugLog('headers:', Object.fromEntries(res.headers.entries()));

      const ctype = res.headers.get('content-type') || '';
      let rawText = '';

      if (ctype.includes('text/event-stream')) {
        this.debugLog('streaming SSE');
        onToken?.('');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            if (line.startsWith('event: done')) { this.debugLog('SSE done'); return; }
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const text = json.response || json.text || JSON.stringify(json);
                this.debugLog('chunk:', text.substring(0, 80));
                onToken?.(text);
              } catch(e) {
                // If it's not JSON, treat as plain text chunk
                this.debugLog('text chunk:', data.substring(0, 80));
                onToken?.(data);
              }
            }
          }
        }
      } else {
        // Fallback: parse as JSON
        try {
          rawText = await res.text();
          this.debugLog('raw response:', rawText.substring(0, 200));
          const json = JSON.parse(rawText);
          const text = json.response || json.text || JSON.stringify(json);
          onToken?.(text);
          this.debugLog('parsed OK');
        } catch (e) {
          // Last resort: show raw text as fallback
          this.debugLog('parse failed, showing raw:', rawText.substring(0, 400));
          onToken?.(rawText || 'No response content');
        }
      }
    };

    doFetch(this.abortController.signal).catch(err => {
      if (err.name === 'AbortError') {
        this.debugLog('fetch aborted');
        this.showToast('Request cancelled');
        return;
      }
      this.debugLog('error:', err.message || String(err));
      this.showToast('Request failed: ' + (err.message || 'unknown'));
    }).finally(() => {
      this.isStreaming = false;
      this.abortController = null;
    });
  }

  addCard(type, content) {
    const container = document.getElementById('cardContainer');
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = ++this.cardIndex;
    const role = type === 'user' ? 'You' : 'AI';
    card.innerHTML = `<div class="card-header"><span class="role-badge">${role}</span></div><div class="card-content markdown">${this.renderContent(content)}</div>`;
    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
    this.renderAll();
    this.saveStateDebounced();
  }

  renderContent(content) {
    // Render markdown image and links
    return content
      .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;"/>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br/>');
  }

  // --- UI rendering (simplified) ---
  renderAll() {
    // theme applied if available
    if (typeof this.applyTheme === 'function') this.applyTheme();
    if (typeof this.applyView === 'function') this.applyView();
  }

  showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast show ${type}`;
    toast.textContent = message || 'Done';
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('show'), 3000);
    setTimeout(() => container.removeChild(toast), 3500);
  }

  // --- Debug UI ---
  debugLog(...args) {
    this.debugLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    if (this.debugLogs.length > 50) this.debugLogs = this.debugLogs.slice(-50);
  }

  renderDebug() {
    let panel = document.getElementById('debugPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'debugPanel';
      panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:340px;max-height:50vh;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:8px;padding:10px;font:12px/1.4 monospace;overflow:auto;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.4)'
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
      const title = document.createElement('strong');
      title.textContent = '[Kards Debug]';
      title.style.cssText = 'color:#58a6ff';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'background:none;border:1px solid #30363d;color:#c9d1d9;border-radius:4px;padding:0 6px;cursor:pointer;font-weight:700';
      closeBtn.onclick = () => panel.style.display = 'none';
      header.appendChild(title);
      header.appendChild(closeBtn);
      const list = document.createElement('div');
      list.id = 'debugList';
      list.style.cssText = 'white-space:pre-wrap;font-size:11px';
      panel.appendChild(header);
      panel.appendChild(list);
      document.body.appendChild(panel);
    }
    const list = document.getElementById('debugList');
    list.textContent = this.debugLogs.slice(-200).join('\n');
    panel.style.display = '';
  }
}

// Instantiate and mount
const app = new App();
window.kardsApp = app;

// Expose a few helpers for manual debugging in console
window.kardsAppDebug = {
  openDebug: () => document.getElementById('debugPanel')?.click && document.getElementById('debugPanel').style.display = '',
  lastResponse: () => console.log('Last logs:', app.debugLogs.slice(-5)),
  rerender: () => app.renderAll()
};

// Initialize saved settings into UI
(function initUI() {
  const proxyInput = document.getElementById('proxyInput');
  if (proxyInput && app.settings.proxyUrl) proxyInput.value = app.settings.proxyUrl;
  document.getElementById('toggleStream') && (document.getElementById('toggleStream').checked = app.settings.streamEnabled);
})();

// Theme persistence helpers (no-op if not defined)
window.applyTheme = () => {};
window.applyView = () => {};

// Make sure init doesn't throw on missing methods
if (typeof app.init === 'function') {
  app.init().catch(e => console.error(e));
} else {
  app.renderAll();
}

// Expose init for external callers
window.kardsAppInit = () => app.init ? app.init() : Promise.resolve();