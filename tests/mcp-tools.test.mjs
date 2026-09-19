import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TerminalMcpServer } from '../src/backend/mcp/server.js';
import { PtyManager } from '../src/backend/pty/pty-manager.js';

function jsonResult(result) {
  assert.equal(result.content?.[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

async function pollUntil(client, commandId, predicate, offset = 0, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let nextOffset = offset;
  let collected = '';
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: 'poll_command',
      arguments: { command_id: commandId, offset: nextOffset },
    });
    assert.equal(result.isError, undefined);
    const snapshot = jsonResult(result);
    collected += snapshot.output;
    nextOffset = snapshot.nextOffset;
    if (predicate(snapshot, collected)) return { snapshot, collected, nextOffset };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`poll timeout; output: ${collected}`);
}

const manager = new PtyManager();
manager.spawnSession('local');
const terminalServer = new TerminalMcpServer(manager);
const client = new Client({ name: 'interminal-test', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await terminalServer.server.connect(serverTransport);
await client.connect(clientTransport);

const listed = await client.listTools();
const names = listed.tools.map((tool) => tool.name);
for (const expected of ['execute_command', 'start_command', 'poll_command', 'send_input', 'cancel_command']) {
  assert.ok(names.includes(expected), `missing MCP tool: ${expected}`);
}

const delayedAt = Date.now();
const delayedCall = await client.callTool({
  name: 'execute_command',
  arguments: { command: `node -e "setTimeout(() => console.log('mcp-late'), 400)"`, timeout_ms: 5000 },
});
const delayed = jsonResult(delayedCall);
assert.ok(Date.now() - delayedAt >= 350);
assert.match(delayed.output, /mcp-late/);
assert.equal(delayed.status, 'exited');
assert.equal(delayed.exitCode, 0);
assert.equal(delayed.success, true);

const startedCall = await client.callTool({
  name: 'start_command',
  arguments: { command: 'node scripts/prompt.js', timeout_ms: 5000 },
});
const started = jsonResult(startedCall);
assert.equal(started.status, 'running');

const duplicate = await client.callTool({ name: 'start_command', arguments: { command: 'echo duplicate' } });
assert.equal(duplicate.isError, true);
assert.match(jsonResult(duplicate).error, /another command/i);

const firstPrompt = await pollUntil(client, started.commandId, (_snapshot, output) => output.includes('What is your name?'));
const sentName = await client.callTool({
  name: 'send_input',
  arguments: { command_id: started.commandId, input: 'Alice\n' },
});
assert.equal(jsonResult(sentName).status, 'running');
const secondPrompt = await pollUntil(client, started.commandId, (_snapshot, output) => output.includes('How old are you?'), firstPrompt.nextOffset);
await client.callTool({
  name: 'send_input',
  arguments: { command_id: started.commandId, input: '30\n' },
});
const complete = await pollUntil(client, started.commandId, (snapshot, output) => snapshot.status === 'exited' && output.includes('Your name is Alice and you are 30 years old.'), secondPrompt.nextOffset);
assert.equal(complete.snapshot.exitCode, 0);

const staleInput = await client.callTool({
  name: 'send_input',
  arguments: { command_id: started.commandId, input: 'late\n' },
});
assert.equal(staleInput.isError, true);
assert.match(jsonResult(staleInput).error, /not running/i);

const unknownPoll = await client.callTool({
  name: 'poll_command',
  arguments: { command_id: 'unknown' },
});
assert.equal(unknownPoll.isError, true);
assert.match(jsonResult(unknownPoll).error, /unknown or stale/i);

const timeoutCall = await client.callTool({
  name: 'execute_command',
  arguments: { command: 'sleep 10', timeout_ms: 100 },
});
assert.equal(timeoutCall.isError, true);
const timeout = jsonResult(timeoutCall);
assert.equal(timeout.status, 'timed_out');
assert.equal(timeout.exitCode, null);
assert.equal(timeout.success, false);

await client.close();
console.log('MCP blocking and interactive command tools: PASS');
process.exit(0);
