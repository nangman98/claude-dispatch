const { App } = require('@slack/bolt');
const ClaudeRunner = require('./claude-runner');
const path = require('node:path');
const os = require('node:os');

class SlackBot {
  constructor() {
    this.runner = new ClaudeRunner();
    // thread_ts → session_id mapping for persistent sessions
    this.threadSessions = new Map();
    this.app = null;
  }

  start() {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!botToken || !appToken) {
      console.log('  Slack bot: skipped (no SLACK_BOT_TOKEN / SLACK_APP_TOKEN)');
      return;
    }

    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
    });

    // Handle DMs
    this.app.message(async ({ message, say, client }) => {
      if (message.bot_id || message.subtype) return;
      await this.handleMessage(message, say, client);
    });

    // Handle @mentions in channels
    this.app.event('app_mention', async ({ event, say, client }) => {
      // Remove the bot mention from text
      const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      await this.handleMessage({ ...event, text }, say, client);
    });

    this.app.start().then(() => {
      console.log('  Slack bot: connected (Socket Mode)');
    }).catch((err) => {
      console.log('  Slack bot: failed -', err.message);
    });
  }

  async handleMessage(message, say, client) {
    const { text, channel, ts, thread_ts } = message;
    if (!text) return;

    const threadKey = thread_ts || ts;
    const cwd = process.env.SLACK_CWD || os.homedir();

    // Add ⏳ reaction
    try {
      await client.reactions.add({ channel, timestamp: ts, name: 'hourglass_flowing_sand' });
    } catch {}

    // Get or create session for this thread
    let sessionId = this.threadSessions.get(threadKey);
    const isFirstMessage = !sessionId;
    if (!sessionId) {
      sessionId = require('node:crypto').randomUUID();
      this.threadSessions.set(threadKey, sessionId);
    }

    // Collect response
    let fullText = '';
    let resultData = null;

    await new Promise((resolve) => {
      this.runner.run(sessionId, text, isFirstMessage, cwd, [], {}, {
        onToken(t) { fullText += t; },
        onComplete(result) {
          resultData = result;
          resolve();
        },
        onError(err) {
          resultData = { text: `Error: ${err}`, isError: true };
          resolve();
        },
        onStatus() {},
      });
    });

    // Send response in thread
    const responseText = resultData?.text || fullText || 'No response';

    // Split long messages (Slack limit: 4000 chars)
    const chunks = splitMessage(responseText, 3900);
    for (const chunk of chunks) {
      await say({ text: chunk, thread_ts: threadKey });
    }

    // Remove ⏳, add ✅ or ❌
    try {
      await client.reactions.remove({ channel, timestamp: ts, name: 'hourglass_flowing_sand' });
      await client.reactions.add({
        channel,
        timestamp: ts,
        name: resultData?.isError ? 'x' : 'white_check_mark',
      });
    } catch {}
  }

  stop() {
    if (this.app) this.app.stop();
  }
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at newline
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

module.exports = SlackBot;
