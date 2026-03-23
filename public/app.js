(function () {
  'use strict';

  // -- State --
  let ws = null;
  let token = '';
  let currentSessionId = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let streamingBubble = null;
  let streamingText = '';

  // -- DOM --
  const statusDot = document.getElementById('status-dot');
  const sessionSelect = document.getElementById('session-select');
  const newSessionBtn = document.getElementById('new-session-btn');
  const deleteSessionBtn = document.getElementById('delete-session-btn');
  const chatArea = document.getElementById('chat-area');
  const welcome = document.getElementById('welcome');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');

  // -- DOM (login) --
  const loginScreen = document.getElementById('login-screen');
  const tokenInput = document.getElementById('token-input');
  const tokenSubmit = document.getElementById('token-submit');

  // -- Init --
  function init() {
    // Extract token from URL or localStorage
    const params = new URLSearchParams(location.search);
    token = params.get('token') || localStorage.getItem('dispatch-token') || '';
    if (token) {
      localStorage.setItem('dispatch-token', token);
      // Clean URL
      if (params.has('token')) {
        history.replaceState(null, '', location.pathname);
      }
    }
    if (!token) {
      showLoginScreen();
      return;
    }

    connect();
    bindEvents();
  }

  function showLoginScreen() {
    loginScreen.style.display = '';
    tokenSubmit.addEventListener('click', submitToken);
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitToken();
    });
    tokenInput.focus();
  }

  function submitToken() {
    const val = tokenInput.value.trim();
    if (!val) return;
    // Support pasting full URL or just the token
    try {
      const url = new URL(val);
      token = url.searchParams.get('token') || val;
    } catch {
      token = val;
    }
    localStorage.setItem('dispatch-token', token);
    loginScreen.style.display = 'none';
    connect();
    bindEvents();
  }

  // -- WebSocket --
  function connect() {
    if (ws && ws.readyState <= 1) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?token=${token}`);

    ws.onopen = () => {
      statusDot.className = 'connected';
      reconnectDelay = 1000;
      loadSessions();
    };

    ws.onclose = () => {
      statusDot.className = '';
      scheduleReconnect();
    };

    ws.onerror = () => {};

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleMessage(msg);
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
      connect();
    }, reconnectDelay);
  }

  function send(obj) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // -- Message handling --
  function handleMessage(msg) {
    switch (msg.type) {
      case 'token':
        if (msg.sessionId === currentSessionId) {
          streamingText += msg.text;
          if (!streamingBubble) {
            streamingBubble = addBubble('assistant', '');
          }
          streamingBubble.querySelector('.content').textContent = streamingText;
          scrollToBottom();
        }
        break;

      case 'assistant_complete':
        if (msg.sessionId === currentSessionId) {
          if (streamingBubble) {
            const content = streamingBubble.querySelector('.content');
            content.innerHTML = renderMarkdown(msg.text);
            content.classList.remove('typing-indicator');
            // Add meta
            if (msg.cost != null) {
              const meta = document.createElement('span');
              meta.className = 'meta';
              meta.textContent = `$${msg.cost.toFixed(4)} · ${(msg.duration_ms / 1000).toFixed(1)}s`;
              streamingBubble.appendChild(meta);
            }
            streamingBubble = null;
            streamingText = '';
          }
          scrollToBottom();
        }
        enableInput();
        break;

      case 'status':
        if (msg.status === 'thinking') {
          statusDot.className = 'connected thinking';
        } else {
          statusDot.className = 'connected';
          if (msg.status === 'idle' || msg.status === 'aborted') {
            enableInput();
            if (msg.status === 'aborted' && streamingBubble) {
              streamingBubble.querySelector('.content').classList.remove('typing-indicator');
              streamingBubble = null;
              streamingText = '';
            }
          }
        }
        break;

      case 'error':
        if (!msg.sessionId || msg.sessionId === currentSessionId) {
          addBubble('error', msg.message);
          scrollToBottom();
        }
        enableInput();
        break;

      case 'pong':
        break;
    }
  }

  // -- Sessions --
  async function loadSessions() {
    try {
      const res = await fetch(`/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const sessions = await res.json();
      renderSessionList(sessions);
    } catch {}
  }

  function renderSessionList(sessions) {
    sessionSelect.innerHTML = '';
    if (sessions.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = 'No sessions';
      sessionSelect.appendChild(opt);
      return;
    }
    sessions.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.messageCount})`;
      if (s.id === currentSessionId) opt.selected = true;
      sessionSelect.appendChild(opt);
    });
  }

  async function createSession() {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const session = await res.json();
      currentSessionId = session.id;
      await loadSessions();
      switchSession(session.id);
    } catch {}
  }

  async function deleteSession() {
    if (!currentSessionId) return;
    try {
      await fetch(`/api/sessions/${currentSessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      currentSessionId = null;
      clearChat();
      welcome.style.display = '';
      disableInput();
      await loadSessions();
    } catch {}
  }

  async function switchSession(id) {
    currentSessionId = id;
    streamingBubble = null;
    streamingText = '';
    clearChat();

    try {
      const res = await fetch(`/api/sessions/${id}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const messages = await res.json();
      welcome.style.display = 'none';

      messages.forEach((m) => {
        const bubble = addBubble(m.role, '');
        bubble.querySelector('.content').innerHTML = renderMarkdown(m.text);
        if (m.cost != null) {
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = `$${m.cost.toFixed(4)}`;
          bubble.appendChild(meta);
        }
      });
      scrollToBottom();
      enableInput();
    } catch {}
  }

  // -- Chat UI --
  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    const content = document.createElement('span');
    content.className = 'content';
    if (role === 'assistant' && !text) {
      content.classList.add('typing-indicator');
    }
    content.textContent = text;
    div.appendChild(content);
    chatArea.appendChild(div);
    return div;
  }

  function clearChat() {
    chatArea.querySelectorAll('.message').forEach((el) => el.remove());
  }

  function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function enableInput() {
    promptInput.disabled = false;
    sendBtn.disabled = false;
    promptInput.focus();
  }

  function disableInput() {
    promptInput.disabled = true;
    sendBtn.disabled = true;
  }

  function showError(msg) {
    addBubble('error', msg);
  }

  // -- Markdown (minimal) --
  function renderMarkdown(text) {
    if (!text) return '';
    return text
      // code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // italic
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      // newlines
      .replace(/\n/g, '<br>');
  }

  // -- Events --
  function bindEvents() {
    newSessionBtn.addEventListener('click', createSession);
    deleteSessionBtn.addEventListener('click', deleteSession);

    sessionSelect.addEventListener('change', (e) => {
      switchSession(e.target.value);
    });

    sendBtn.addEventListener('click', sendPrompt);

    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    });

    // Auto-resize textarea
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
    });
  }

  function sendPrompt() {
    const text = promptInput.value.trim();
    if (!text || !currentSessionId) return;

    addBubble('user', text);
    scrollToBottom();
    promptInput.value = '';
    promptInput.style.height = 'auto';
    disableInput();

    send({ type: 'prompt', sessionId: currentSessionId, text });
  }

  // -- PWA --
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  init();
})();
