const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CMD_CACHE = path.join(os.homedir(), '.claude-dispatch-commands.json');
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

class ClaudeRunner {
  constructor() {
    this.processes = new Map(); // sessionId -> ProcessEntry
    this.latestRateLimit = null;
    this.onRateLimitUpdate = null; // server sets this to broadcast

    try {
      this.slashCommands = JSON.parse(fs.readFileSync(CMD_CACHE, 'utf-8'));
    } catch {
      this.slashCommands = [];
    }

    this._cleanupInterval = setInterval(() => this._cleanupIdle(), 60000);
  }

  /**
   * Send a prompt to a session.
   * - Text messages: persistent process (stdin streaming)
   * - Image messages: one-shot process (--image flag)
   */
  run(sessionId, prompt, isFirstMessage, cwd, images, options, callbacks) {
    if (images && images.length > 0) {
      return this._runOneShot(sessionId, prompt, isFirstMessage, cwd, images, options, callbacks);
    }

    let entry = this.processes.get(sessionId);

    // Restart if model or plan mode changed
    if (entry && this._needsRestart(entry, options)) {
      this._killProcess(sessionId);
      entry = null;
    }

    if (!entry) {
      entry = this._spawnPersistent(sessionId, isFirstMessage, cwd, options);
    }

    if (entry.busy) {
      callbacks.onError('A prompt is already running in this session');
      return;
    }

    entry.busy = true;
    entry.callbacks = callbacks;
    entry.lastActivity = Date.now();
    callbacks.onStatus('thinking');

    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
    entry.proc.stdin.write(msg + '\n');
  }

  _spawnPersistent(sessionId, isNewSession, cwd, options) {
    const model = options?.model || process.env.DISPATCH_MODEL || '';

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (options?.planMode) {
      args.push('--permission-mode', 'plan');
    } else {
      args.push('--dangerously-skip-permissions');
    }

    if (model) args.push('--model', model);
    args.push('--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config');

    if (isNewSession) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }

    const proc = spawn('claude', args, {
      cwd: cwd || process.env.HOME,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // DO NOT close stdin — keep open for subsequent messages

    const entry = {
      proc,
      sessionId,
      model,
      planMode: !!options?.planMode,
      cwd: cwd || process.env.HOME,
      buffer: '',
      stderrBuffer: '',
      busy: false,
      callbacks: null,
      lastActivity: Date.now(),
      oneShot: false,
    };

    proc.stdout.on('data', (chunk) => {
      entry.buffer += chunk.toString();
      const lines = entry.buffer.split('\n');
      entry.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this._handleEvent(entry, event);
        } catch {
          // skip non-JSON lines
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      entry.stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      this.processes.delete(sessionId);
      if (entry.busy && entry.callbacks) {
        const errMsg = entry.stderrBuffer.trim() || `Process exited with code ${code}`;
        entry.callbacks.onError(errMsg);
        entry.callbacks.onStatus('idle');
        entry.busy = false;
      }
    });

    proc.on('error', (err) => {
      this.processes.delete(sessionId);
      if (entry.busy && entry.callbacks) {
        entry.callbacks.onError(`Failed to start claude: ${err.message}`);
        entry.callbacks.onStatus('idle');
        entry.busy = false;
      }
    });

    this.processes.set(sessionId, entry);
    return entry;
  }

  _handleEvent(entry, event) {
    const cb = entry.callbacks;

    // System init — cache slash commands
    if (event.type === 'system' && event.subtype === 'init' && event.slash_commands) {
      this.slashCommands = event.slash_commands;
      try {
        fs.writeFileSync(CMD_CACHE, JSON.stringify(event.slash_commands));
      } catch {}
      return;
    }

    // Rate limit event
    if (event.type === 'rate_limit_event') {
      this.latestRateLimit = event.rate_limit_info;
      if (this.onRateLimitUpdate) this.onRateLimitUpdate(event.rate_limit_info);
      return;
    }

    if (!cb) return;

    // Stream events (token-by-token streaming)
    if (event.type === 'stream_event') {
      const evt = event.event;

      if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        cb.onStatus('responding');
        cb.onToken(evt.delta.text);
        return;
      }

      if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        cb.onStatus('tool', evt.content_block.name || 'tool');
        return;
      }

      if (evt?.type === 'content_block_start' && evt.content_block?.type === 'thinking') {
        cb.onStatus('thinking');
        return;
      }

      if (evt?.type === 'message_start') {
        cb.onStatus('thinking');
        return;
      }
      return;
    }

