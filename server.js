const http = require('node:http');
const os = require('node:os');
const express = require('express');
const { WebSocketServer } = require('ws');
const { getOrCreateToken, authMiddleware, verifyWebSocket } = require('./lib/auth');
const SessionStore = require('./lib/session-store');
const ClaudeRunner = require('./lib/claude-runner');

const PORT = process.env.PORT || 3456;
const token = getOrCreateToken();
const store = new SessionStore();
const runner = new ClaudeRunner();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Auth for API routes
const api = express.Router();
api.use(authMiddleware(token));

api.get('/sessions', (req, res) => {
  res.json(store.list());
});

api.post('/sessions', (req, res) => {
  const session = store.create(req.body.name);
  res.json(session);
});

api.get('/sessions/:id/messages', (req, res) => {
  const messages = store.getMessages(req.params.id);
  if (!messages) return res.status(404).json({ error: 'Session not found' });
  res.json(messages);
});

api.delete('/sessions/:id', (req, res) => {
  runner.abort(req.params.id);
  store.delete(req.params.id);
  res.json({ ok: true });
});

app.use('/api', api);

// HTTP server
const server = http.createServer(app);

// WebSocket
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!verifyWebSocket(token, req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'prompt':
        handlePrompt(ws, msg);
        break;
      case 'abort':
        handleAbort(ws, msg);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });
});

function handlePrompt(ws, msg) {
  const { sessionId, text } = msg;
  if (!sessionId || !text) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing sessionId or text' }));
    return;
  }

  const session = store.get(sessionId);
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message: 'Session not found' }));
    return;
  }

  if (session.isRunning) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message: 'Session is busy' }));
    return;
  }

  store.addMessage(sessionId, 'user', text);
  store.setRunning(sessionId, true);

  const isFirstMessage = !session.hasMessages || session.messages.filter(m => m.role === 'user').length <= 1;

  runner.run(sessionId, text, isFirstMessage, {
    onToken(token) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'token', sessionId, text: token }));
      }
    },
    onComplete(result) {
      store.addMessage(sessionId, 'assistant', result.text, {
        cost: result.cost,
        duration_ms: result.duration_ms,
      });
      store.setRunning(sessionId, false);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'assistant_complete',
          sessionId,
          text: result.text,
          cost: result.cost,
          duration_ms: result.duration_ms,
        }));
      }
    },
    onError(message) {
      store.setRunning(sessionId, false);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', sessionId, message }));
      }
    },
    onStatus(status) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'status', sessionId, status }));
      }
    },
  });
}

function handleAbort(ws, msg) {
  const { sessionId } = msg;
  const aborted = runner.abort(sessionId);
  store.setRunning(sessionId, false);
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({
      type: 'status',
      sessionId,
      status: aborted ? 'aborted' : 'idle',
    }));
  }
}

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// Get local IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

// Start
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}?token=${token}`;

  console.log('\n  Claude Dispatch is running!\n');
  console.log(`  Local:   http://localhost:${PORT}?token=${token}`);
  console.log(`  Network: ${url}`);
  console.log('\n  Open the Network URL on your phone to get started.\n');

  // Simple QR code in terminal (ASCII)
  try {
    printQR(url);
  } catch {}
});

// Minimal QR-like display (just the URL, since qrcode lib isn't a dependency)
function printQR(url) {
  console.log('  Scan or visit:');
  console.log(`  ${url}\n`);
}

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('\n  Shutting down...');
  runner.activeProcesses?.forEach((proc) => proc.kill('SIGTERM'));
  wss.close();
  server.close(() => process.exit(0));
}
