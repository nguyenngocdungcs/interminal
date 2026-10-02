import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { TabManager } from '../src/backend/pty/tab-manager.js';
import { WebServer } from '../src/backend/server/web-server.js';

const PORT = 3016;
const tabManager = new TabManager();

const webServer = new WebServer(tabManager, PORT);
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
assert.ok(toolNames.includes('tab_list'), 'Should have tab_list');
assert.ok(toolNames.includes('tab_create'), 'Should have tab_create');
assert.ok(toolNames.includes('tab_close'), 'Should have tab_close');
assert.ok(toolNames.includes('tab_rename'), 'Should have tab_rename');
assert.ok(toolNames.includes('terminal_write'), 'Should have terminal_write');
assert.ok(toolNames.includes('terminal_read'), 'Should have terminal_read');
console.log('Tool listing verified: PASS');

// 2. Call terminal_write and terminal_read on tab 0
await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: 'echo "SSE_MCP_TRANSPORT_TEST"' },
});

let found = false;
for (let i = 0; i < 20; i++) {
  const readRes = await client.callTool({
    name: 'terminal_read',
    arguments: { tabId: 0 },
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
assert.equal(tools2.tools.length, 6, 'Should list 6 tools on reconnected session');
console.log('Reconnection test: PASS');

await client2.close();
await webServer.stop();
tabManager.destroyAll();

console.log('🎉 MCP SSE Test Passed Successfully!');
process.exit(0);
