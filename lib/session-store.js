const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DATA_DIR = path.join(os.homedir(), '.claude-dispatch-data');

class SessionStore {
  constructor() {
    this.sessions = new Map();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      const file = path.join(DATA_DIR, 'sessions.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      data.forEach((s) => {
        s.isRunning = false;
        this.sessions.set(s.id, s);
      });
    } catch {}
  }

  saveToDisk() {
    const file = path.join(DATA_DIR, 'sessions.json');
    const data = Array.from(this.sessions.values()).map((s) => ({
      ...s,
      isRunning: false,
    }));
    fs.writeFileSync(file, JSON.stringify(data), 'utf-8');
  }

  create(name, cwd, model) {
    const id = crypto.randomUUID();
    const session = {
      id,
      name: name || `Session ${this.sessions.size + 1}`,
      cwd: cwd || process.env.HOME,
      model: model || '',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
      hasMessages: false,
      isRunning: false,
    };
    this.sessions.set(id, session);
    this.saveToDisk();
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map(({ id, name, cwd, createdAt, lastActiveAt, messages, isRunning }) => {
        const last = messages[messages.length - 1];
        return {
          id,
          name,
          cwd,
          createdAt,
          lastActiveAt,
          messageCount: messages.length,
          isRunning,
          lastMessage: last ? { role: last.role, text: last.text.slice(0, 80) } : null,
        };
      });
  }

  addMessage(id, role, text, meta = {}) {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.messages.push({ role, text, timestamp: Date.now(), ...meta });
    session.lastActiveAt = Date.now();
    if (role === 'user') session.hasMessages = true;
    this.saveToDisk();
    return session;
  }

  getMessages(id) {
    const session = this.sessions.get(id);
    return session ? session.messages : [];
  }

  setRunning(id, running) {
    const session = this.sessions.get(id);
    if (session) session.isRunning = running;
  }

  delete(id) {
    this.sessions.delete(id);
    this.saveToDisk();
  }
}

module.exports = SessionStore;
