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
- **Remote access** — use from anywhere via Tailscale
- **Zero config** — just `npm start` and open the URL

## Requirements

- [Claude Code CLI](https://docs.claude.com/en/docs/getting-started) installed and authenticated
- Node.js 18+
- [Tailscale](https://tailscale.com/) (free) — for remote access outside your local network

## Setup

### 1. Install Claude Dispatch

```bash
git clone https://github.com/nangman98/claude-dispatch.git
cd claude-dispatch
npm install
```

### 2. Set up Tailscale (for remote access)

Skip this step if you only need access on the same Wi-Fi network.

1. **Mac**: Install [Tailscale](https://tailscale.com/download) and sign in
2. **Phone**: Install Tailscale from [App Store](https://apps.apple.com/app/tailscale/id1470499037) or [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn) — sign in with the same account
3. Confirm your Mac's Tailscale IP:
   ```bash
   # macOS (App Store version)
   /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4

   # or via CLI (brew install tailscale)
   tailscale ip -4
   ```

### 3. Start the server

```bash
npm start
```

Output:

```
Claude Dispatch is running!

  Local:   http://localhost:3456?token=abc123...
  Network: http://192.168.1.42:3456?token=abc123...
```

### 4. Open on your phone

| Access | URL to open |
|--------|-------------|
| Same Wi-Fi | `http://<local-ip>:3456?token=<token>` (Network URL from terminal) |
| Remote (Tailscale) | `http://<tailscale-ip>:3456?token=<token>` |

The auth token is saved in your phone's browser automatically after the first visit.

### 5. Add to Home Screen (PWA)

For an app-like experience without the browser address bar:

- **iPhone (Safari)**: Tap **Share** (□↑) → **Add to Home Screen**
- **Android (Chrome)**: Tap **Menu** (⋮) → **Add to Home Screen**

## Usage

### Creating a session

1. Tap **+ New** in the top bar to create a chat session
2. Type a message and tap **Send** (or press Enter)
3. Claude's response streams in real-time, token by token

### Managing sessions

- **Switch sessions**: Use the dropdown in the top bar
- **Delete a session**: Select it, then tap **Del**
- Sessions persist across reconnections (backed by Claude Code's native session storage)

### Status indicator

The dot in the top-left corner shows connection status:

| Color | Meaning |
|-------|---------|
| Red | Disconnected — will auto-reconnect |
| Green | Connected and ready |
| Blue (pulsing) | Claude is thinking |

### Tips

- **Shift+Enter** for multi-line messages
- **Abort**: if Claude is taking too long, delete the session and create a new one
- The server must be running on your Mac for the app to work
- Keep your Mac awake (disable sleep) for reliable access

## How It Works

```
Phone (PWA)                    Mac (server.js)                  Claude Code CLI
    │                              │                                │
    ├── WebSocket connect ────────►│                                │
    ├── { type: "prompt" } ──────►│── spawn claude -p ────────────►│
    │                              │◄── stream-json (token) ────────┤
    │◄── { type: "token" } ───────┤                                │
    │◄── { type: "token" } ───────┤◄── stream-json (token) ────────┤
    │◄── { type: "complete" } ────┤◄── result ─────────────────────┤
    │                              │                                │
```

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
- Server binds to `0.0.0.0` (accessible on all interfaces)
- Use Tailscale for encrypted remote access — no ports exposed to the public internet
- Claude CLI runs with your user permissions

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Red dot (disconnected) | Check if server is running on Mac (`npm start`) |
| Can't connect remotely | Ensure Tailscale is active on both devices |
| "Unauthorized" error | Token mismatch — revisit the full URL from the terminal output |
| Session not responding | Delete the session and create a new one |
| Server won't start | Check if port 3456 is in use: `lsof -i :3456` |

## License

MIT
