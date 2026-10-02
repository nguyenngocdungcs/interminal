import os from 'os';
import { execFileSync } from 'child_process';
import { TabManager } from './pty/tab-manager.js';
import { WebServer } from './server/web-server.js';

// Hermes filters SSH_AUTH_SOCK from MCP subprocess environments.
// Fetch it from launchd (the canonical macOS source) so every child PTY
// inherits the SSH agent socket without manual ssh-add workarounds.
if (!process.env.SSH_AUTH_SOCK && process.platform === 'darwin') {
  try {
    const sock = execFileSync('launchctl', ['getenv', 'SSH_AUTH_SOCK'], { encoding: 'utf8', timeout: 2000 }).trim();
    if (sock) {
      process.env.SSH_AUTH_SOCK = sock;
    }
  } catch { /* launchctl not available or no SSH agent */ }
}

// Safeguard against ENOENT: uv_cwd if Hermes or the parent process was spawned from a deleted/invalid cwd
try {
  process.cwd();
} catch {
  try {
    process.chdir(os.homedir());
  } catch {
    // fallback if homedir is inaccessible
  }
}

async function main() {
  const webPort = parseInt(process.env.PORT || '3010', 10);

  // 1. Initialize Tab Manager
  const tabManager = new TabManager();

  // 2. Start Web Companion + MCP Server (SSE & Streamable HTTP)
  const webServer = new WebServer(tabManager, webPort);
  const webUrl = await webServer.start();

  console.log(`
┌────────────────────────────────────────────────────────┐
│  Interminal Companion Server Running                   │
│                                                        │
│  • Web UI:       ${webUrl.padEnd(37)} │
│  • WebSocket:    ${(webUrl + '/ws').padEnd(37)} │
│  • MCP SSE URL:  ${(webUrl + '/sse').padEnd(37)} │
│                                                        │
│  MCP Client Config:                                    │
│  {                                                     │
│    "interminal": {                                     │
│      "url": "${webUrl}/sse"                │
│    }                                                   │
│  }                                                     │
│                                                        │
│  Press Ctrl+C to stop the server and close sessions.   │
└────────────────────────────────────────────────────────┘
  `);

  // Graceful shutdown on Ctrl+C (SIGINT) or SIGTERM
  const shutdown = async () => {
    console.log('\n[Interminal] Shutting down cleanly...');
    await webServer.stop();
    tabManager.destroyAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}


main().catch((err) => {
  console.error('[Interminal] Fatal Error:', err);
  process.exit(1);
});
