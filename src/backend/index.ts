import os from 'os';
import { execFileSync } from 'child_process';
import { PtyManager } from './pty/pty-manager.js';
import { TerminalMcpServer } from './mcp/server.js';
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

  // 1. Initialize PTY Manager & spawn default local shell
  const ptyManager = new PtyManager();
  ptyManager.spawnSession('local');

  // 2. Connect MCP Stdio Server FIRST so handshake begins with zero delay
  const mcpServer = new TerminalMcpServer(ptyManager);
  await mcpServer.start();
  console.error('[Interminal] MCP Server running on stdio.');

  // 3. Start Web Server in background
  const webServer = new WebServer(ptyManager, webPort);
  webServer.start().then((webUrl) => {
    console.error(`[Interminal] Web Companion listening at ${webUrl} (WS endpoint: ${webUrl}/ws)`);
  }).catch((err) => {
    console.error('[Interminal] WebServer Error:', err);
  });
}

main().catch((err) => {
  console.error('[Interminal] Fatal Error:', err);
  process.exit(1);
});
