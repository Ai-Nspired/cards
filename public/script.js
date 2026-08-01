(function () {
  const API_URL = 'https://cards.ai-n.workers.dev/chat';
  const ARA_URL = 'https://cards.ai-n.workers.dev/chat';
  const STORAGE_KEY = 'kards_state_v1';

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return [...document.querySelectorAll(sel)]; }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(partial) {
    const s = loadSettings();
    Object.assign(s, partial);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  let state = loadSettings();

  function showToast(msg, type) {
    let container = $('#toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = 'toast show ' + (type || 'info');
    t.textContent = msg || 'Done';
    container.appendChild(t);
    setTimeout(() => t.classList.remove('show'), 3000);
    setTimeout(() => container.removeChild(t), 3500);
  }

  function renderCard(text) {
    const container = $('#cardContainer');
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'article');
    card.innerHTML = '<div class="card-header"><span class="role-badge">AI</span></div><div class="card-content markdown"></div>';
    card.querySelector('.card-content').innerHTML = renderContent(text);
    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
    saveSettings({});
  }

  function renderContent(raw) {
    const d = document.createElement('div');
    d.innerHTML = raw
      .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;"/>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br/>');
    return d.innerHTML;
  }

  async function fetchCardResponse(prompt, useStream) {
    const stopBtn = $('#stopBtn');
    const sendBtn = $('#sendBtn');
    sendBtn.disabled = true;
    stopBtn.disabled = false;
    const input = $('#promptInput');
    const endpoint = input.dataset.proxy || ARA_URL;

    const body = { prompt: prompt, prevTurn: state.lastTurn, url: state.scrapeUrl };

    try {
      let response;
      if (useStream) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify(body)
        });
        
        // Handle SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.answer) {
                renderCard(data.answer);
                return;
              } else if (data.accumulated) {
                accumulatedText = data.accumulated;
                const traceDiv1 = document.getElementById('traceInfo');
                const traceDiv2 = document.getElementById('traceInfo2');
                if (traceDiv1) traceDiv1.textContent = data.accumulated;
                if (traceDiv2) traceDiv2.textContent = data.accumulated;
              }
            }
          }
        }
      } else {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        state.lastTurn = prompt;
        state.accumulated = data.accumulated || state.accumulated;

        if (data.answer) {
          renderCard(data.answer);
        } else if (data.accumulated) {
          // intermediate trace display
          const traceDiv1 = document.getElementById('traceInfo');
          const traceDiv2 = document.getElementById('traceInfo2');
          if (traceDiv1) traceDiv1.textContent = data.accumulated;
          if (traceDiv2) traceDiv2.textContent = data.accumulated;
          if (data.trace) {
            if (traceDiv1) traceDiv1.textContent += '\nTrace: ' + data.trace;
            if (traceDiv2) traceDiv2.textContent += '\nTrace: ' + data.trace;
          }
        }

        if (data.error) {
          showToast('API Error: ' + data.error, 'error');
        }
      }
    } catch (err) {
      showToast('Error: ' + (err.message || 'unknown'), 'error');
    } finally {
      sendBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  function bindEvents() {
    $('#sendBtn')?.addEventListener('click', () => {
      const txt = $('#promptInput').value.trim();
      if (!txt) return showToast('Enter a prompt', 'error');
      const useStream = $('#toggleStream').checked;
      fetchCardResponse(txt, useStream);
    });

    $('#stopBtn')?.addEventListener('click', () => {
      showToast('Stopped', 'info');
    });

    $('#saveSettings')?.addEventListener('click', () => {
      state = saveSettings({
        streamEnabled: $('#toggleStream').checked,
        ttsEnabled: $('#toggleTTS').checked,
        proxyUrl: $('#proxyInput').value.trim()
      });
      showToast('Settings saved');
    });

    $('#clearAll')?.addEventListener('click', () => {
      if (confirm('Clear all cards?')) {
        $('#cardContainer').innerHTML = '';
        showToast('All cards cleared');
      }
    });

    $('#promptInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#sendBtn')?.click();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', bindEvents);
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') bindEvents();
  });
})();