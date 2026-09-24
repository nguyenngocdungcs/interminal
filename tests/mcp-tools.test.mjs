import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TerminalMcpServer } from '../src/backend/mcp/server.js';
import { PtyManager } from '../src/backend/pty/pty-manager.js';

function jsonResult(result) {
  assert.equal(result.content?.[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

async function pollUntil(client, predicate, cursor = 0, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let nextCursor = cursor;
  let collected = '';
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: 'read_terminal',
      arguments: { cursor: nextCursor },
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
  throw new Error(`poll timeout; collected output:\n${collected}`);
}

const manager = new PtyManager();
manager.spawnSession('local');
const terminalServer = new TerminalMcpServer(manager);
const client = new Client({ name: 'interminal-test', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await terminalServer.server.connect(serverTransport);
await client.connect(clientTransport);

// 1. Tool listing check
const listed = await client.listTools();
const names = listed.tools.map((tool) => tool.name);
for (const expected of ['write_to_terminal', 'read_terminal', 'start_session', 'get_session_status']) {
  assert.ok(names.includes(expected), `missing MCP tool: ${expected}`);
}
assert.ok(!names.includes('execute_command'), 'legacy execute_command must be removed');
assert.ok(!names.includes('start_command'), 'legacy start_command must be removed');

// 2. Simple command execution and output reading
const initialRead = jsonResult(await client.callTool({ name: 'read_terminal', arguments: {} }));
const writeEcho = await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: 'echo "MCP_OBSERVER_ECHO"' },
});
assert.equal(writeEcho.isError, undefined);
const echoResult = await pollUntil(
  client,
  (_snapshot, text) => text.includes('MCP_OBSERVER_ECHO'),
  initialRead.cursor,
);
assert.ok(echoResult.collected.includes('MCP_OBSERVER_ECHO'));

// 3. Interactive CLI flow (prompt.js)
const beforePrompt = jsonResult(await client.callTool({ name: 'read_terminal', arguments: {} }));
await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: 'node scripts/prompt.js' },
});

const firstPrompt = await pollUntil(
  client,
  (_snapshot, text) => text.includes('What is your name?'),
  beforePrompt.cursor,
);

await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: 'Alice' },
});

const secondPrompt = await pollUntil(
  client,
  (_snapshot, text) => text.includes('How old are you?'),
  firstPrompt.nextCursor,
);

await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: '30' },
});

const finalPrompt = await pollUntil(
  client,
  (_snapshot, text) => text.includes('Your name is Alice and you are 30 years old.'),
  secondPrompt.nextCursor,
);
assert.ok(finalPrompt.collected.includes('Your name is Alice and you are 30 years old.'));

// 4. Interrupt command via Ctrl+C (\x03)
const beforeSleep = jsonResult(await client.callTool({ name: 'read_terminal', arguments: {} }));
await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: 'sleep 30' },
});
await new Promise((r) => setTimeout(r, 300));

await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: '\x03', auto_enter: false },
});
await new Promise((r) => setTimeout(r, 200));

await client.callTool({
  name: 'write_to_terminal',
  arguments: { input: 'echo "POST_INTERRUPT_SUCCESS"' },
});

const interruptResult = await pollUntil(
  client,
  (_snapshot, text) => text.includes('POST_INTERRUPT_SUCCESS'),
  beforeSleep.cursor,
);
assert.ok(interruptResult.collected.includes('POST_INTERRUPT_SUCCESS'));

await client.close();
console.log('MCP Terminal Observer Tools: PASS');
process.exit(0);
