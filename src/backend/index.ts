import os from 'os';

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

export async function getModules() {
  const { PtyManager } = await import('./pty/pty-manager.js');
  const { TerminalMcpServer } = await import('./mcp/server.js');
  const { WebServer } = await import('./server/web-server.js');
  return { PtyManager, TerminalMcpServer, WebServer };
}

async function main() {
  const { PtyManager, TerminalMcpServer, WebServer } = await getModules();
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
