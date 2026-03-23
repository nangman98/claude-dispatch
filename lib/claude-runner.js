const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CMD_CACHE = path.join(os.homedir(), '.claude-dispatch-commands.json');

class ClaudeRunner {
  constructor() {
    this.activeProcesses = new Map();
    // Load cached commands from disk
    try {
      this.slashCommands = JSON.parse(fs.readFileSync(CMD_CACHE, 'utf-8'));
    } catch {
      this.slashCommands = [];
    }
  }

  run(sessionId, prompt, isFirstMessage, cwd, images, options, { onToken, onComplete, onError, onStatus }) {
    if (this.activeProcesses.has(sessionId)) {
      onError('A prompt is already running in this session');
      return;
    }

    const model = options?.model || process.env.DISPATCH_MODEL || '';

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ];

    if (model) args.push('--model', model);

    // Skip MCP servers to avoid auth hangs
    args.push('--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config');

    // Attach images
    if (images && images.length > 0) {
      images.forEach((img) => args.push('--image', img));
    }

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

    // Close stdin immediately to prevent "no stdin data" warning delay
    proc.stdin.end();

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
    // system init — cache slash commands
    if (event.type === 'system' && event.subtype === 'init' && event.slash_commands) {
      this.slashCommands = event.slash_commands;
    }

    if (event.type !== 'stream_event' && event.type !== 'result') return;

    const evt = event.event;

    // streaming text
    if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      onStatus('responding');
      onToken(evt.delta.text);
      return;
    }

    // tool use start
    if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
      onStatus('tool', evt.content_block.name || 'tool');
      return;
    }

    // thinking start
    if (evt?.type === 'content_block_start' && evt.content_block?.type === 'thinking') {
      onStatus('thinking');
      return;
    }

    // new message after tool result = Claude processing tool output
    if (evt?.type === 'message_start') {
      onStatus('thinking');
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
}

module.exports = ClaudeRunner;
