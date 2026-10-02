import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TerminalMcpServer } from '../src/backend/mcp/server.js';
import { TabManager } from '../src/backend/pty/tab-manager.js';

function jsonResult(result) {
  assert.equal(result.content?.[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

async function pollUntil(client, tabId, predicate, cursor = 0, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let nextCursor = cursor;
  let collected = '';
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: 'terminal_read',
      arguments: { tabId, cursor: nextCursor },
    });
    assert.equal(result.isError, undefined);
    const snapshot = jsonResult(result);
    if (snapshot.text.length > 0) {
      collected += (collected.length > 0 ? '\n' : '') + snapshot.text;
      nextCursor = snapshot.cursor;
    }
    if (predicate(snapshot, collected)) {
      return { snapshot, collected, nextCursor };
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`poll timeout on tabId ${tabId}; collected output:\n${collected}`);
}

const tabManager = new TabManager();
const terminalServer = new TerminalMcpServer(tabManager);
const client = new Client({ name: 'interminal-test', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await terminalServer.server.connect(serverTransport);
await client.connect(clientTransport);

// 1. Tool listing check
const listed = await client.listTools();
const names = listed.tools.map((tool) => tool.name);
for (const expected of ['tab_list', 'tab_create', 'tab_close', 'tab_rename', 'terminal_write', 'terminal_read']) {
  assert.ok(names.includes(expected), `missing MCP tool: ${expected}`);
}
for (const legacy of ['write_to_terminal', 'read_terminal', 'start_session', 'get_session_status', 'execute_command', 'start_command']) {
  assert.ok(!names.includes(legacy), `legacy tool must be removed: ${legacy}`);
}

// 2. Initial tab_list check
const tabListRes = jsonResult(await client.callTool({ name: 'tab_list', arguments: {} }));
assert.equal(tabListRes.tabs.length, 1);
assert.equal(tabListRes.tabs[0].id, 0);

// 3. Command execution on tab 0
const initialRead = jsonResult(await client.callTool({ name: 'terminal_read', arguments: { tabId: 0 } }));
const writeEcho = await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: 'echo "MCP_OBSERVER_ECHO"' },
});
assert.equal(writeEcho.isError, undefined);
const echoResult = await pollUntil(
  client,
  0,
  (_snapshot, text) => text.includes('MCP_OBSERVER_ECHO'),
  initialRead.cursor,
);
assert.ok(echoResult.collected.includes('MCP_OBSERVER_ECHO'));

// 4. Multi-tab create, rename, and independent execution
const createRes = jsonResult(await client.callTool({
  name: 'tab_create',
  arguments: { title: 'Dev Server' },
}));
assert.equal(createRes.success, true);
const tab1Id = createRes.tab.id;
assert.equal(tab1Id, 1);
assert.equal(createRes.tab.title, 'Dev Server');

// Rename tab 1
const renameRes = jsonResult(await client.callTool({
  name: 'tab_rename',
  arguments: { tabId: tab1Id, title: 'Background Job' },
}));
assert.equal(renameRes.tab.title, 'Background Job');

// Write to tab 1 independently
await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: tab1Id, input: 'echo "TAB_1_OUTPUT"' },
});
const tab1Result = await pollUntil(
  client,
  tab1Id,
  (_snapshot, text) => text.includes('TAB_1_OUTPUT'),
  0,
);
assert.ok(tab1Result.collected.includes('TAB_1_OUTPUT'));

// Close tab 1
const closeRes = jsonResult(await client.callTool({
  name: 'tab_close',
  arguments: { tabId: tab1Id },
}));
assert.equal(closeRes.success, true);

const finalTabList = jsonResult(await client.callTool({ name: 'tab_list', arguments: {} }));
assert.equal(finalTabList.tabs.length, 1);
assert.equal(finalTabList.tabs[0].id, 0);

// 5. Interactive CLI flow on tab 0 (prompt.js)
const beforePrompt = jsonResult(await client.callTool({ name: 'terminal_read', arguments: { tabId: 0 } }));
await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: 'node scripts/prompt.js' },
});

const firstPrompt = await pollUntil(
  client,
  0,
  (_snapshot, text) => text.includes('What is your name?'),
  beforePrompt.cursor,
);

await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: 'Alice' },
});

const secondPrompt = await pollUntil(
  client,
  0,
  (_snapshot, text) => text.includes('How old are you?'),
  firstPrompt.nextCursor,
);

await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: '30' },
});

const finalPrompt = await pollUntil(
  client,
  0,
  (_snapshot, text) => text.includes('Your name is Alice and you are 30 years old.'),
  secondPrompt.nextCursor,
);
assert.ok(finalPrompt.collected.includes('Your name is Alice and you are 30 years old.'));

// 6. Interrupt command via Ctrl+C (\x03)
const beforeSleep = jsonResult(await client.callTool({ name: 'terminal_read', arguments: { tabId: 0 } }));
await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: 'sleep 30' },
});
await new Promise((r) => setTimeout(r, 300));

await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: '\x03', auto_enter: false },
});
await new Promise((r) => setTimeout(r, 200));

await client.callTool({
  name: 'terminal_write',
  arguments: { tabId: 0, input: 'echo "POST_INTERRUPT_SUCCESS"' },
});

const interruptResult = await pollUntil(
  client,
  0,
  (_snapshot, text) => text.includes('POST_INTERRUPT_SUCCESS'),
  beforeSleep.cursor,
);
assert.ok(interruptResult.collected.includes('POST_INTERRUPT_SUCCESS'));

await client.close();
tabManager.destroyAll();
console.log('MCP Terminal Observer Tools: PASS');
process.exit(0);
