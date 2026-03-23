# Claude Dispatch

Control [Claude Code](https://claude.com/claude-code) CLI from your phone with a mobile-friendly web interface.

A lightweight DIY alternative to Claude's official Dispatch feature — runs entirely on your local machine with no external dependencies.

```
[Phone Browser/PWA] ←WebSocket→ [Node.js Server on Mac/PC] ←spawn→ [claude -p --stream-json]
```

## Features

- **Real-time streaming** — see tokens appear as Claude thinks
- **Session management** — multiple conversations with full context
- **Mobile-first PWA** — add to home screen for app-like experience
- **Token auth** — secure access with auto-generated token
- **Zero config** — just `npm start` and scan the URL

## Requirements

- [Claude Code CLI](https://docs.claude.com/en/docs/getting-started) installed and authenticated
- Node.js 18+

## Quick Start

```bash
git clone https://github.com/nangman98/claude-dispatch.git
cd claude-dispatch
npm install
npm start
```

The server prints a URL with an auth token. Open it on your phone (same Wi-Fi network).

```
Claude Dispatch is running!

  Local:   http://localhost:3456?token=abc123...
  Network: http://192.168.1.42:3456?token=abc123...
```

### Add to Home Screen (PWA)

On iOS Safari: **Share → Add to Home Screen**
On Android Chrome: **Menu → Add to Home Screen**

## Remote Access

For access outside your local network, use [Tailscale](https://tailscale.com/) or similar VPN. No code changes needed — just connect via your Tailscale IP instead.

## How It Works

1. The Node.js server wraps Claude Code CLI (`claude -p`)
2. Your phone connects via WebSocket for real-time streaming
3. Claude Code's native session persistence (`--session-id` / `--resume`) maintains conversation history
4. Streaming JSON output is parsed and forwarded token-by-token to the browser

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3456` | Server port |

## Security

- Auth token is generated on first run and stored in `~/.claude-dispatch-token`
- All HTTP and WebSocket connections require the token
- Server binds to `0.0.0.0` (LAN accessible) — use a VPN for remote access
- Claude CLI runs with your user permissions

## License

MIT
