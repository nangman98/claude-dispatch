const crypto = require('node:crypto');

class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create(name) {
    const id = crypto.randomUUID();
    const session = {
      id,
      name: name || `Session ${this.sessions.size + 1}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
      hasMessages: false,
      isRunning: false,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map(({ id, name, createdAt, lastActiveAt, messages, isRunning }) => ({
        id,
        name,
        createdAt,
        lastActiveAt,
        messageCount: messages.length,
        isRunning,
      }));
  }

  addMessage(id, role, text, meta = {}) {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.messages.push({ role, text, timestamp: Date.now(), ...meta });
    session.lastActiveAt = Date.now();
    if (role === 'user') session.hasMessages = true;
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
  }
}

module.exports = SessionStore;
