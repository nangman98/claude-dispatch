#!/bin/bash
set -e

DISPATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(which node)"
CLAUDE_PATH="$(which claude 2>/dev/null || echo "")"
PLIST_NAME="com.claude-dispatch.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo ""
echo "  Claude Dispatch Setup"
echo "  ====================="
echo ""

# Check requirements
if [ -z "$NODE_PATH" ]; then
  echo "  ERROR: Node.js not found. Install it first: https://nodejs.org"
  exit 1
fi

if [ -z "$CLAUDE_PATH" ]; then
  echo "  ERROR: Claude Code CLI not found. Install it first:"
  echo "  https://docs.claude.com/en/docs/getting-started"
  exit 1
fi

echo "  Node.js:    $NODE_PATH"
echo "  Claude CLI: $CLAUDE_PATH"
echo ""

# Install dependencies
echo "  Installing dependencies..."
cd "$DISPATCH_DIR"
npm install --silent
echo "  Done."
echo ""

# Build PATH from current environment
PATHS="$(dirname "$NODE_PATH"):$(dirname "$CLAUDE_PATH"):/usr/local/bin:/usr/bin:/bin"

# Create LaunchAgent plist
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$DISPATCH_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$DISPATCH_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$DISPATCH_DIR/dispatch.log</string>
    <key>StandardErrorPath</key>
    <string>$DISPATCH_DIR/dispatch.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$PATHS</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST

# Unload if already loaded, then load
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

# Wait for server to start
sleep 2

# Get token
TOKEN=""
TOKEN_FILE="$HOME/.claude-dispatch-token"
if [ -f "$TOKEN_FILE" ]; then
  TOKEN=$(cat "$TOKEN_FILE")
fi

# Get IPs
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
TAILSCALE_IP=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null || tailscale ip -4 2>/dev/null || echo "")

echo "  Claude Dispatch is running!"
echo ""
echo "  Local:     http://$LOCAL_IP:3456?token=$TOKEN"
if [ -n "$TAILSCALE_IP" ]; then
  echo "  Tailscale: http://$TAILSCALE_IP:3456?token=$TOKEN"
fi
echo ""
echo "  Open the URL on your phone to get started."
echo "  The server auto-starts on login — no manual steps needed."
echo ""
echo "  Commands:"
echo "    Stop:    launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
echo "    Restart: launchctl unload ~/Library/LaunchAgents/$PLIST_NAME && launchctl load ~/Library/LaunchAgents/$PLIST_NAME"
echo "    Logs:    tail -f $DISPATCH_DIR/dispatch.log"
echo "    Remove:  bash $(basename "$0") --uninstall"
echo ""
