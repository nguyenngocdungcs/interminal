import { PtyManager } from '../src/backend/pty/pty-manager.js';
import assert from 'node:assert/strict';

async function waitForOutput(manager, predicate, cursor = 0, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let currentCursor = cursor;
  let accumulatedText = '';
  while (Date.now() < deadline) {
    const result = manager.readTerminal({ cursor: currentCursor });
    if (result.text.length > 0) {
      accumulatedText += (accumulatedText.length > 0 ? '\n' : '') + result.text;
      currentCursor = result.cursor;
    }
    if (predicate(accumulatedText, result)) {
      return { result, accumulatedText, nextCursor: currentCursor };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for predicate. Accumulated text:\n${accumulatedText}`);
}

async function test() {
  console.log('--- Starting PTY Manager Tests ---');
  const pty = new PtyManager();
  
  const status = pty.spawnSession('local');
  console.log('Spawned session PID:', status.pid);
  assert.ok(status.pid > 0, 'session PID should be positive');

  // Test 1: Simple echo with writeToTerminal + readTerminal
  console.log('\n[Test 1] Executing: echo "Hello Interminal"');
  const initial = pty.readTerminal();
  pty.writeToTerminal('echo "Hello Interminal"');
  const res1 = await waitForOutput(pty, (text) => text.includes('Hello Interminal'), initial.cursor);
  console.log('Result 1 contains text:', res1.accumulatedText.includes('Hello Interminal'));
  assert.ok(res1.accumulatedText.includes('Hello Interminal'));

  // Test 2: State persistence (cd /tmp && pwd)
  console.log('\n[Test 2] State persistence (cd /tmp && pwd)');
  const beforeCd = pty.readTerminal();
  pty.writeToTerminal('cd /tmp && pwd');
  const res2 = await waitForOutput(
    pty,
    (text) => text.includes('/tmp') || text.includes('/private/tmp'),
    beforeCd.cursor,
  );
  const passedCd = res2.accumulatedText.includes('/tmp') || res2.accumulatedText.includes('/private/tmp');
  console.log('Result 2 cd persistence passed:', passedCd);
  assert.ok(passedCd, 'working directory must persist across commands');

  // Test 3: Session re-spawn
  console.log('\n[Test 3] Session re-spawn');
  const newStatus = pty.spawnSession('local');
  assert.ok(newStatus.pid > 0);
  assert.notEqual(newStatus.pid, status.pid, 'new session must have a new PID');

  console.log('\n--- All PTY Tests Passed Successfully! ---');
  process.exit(0);
}

test().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
