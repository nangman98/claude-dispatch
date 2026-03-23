(function () {
  'use strict';

  // -- State --
  let ws = null;
  let token = '';
  let currentSessionId = null;
  let sessions = [];
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let streamingBubble = null;
  let streamingText = '';
  let selectedDir = '';

  // -- DOM: Screens --
  const loginScreen = document.getElementById('login-screen');
  const sessionScreen = document.getElementById('session-screen');
  const chatScreen = document.getElementById('chat-screen');

  // -- DOM: Login --
  const tokenInput = document.getElementById('token-input');
  const tokenSubmit = document.getElementById('token-submit');

  // -- DOM: Session list --
  const statusDot = document.getElementById('status-dot');
  const sessionList = document.getElementById('session-list');
  const emptyState = document.getElementById('empty-state');
  const newSessionBtn = document.getElementById('new-session-btn');

  // -- DOM: Chat --
  const backBtn = document.getElementById('back-btn');
  const chatTitle = document.getElementById('chat-title');
  const chatSubtitle = document.getElementById('chat-subtitle');
  const chatHeaderInfo = document.getElementById('chat-header-info');
  const chatDeleteBtn = document.getElementById('chat-delete-btn');
  const thinkingBar = document.getElementById('thinking-bar');
  const chatArea = document.getElementById('chat-area');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');

  // -- DOM: Dir modal --
  const dirModal = document.getElementById('dir-modal');
  const dirCurrent = document.getElementById('dir-current');
  const dirListEl = document.getElementById('dir-list');
  const dirUp = document.getElementById('dir-up');
  const dirSelectBtn = document.getElementById('dir-select');

  // -- DOM: Rename modal --
  const renameModal = document.getElementById('rename-modal');
  const renameInput = document.getElementById('rename-input');
  const renameCancel = document.getElementById('rename-cancel');
  const renameConfirm = document.getElementById('rename-confirm');

  // ===== Init =====
  function init() {
    const params = new URLSearchParams(location.search);
    token = params.get('token') || localStorage.getItem('dispatch-token') || '';
    if (token) {
      localStorage.setItem('dispatch-token', token);
      if (params.has('token')) history.replaceState(null, '', location.pathname);
    }
    if (!token) {
      showScreen('login');
      tokenSubmit.addEventListener('click', submitToken);
      tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitToken(); });
      tokenInput.focus();
      return;
    }
    startApp();
  }

  function submitToken() {
    const val = tokenInput.value.trim();
    if (!val) return;
    try {
      const url = new URL(val);
      token = url.searchParams.get('token') || val;
    } catch { token = val; }
    localStorage.setItem('dispatch-token', token);
    startApp();
  }

  function startApp() {
    showScreen('sessions');
    connect();
    bindEvents();
  }

  function showScreen(name) {
    loginScreen.style.display = name === 'login' ? '' : 'none';
    sessionScreen.style.display = name === 'sessions' ? '' : 'none';
    chatScreen.style.display = name === 'chat' ? '' : 'none';
  }

  // ===== WebSocket =====
  function connect() {
    if (ws && ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?token=${token}`);
    ws.onopen = () => { statusDot.className = 'connected'; reconnectDelay = 1000; loadSessions(); };
    ws.onclose = () => { statusDot.className = ''; scheduleReconnect(); };
    ws.onerror = () => {};
    ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectDelay = Math.min(reconnectDelay * 2, 10000); connect(); }, reconnectDelay);
  }

  function wsSend(obj) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  // ===== Message handling =====
  function handleMessage(msg) {
    switch (msg.type) {
      case 'token':
        if (msg.sessionId === currentSessionId) {
          streamingText += msg.text;
          if (!streamingBubble) streamingBubble = addBubble('assistant', '');
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
        setThinking(false);
        enableInput();
        loadSessions(); // refresh list preview
        break;

      case 'status':
        if (msg.status === 'thinking') {
          statusDot.className = 'connected thinking';
          setThinking('Claude is thinking...');
        } else if (msg.status === 'tool') {
          statusDot.className = 'connected thinking';
          const toolLabels = {
            Bash: 'Running command...',
            Read: 'Reading file...',
            Write: 'Writing file...',
            Edit: 'Editing file...',
            Glob: 'Searching files...',
            Grep: 'Searching code...',
            WebFetch: 'Fetching web...',
            WebSearch: 'Searching web...',
            Agent: 'Running agent...',
          };
          setThinking(toolLabels[msg.tool] || `Using ${msg.tool}...`);
        } else {
          statusDot.className = 'connected';
          setThinking(false);
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
        setThinking(false);
        enableInput();
        break;
    }
  }

  function setThinking(text) {
    if (text) {
      thinkingBar.style.display = '';
      thinkingBar.querySelector('span:last-child').textContent = text;
    } else {
      thinkingBar.style.display = 'none';
    }
  }

  // ===== Sessions =====
  async function loadSessions() {
    try {
      const res = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
      sessions = await res.json();
      renderSessionList();
    } catch {}
  }

  function renderSessionList() {
    sessionList.innerHTML = '';
    emptyState.style.display = sessions.length === 0 ? '' : 'none';

    sessions.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'session-item';

      const initial = (s.name || 'S')[0].toUpperCase();
      const preview = s.lastMessage
        ? (s.lastMessage.role === 'user' ? 'You: ' : '') + s.lastMessage.text
        : s.cwd || 'Empty session';
      const time = formatTime(s.lastActiveAt);

      el.innerHTML = `
        <div class="session-avatar">${initial}</div>
        <div class="session-info">
          <div class="session-name">${escapeHtml(s.name)}</div>
          <div class="session-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="session-meta">
          <div class="session-time">${time}</div>
          ${s.isRunning ? '<div class="session-badge">running</div>' : ''}
        </div>
      `;

      el.addEventListener('click', () => openChat(s.id));
      sessionList.appendChild(el);
    });
  }

  async function openChat(id) {
    currentSessionId = id;
    streamingBubble = null;
    streamingText = '';

    const session = sessions.find((s) => s.id === id);
    chatTitle.textContent = session?.name || 'Chat';
    chatSubtitle.textContent = session?.cwd || '';

    showScreen('chat');
    chatArea.innerHTML = '';
    setThinking(false);

    try {
      const res = await fetch(`/api/sessions/${id}/messages`, { headers: { Authorization: `Bearer ${token}` } });
      const messages = await res.json();
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

  async function createSession() {
    dirModal.style.display = '';
    loadDirectories();
  }

  async function loadDirectories(dirPath) {
    try {
      const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
      const res = await fetch(`/api/directories${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      selectedDir = data.current;
      dirCurrent.textContent = data.current;
      dirListEl.innerHTML = '';
      data.directories.forEach((d) => {
        const el = document.createElement('div');
        el.className = 'dir-item';
        el.textContent = d.name;
        el.addEventListener('click', () => loadDirectories(d.path));
        dirListEl.appendChild(el);
      });
      dirUp.onclick = () => loadDirectories(data.parent);
    } catch {}
  }

  async function confirmCreateSession() {
    dirModal.style.display = 'none';
    try {
      const name = selectedDir.split('/').pop() || 'Home';
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, cwd: selectedDir }),
      });
      const session = await res.json();
      await loadSessions();
      openChat(session.id);
    } catch {}
  }

  async function deleteCurrentSession() {
    if (!currentSessionId) return;
    try {
      await fetch(`/api/sessions/${currentSessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      currentSessionId = null;
      showScreen('sessions');
      disableInput();
      await loadSessions();
    } catch {}
  }

  function showRenameModal() {
    const session = sessions.find((s) => s.id === currentSessionId);
    if (!session) return;
    renameInput.value = session.name;
    renameModal.style.display = '';
    renameInput.focus();
    renameInput.select();
  }

  async function confirmRename() {
    const name = renameInput.value.trim();
    if (!name || !currentSessionId) return;
    renameModal.style.display = 'none';
    try {
      await fetch(`/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      chatTitle.textContent = name;
      await loadSessions();
    } catch {}
  }

  // ===== Chat UI =====
  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    const content = document.createElement('span');
    content.className = 'content';
    if (role === 'assistant' && !text) content.classList.add('typing-indicator');
    content.textContent = text;
    div.appendChild(content);
    chatArea.appendChild(div);
    return div;
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

  function sendPrompt() {
    const text = promptInput.value.trim();
    if (!text || !currentSessionId) return;
    addBubble('user', text);
    scrollToBottom();
    promptInput.value = '';
    promptInput.style.height = 'auto';
    disableInput();
    wsSend({ type: 'prompt', sessionId: currentSessionId, text });
  }

  // ===== Markdown (minimal) =====
  function renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  // ===== Helpers =====
  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ===== Events =====
  function bindEvents() {
    newSessionBtn.addEventListener('click', createSession);
    dirSelectBtn.addEventListener('click', confirmCreateSession);
    backBtn.addEventListener('click', () => { showScreen('sessions'); loadSessions(); });
    chatDeleteBtn.addEventListener('click', deleteCurrentSession);
    chatHeaderInfo.addEventListener('click', showRenameModal);
    renameCancel.addEventListener('click', () => { renameModal.style.display = 'none'; });
    renameConfirm.addEventListener('click', confirmRename);
    renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmRename(); });
    sendBtn.addEventListener('click', sendPrompt);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    });
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
    });
  }

  // ===== PWA =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  init();
})();
