const { spawn } = require('node:child_process');

class ClaudeRunner {
  constructor() {
    this.activeProcesses = new Map();
  }

  run(sessionId, prompt, isFirstMessage, cwd, { onToken, onComplete, onError, onStatus }) {
    if (this.activeProcesses.has(sessionId)) {
      onError('A prompt is already running in this session');
      return;
    }

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ];

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

    this.activeProcesses.set(sessionId, proc);
    onStatus('thinking');

    let buffer = '';
    let stderrBuffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this.handleEvent(event, { onToken, onComplete, onError, onStatus });
        } catch {
          // skip non-JSON lines
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      this.activeProcesses.delete(sessionId);

      // process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          this.handleEvent(event, { onToken, onComplete, onError, onStatus });
        } catch {}
      }

      if (code !== 0 && code !== null) {
        const errMsg = stderrBuffer.trim() || `Process exited with code ${code}`;
        onError(errMsg);
      }

      onStatus('idle');
    });

    proc.on('error', (err) => {
      this.activeProcesses.delete(sessionId);
      onError(`Failed to start claude: ${err.message}`);
      onStatus('idle');
    });
  }

  handleEvent(event, { onToken, onComplete, onError, onStatus }) {
    // streaming text token
    if (
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_delta' &&
      event.event?.delta?.type === 'text_delta'
    ) {
      onToken(event.event.delta.text);
      return;
    }

    // tool use start — show what Claude is doing
    if (
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_start' &&
      event.event?.content_block?.type === 'tool_use'
    ) {
      const name = event.event.content_block.name || 'tool';
      onStatus('tool', name);
      return;
    }

    // final result
    if (event.type === 'result') {
      onComplete({
        text: event.result || '',
        cost: event.total_cost_usd,
        duration_ms: event.duration_ms,
        isError: event.is_error || false,
      });
      return;
    }
  }

  abort(sessionId) {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }

  isRunning(sessionId) {
    return this.activeProcesses.has(sessionId);
  }
}

module.exports = ClaudeRunner;