    // Result — turn complete
    if (event.type === 'result') {
      entry.busy = false;
      entry.stderrBuffer = '';
      cb.onComplete({
        text: event.result || '',
        cost: event.total_cost_usd,
        duration_ms: event.duration_ms,
        isError: event.is_error || false,
      });
      cb.onStatus('idle');
    }
  }

  /**
   * One-shot mode for image messages (--image flag requires separate process).
   * Kills any existing persistent process first; next text message will respawn.
   */
  _runOneShot(sessionId, prompt, isFirstMessage, cwd, images, options, callbacks) {
    this._killProcess(sessionId);

    const model = options?.model || process.env.DISPATCH_MODEL || '';
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (options?.planMode) {
      args.push('--permission-mode', 'plan');
    } else {
      args.push('--dangerously-skip-permissions');
    }

    if (model) args.push('--model', model);
    args.push('--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config');

    images.forEach((img) => args.push('--image', img));

    if (isFirstMessage) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }

    const proc = spawn('claude', args, {
      cwd: cwd || process.env.HOME,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.end();

    const entry = {
      proc,
      sessionId,
      model,
      planMode: !!options?.planMode,
      cwd: cwd || process.env.HOME,
      buffer: '',
      stderrBuffer: '',
      busy: true,
      callbacks,
      lastActivity: Date.now(),
      oneShot: true,
    };

    this.processes.set(sessionId, entry);
    callbacks.onStatus('thinking');

    proc.stdout.on('data', (chunk) => {
      entry.buffer += chunk.toString();
      const lines = entry.buffer.split('\n');
      entry.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this._handleEvent(entry, event);
        } catch {}
      }
    });

    proc.stderr.on('data', (chunk) => {
      entry.stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      this.processes.delete(sessionId);
      if (entry.buffer.trim()) {
        try {
          const event = JSON.parse(entry.buffer);
          this._handleEvent(entry, event);
        } catch {}
      }
      if (entry.busy) {
        if (code !== 0 && code !== null) {
          const errMsg = entry.stderrBuffer.trim() || `Process exited with code ${code}`;
          callbacks.onError(errMsg);
        }
        entry.busy = false;
        callbacks.onStatus('idle');
      }
    });

    proc.on('error', (err) => {
      this.processes.delete(sessionId);
      callbacks.onError(`Failed to start claude: ${err.message}`);
      callbacks.onStatus('idle');
    });
  }

  abort(sessionId) {
    return this._killProcess(sessionId);
  }

  _killProcess(sessionId) {
    const entry = this.processes.get(sessionId);
    if (entry) {
      entry.proc.kill('SIGTERM');
      this.processes.delete(sessionId);
      return true;
    }
    return false;
  }

  _needsRestart(entry, options) {
    const newModel = options?.model || process.env.DISPATCH_MODEL || '';
    const newPlanMode = !!options?.planMode;
    return entry.model !== newModel || entry.planMode !== newPlanMode;
  }

  _cleanupIdle() {
    const now = Date.now();
    for (const [sessionId, entry] of this.processes) {
      if (!entry.busy && (now - entry.lastActivity) > IDLE_TIMEOUT) {
        entry.proc.kill('SIGTERM');
        this.processes.delete(sessionId);
      }
    }
  }

  shutdown() {
    clearInterval(this._cleanupInterval);
    for (const [, entry] of this.processes) {
      entry.proc.kill('SIGTERM');
    }
    this.processes.clear();
  }
}

module.exports = ClaudeRunner;
