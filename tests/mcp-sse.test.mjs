import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { PtyManager } from '../src/backend/pty/pty-manager.js';
import { WebServer } from '../src/backend/server/web-server.js';

const PORT = 3016;
const ptyManager = new PtyManager();
ptyManager.spawnSession('local');

const webServer = new WebServer(ptyManager, PORT);
const webUrl = await webServer.start();

console.log(`--- Starting MCP SSE Test on ${webUrl} ---`);

const sseUrl = new URL(`${webUrl}/sse`);
const clientTransport = new SSEClientTransport(sseUrl);
const client = new Client({ name: 'mcp-sse-test', version: '1.0.0' });

await client.connect(clientTransport);
console.log('MCP SSE Client connected successfully!');

// 1. Check tools
const toolList = await client.listTools();
const toolNames = toolList.tools.map((t) => t.name);
assert.ok(toolNames.includes('write_to_terminal'), 'Should have write_to_terminal');
assert.ok(toolNames.includes('read_terminal'), 'Should have read_terminal');
assert.ok(toolNames.includes('start_session'), 'Should have start_session');
assert.ok(toolNames.includes('get_session_status'), 'Should have get_session_status');
console.log('Tool listing verified: PASS');

// 2. Call write_to_terminal and read_terminal
await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: 'echo "SSE_MCP_TRANSPORT_TEST"' },
});

let found = false;
for (let i = 0; i < 20; i++) {
  const readRes = await client.callTool({
    name: 'read_terminal',
    arguments: {},
  });
  const data = JSON.parse(readRes.content[0].text);
  if (data.text.includes('SSE_MCP_TRANSPORT_TEST')) {
    found = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 100));
}

assert.ok(found, 'Should find echoed text from terminal via MCP SSE tool calls');
console.log('Tool call execution over SSE: PASS');

// 3. Test reconnecting (session 2) to verify no 'already initialized' errors
console.log('Testing client disconnection and re-initialization (reconnect test)...');
await client.close();

const client2 = new Client({ name: 'mcp-sse-test-2', version: '1.0.0' });
const clientTransport2 = new SSEClientTransport(sseUrl);
await client2.connect(clientTransport2);

const tools2 = await client2.listTools();
assert.equal(tools2.tools.length, 4, 'Should list 4 tools on reconnected session');
console.log('Reconnection test: PASS');

await client2.close();
await webServer.stop();
ptyManager.destroy();

console.log('🎉 MCP SSE Test Passed Successfully!');
process.exit(0);
