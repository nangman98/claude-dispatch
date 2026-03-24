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
  const dashboardScreen = document.getElementById('dashboard-screen');

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
  const chatModelSelect = document.getElementById('chat-model-select');
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
    loadSessions(); // also load via REST in case WebSocket is slow
  }

  function showScreen(name) {
    loginScreen.style.display = name === 'login' ? '' : 'none';
    sessionScreen.style.display = name === 'sessions' ? '' : 'none';
    chatScreen.style.display = name === 'chat' ? '' : 'none';
    dashboardScreen.style.display = name === 'dashboard' ? '' : 'none';
  }

  // ===== WebSocket =====
  function connect() {
    if (ws && ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?token=${token}`);
    ws.onopen = () => { statusDot.className = 'connected'; reconnectDelay = 1000; loadSessions(); loadCommands(); };
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
        loadSessions();
        loadCommands(); // refresh after first response caches them
        break;

      case 'status':
        if (msg.status === 'thinking') {
          statusDot.className = 'connected thinking';
          setThinking('Claude is thinking...');
        } else if (msg.status === 'responding') {
          statusDot.className = 'connected thinking';
          setThinking('Responding...');
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

    chatModelSelect.value = session?.model || '';

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
    const model = document.getElementById('model-select').value;
    try {
      const name = selectedDir.split('/').pop() || 'Home';
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, cwd: selectedDir, model }),
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

  // -- Slash command autocomplete --
  const cmdPopup = document.getElementById('cmd-popup');
  let slashCommands = [];

  async function loadCommands() {
    try {
      const res = await fetch('/api/commands', { headers: { Authorization: `Bearer ${token}` } });
      slashCommands = await res.json();
    } catch {}
  }

  function handleInputForCommands() {
    const text = promptInput.value;
    if (text.startsWith('/') && !text.includes(' ')) {
      const query = text.slice(1).toLowerCase();
      const matches = slashCommands.filter((c) => c.toLowerCase().includes(query)).slice(0, 8);
      if (matches.length > 0) {
        cmdPopup.innerHTML = '';
        matches.forEach((cmd) => {
          const el = document.createElement('div');
          el.className = 'cmd-item';
          el.innerHTML = `<span class="cmd-name">/${cmd}</span>`;
          el.addEventListener('click', () => {
            promptInput.value = `/${cmd} `;
            cmdPopup.style.display = 'none';
            promptInput.focus();
          });
          cmdPopup.appendChild(el);
        });
        cmdPopup.style.display = '';
        return;
      }
    }
    cmdPopup.style.display = 'none';
  }

  // -- Image handling --
  const fileInput = document.getElementById('file-input');
  const imagePreview = document.getElementById('image-preview');
  let pendingImages = []; // server file paths

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-Filename': file.name },
          body: file,
        });
        const data = await res.json();
        pendingImages.push(data.path);

        const wrap = document.createElement('span');
        wrap.className = 'img-remove';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        wrap.appendChild(img);
        wrap.addEventListener('click', () => {
          pendingImages = pendingImages.filter((p) => p !== data.path);
          wrap.remove();
          if (pendingImages.length === 0) imagePreview.style.display = 'none';
        });
        imagePreview.appendChild(wrap);
        imagePreview.style.display = '';
      } catch {}
    }
    fileInput.value = '';
  }

  function sendPrompt() {
    const text = promptInput.value.trim();
    if ((!text && pendingImages.length === 0) || !currentSessionId) return;
    addBubble('user', text || '(image)');
    scrollToBottom();
    promptInput.value = '';
    promptInput.style.height = 'auto';
    disableInput();

    const prompt = text || 'Describe this image.';
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    if (images) {
      pendingImages = [];
      imagePreview.innerHTML = '';
      imagePreview.style.display = 'none';
    }

    // Try WebSocket first, fallback to REST
    if (ws?.readyState === WebSocket.OPEN) {
      const msg = { type: 'prompt', sessionId: currentSessionId, text: prompt };
      if (images) msg.images = images;
      wsSend(msg);
    } else {
      sendPromptREST(prompt, images);
    }
  }

  async function sendPromptREST(text, images) {
    setThinking('Claude is thinking...');
    try {
      const res = await fetch(`/api/sessions/${currentSessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, images }),
      });
      const result = await res.json();
      if (res.ok) {
        const bubble = addBubble('assistant', '');
        bubble.querySelector('.content').innerHTML = renderMarkdown(result.text);
        if (result.cost != null) {
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = `$${result.cost.toFixed(4)} · ${(result.duration_ms / 1000).toFixed(1)}s`;
          bubble.appendChild(meta);
        }
        scrollToBottom();
      } else {
        addBubble('error', result.error || 'Error');
      }
    } catch (e) {
      addBubble('error', 'Connection failed');
    }
    setThinking(false);
    enableInput();
    loadSessions();
  }

  // ===== Dashboard =====
  async function openDashboard() {
    showScreen('dashboard');
    const overview = document.getElementById('dash-overview');
    const activity = document.getElementById('dash-activity');
    const memory = document.getElementById('dash-memory');
    const system = document.getElementById('dash-system');

    overview.innerHTML = '<div class="dash-empty">Loading...</div>';
    activity.innerHTML = '';
    memory.innerHTML = '';
    system.innerHTML = '';

    try {
      const res = await fetch('/api/dashboard', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();

      // Overview cards
      overview.innerHTML = `
        <div class="dash-card"><div class="card-label">Sessions</div><div class="card-value">${data.sessions.total}</div></div>
        <div class="dash-card"><div class="card-label">Running</div><div class="card-value success">${data.sessions.running}</div></div>
        <div class="dash-card"><div class="card-label">Messages</div><div class="card-value">${data.sessions.totalMessages}</div></div>
        <div class="dash-card"><div class="card-label">Total Cost</div><div class="card-value accent">$${data.sessions.totalCost}</div></div>
      `;

      // Recent activity
      if (data.recentActivity.length === 0) {
        activity.innerHTML = '<div class="dash-empty">No activity yet</div>';
      } else {
        data.recentActivity.forEach((a) => {
          const el = document.createElement('div');
          el.className = 'dash-activity-item';
          el.innerHTML = `
            <div class="activity-dot ${a.role}"></div>
            <div class="activity-body">
              <div class="activity-header">
                <span class="activity-session">${escapeHtml(a.sessionName)}</span>
                <span class="activity-time">${formatTime(a.timestamp)}</span>
              </div>
              <div class="activity-text">${escapeHtml(a.text)}</div>
            </div>
          `;
          activity.appendChild(el);
        });
      }

      // Memory files
      if (data.memoryFiles.length === 0) {
        memory.innerHTML = '<div class="dash-empty">No memory files found</div>';
      } else {
        data.memoryFiles.forEach((m) => {
          const el = document.createElement('div');
          el.className = 'dash-memory-item';
          // Extract description from frontmatter
          const descMatch = m.content.match(/description:\s*(.+)/);
          const desc = descMatch ? descMatch[1].trim() : '';
          el.innerHTML = `
            <div class="mem-name">${escapeHtml(m.name)}</div>
            ${desc ? `<div class="mem-preview">${escapeHtml(desc)}</div>` : ''}
          `;
          el.addEventListener('click', () => el.classList.toggle('expanded'));
          memory.appendChild(el);
        });
      }

      // System info
      const uptimeH = Math.floor(data.system.uptime / 3600);
      const uptimeM = Math.floor((data.system.uptime % 3600) / 60);
      system.innerHTML = `
        <div class="dash-card"><div class="card-label">Host</div><div class="card-value small">${escapeHtml(data.system.hostname)}</div></div>
        <div class="dash-card"><div class="card-label">Platform</div><div class="card-value small">${escapeHtml(data.system.platform)}</div></div>
        <div class="dash-card"><div class="card-label">Uptime</div><div class="card-value small">${uptimeH}h ${uptimeM}m</div></div>
        <div class="dash-card"><div class="card-label">Node</div><div class="card-value small">${escapeHtml(data.system.nodeVersion)}</div></div>
      `;
    } catch {
      overview.innerHTML = '<div class="dash-empty">Failed to load dashboard</div>';
    }
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
    document.getElementById('dashboard-btn').addEventListener('click', openDashboard);
    document.getElementById('dash-back-btn').addEventListener('click', () => { showScreen('sessions'); });
    dirSelectBtn.addEventListener('click', confirmCreateSession);
    backBtn.addEventListener('click', () => { showScreen('sessions'); loadSessions(); });
    chatDeleteBtn.addEventListener('click', deleteCurrentSession);
    chatModelSelect.addEventListener('change', async () => {
      if (!currentSessionId) return;
      await fetch(`/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: chatModelSelect.value }),
      });
      const s = sessions.find((s) => s.id === currentSessionId);
      if (s) s.model = chatModelSelect.value;
    });
    chatHeaderInfo.addEventListener('click', showRenameModal);
    renameCancel.addEventListener('click', () => { renameModal.style.display = 'none'; });
    renameConfirm.addEventListener('click', confirmRename);
    renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmRename(); });
    tabBar.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    termRunBtn.addEventListener('click', runTermCommand);
    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runTermCommand();
      if (e.key === 'Tab') { e.preventDefault(); handleTabComplete(); }
    });
    fileInput.addEventListener('change', handleFileSelect);
    sendBtn.addEventListener('click', sendPrompt);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    });
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
      handleInputForCommands();
    });
  }

  // ===== Tabs (Chat / Terminal) =====
  const tabBar = document.getElementById('tab-bar');
  const termArea = document.getElementById('term-area');
  const termOutput = document.getElementById('term-output');
  const chatFooter = document.getElementById('chat-footer');
  const termFooter = document.getElementById('term-footer');
  const termInput = document.getElementById('term-input');
  const termRunBtn = document.getElementById('term-run');
  let activeTab = 'chat';

  function switchTab(tab) {
    activeTab = tab;
    tabBar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    chatArea.style.display = tab === 'chat' ? '' : 'none';
    termArea.style.display = tab === 'term' ? '' : 'none';
    chatFooter.style.display = tab === 'chat' ? '' : 'none';
    termFooter.style.display = tab === 'term' ? '' : 'none';
    document.getElementById('cmd-popup').style.display = 'none';
    document.getElementById('image-preview').style.display = 'none';
    if (tab === 'term') termInput.focus();
    else promptInput.focus();
  }

  let tabMatches = [];
  let tabIndex = -1;
  let tabOriginal = '';

  async function handleTabComplete() {
    const input = termInput.value;
    const session = sessions.find((s) => s.id === currentSessionId);
    const cwd = session?.cwd || '';

    if (tabMatches.length > 0 && tabOriginal) {
      // Cycle through matches
      tabIndex = (tabIndex + 1) % tabMatches.length;
      const parts = tabOriginal.split(' ');
      parts[parts.length - 1] = tabMatches[tabIndex];
      termInput.value = parts.join(' ');
      return;
    }

    // Fetch matches
    tabOriginal = input;
    tabIndex = 0;
    try {
      const res = await fetch(`/api/complete?input=${encodeURIComponent(input)}&cwd=${encodeURIComponent(cwd)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      tabMatches = await res.json();
      if (tabMatches.length === 1) {
        const parts = input.split(' ');
        parts[parts.length - 1] = tabMatches[0];
        termInput.value = parts.join(' ');
        tabMatches = [];
        tabOriginal = '';
      } else if (tabMatches.length > 1) {
        const parts = input.split(' ');
        parts[parts.length - 1] = tabMatches[0];
        termInput.value = parts.join(' ');
        // Show matches in terminal output
        const block = document.createElement('div');
        block.className = 'term-block';
        block.innerHTML = `<div class="term-out" style="color:var(--text-muted)">${tabMatches.join('  ')}</div>`;
        termOutput.appendChild(block);
        termArea.scrollTop = termArea.scrollHeight;
      }
    } catch {}
  }

  // Reset tab state on any other input
  termInput.addEventListener('input', () => {
    tabMatches = [];
    tabIndex = -1;
    tabOriginal = '';
  });

  async function runTermCommand() {
    const cmd = termInput.value.trim();
    if (!cmd) return;
    termInput.value = '';

    const session = sessions.find((s) => s.id === currentSessionId);
    const cwd = session?.cwd || '';

    const block = document.createElement('div');
    block.className = 'term-block';
    block.innerHTML = `<div class="term-cmd">$ ${escapeHtml(cmd)}</div>`;
    termOutput.appendChild(block);

    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: cmd, cwd }),
      });
      const data = await res.json();
      if (data.stdout) {
        const out = document.createElement('div');
        out.className = 'term-out';
        out.textContent = data.stdout;
        block.appendChild(out);
      }
      if (data.stderr) {
        const err = document.createElement('div');
        err.className = 'term-err';
        err.textContent = data.stderr;
        block.appendChild(err);
      }
    } catch {
      const err = document.createElement('div');
      err.className = 'term-err';
      err.textContent = 'Connection error';
      block.appendChild(err);
    }
    termArea.scrollTop = termArea.scrollHeight;
  }

  // ===== Theme =====
  const themes = [
    { name: 'Midnight', bg: '#0d1117', surface: '#161b22' },
    { name: 'Ocean', bg: '#0a192f', surface: '#112240' },
    { name: 'Forest', bg: '#0b1a0b', surface: '#142814' },
    { name: 'Purple', bg: '#1a0a2e', surface: '#2d1b69' },
    { name: 'Warm', bg: '#1c1410', surface: '#2a1f1a' },
    { name: 'Slate', bg: '#1e293b', surface: '#334155' },
    { name: 'Rose', bg: '#1a0a14', surface: '#2d1520' },
    { name: 'Carbon', bg: '#171717', surface: '#262626' },
  ];

  const themeModal = document.getElementById('theme-modal');
  const themeGrid = document.getElementById('theme-grid');
  const customBg = document.getElementById('custom-bg');

  function initThemes() {
    themeGrid.innerHTML = '';
    themes.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'theme-swatch';
      el.style.background = `linear-gradient(135deg, ${t.bg}, ${t.surface})`;
      el.title = t.name;
      el.addEventListener('click', () => applyTheme(t.bg, t.surface));
      themeGrid.appendChild(el);
    });

    customBg.addEventListener('input', (e) => {
      applyTheme(e.target.value, adjustColor(e.target.value, 15));
    });

    document.getElementById('theme-btn').addEventListener('click', () => { themeModal.style.display = ''; });
    document.getElementById('theme-close').addEventListener('click', () => { themeModal.style.display = 'none'; });

    // Background image
    document.getElementById('bg-file-input').addEventListener('change', handleBgImage);
    document.getElementById('bg-clear-btn').addEventListener('click', clearBgImage);

    // Load saved theme
    const saved = localStorage.getItem('dispatch-theme');
    if (saved) {
      try {
        const { bg, surface } = JSON.parse(saved);
        applyTheme(bg, surface, false);
      } catch {}
    }

    // Load saved bg image
    const savedBg = localStorage.getItem('dispatch-bg-image');
    if (savedBg) applyBgImage(savedBg, false);
  }

  function handleBgImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      applyBgImage(ev.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function applyBgImage(dataUrl, save = true) {
    const chatScreen = document.getElementById('chat-screen');
    chatScreen.style.backgroundImage = `url(${dataUrl})`;
    chatScreen.style.backgroundSize = 'cover';
    chatScreen.style.backgroundPosition = 'center';
    chatScreen.classList.add('has-bg-image');
    if (save) localStorage.setItem('dispatch-bg-image', dataUrl);
  }

  function clearBgImage() {
    const chatScreen = document.getElementById('chat-screen');
    chatScreen.style.backgroundImage = '';
    chatScreen.classList.remove('has-bg-image');
    localStorage.removeItem('dispatch-bg-image');
  }

  function applyTheme(bg, surface, save = true) {
    document.documentElement.style.setProperty('--bg', bg);
    document.documentElement.style.setProperty('--surface', surface);
    if (save) localStorage.setItem('dispatch-theme', JSON.stringify({ bg, surface }));
  }

  function adjustColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  }

  initThemes();

  // ===== iOS keyboard resize fix =====
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const screen = document.getElementById('chat-screen');
      if (screen.style.display !== 'none') {
        screen.style.height = window.visualViewport.height + 'px';
        scrollToBottom();
      }
    });
    window.visualViewport.addEventListener('scroll', () => {
      // prevent iOS from scrolling the viewport
      window.scrollTo(0, 0);
    });
  }

  // ===== PWA =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  init();
})();
