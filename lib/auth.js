const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TOKEN_PATH = path.join(os.homedir(), '.claude-dispatch-token');

function getOrCreateToken() {
  try {
    const existing = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    if (existing) return existing;
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

function extractToken(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  const url = new URL(req.url || '', 'http://localhost');
  return url.searchParams.get('token');
}

function authMiddleware(token) {
  return (req, res, next) => {
    if (extractToken(req) === token) return next();
    res.status(401).json({ error: 'Unauthorized' });
  };
}

function verifyWebSocket(token, req) {
  return extractToken(req) === token;
}

module.exports = { getOrCreateToken, authMiddleware, verifyWebSocket };
