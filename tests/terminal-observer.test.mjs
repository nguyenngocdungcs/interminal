import assert from 'node:assert/strict';
import { PtyManager, stripAnsi } from '../src/backend/pty/pty-manager.js';

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

async function testWriteAndReadBasic() {
  console.log('[Test 1] writeToTerminal and readTerminal basic flow');
  const manager = new PtyManager();
  manager.spawnSession('local');

  // Initial read should be empty or shell prompt
  const initial = manager.readTerminal();
  assert.equal(typeof initial.cursor, 'number');
  assert.equal(typeof initial.total_lines, 'number');

  // Write command with default auto_enter = true
  manager.writeToTerminal('echo "OBSERVER_BASIC_TEST"');
  const found = await waitForOutput(manager, (text) => text.includes('OBSERVER_BASIC_TEST'), initial.cursor);
  assert.ok(found.accumulatedText.includes('echo "OBSERVER_BASIC_TEST"'), 'readTerminal must capture typed command line');
  assert.ok(found.accumulatedText.includes('OBSERVER_BASIC_TEST'));
  assert.ok(found.nextCursor >= initial.cursor);
  console.log('  -> Basic write and read: PASS');
}

async function testAnsiStrippingAndCarriageReturns() {
  console.log('[Test 2] ANSI stripping and CR progress bar overwriting');
  const manager = new PtyManager();
  
  // Test unit stripAnsi
  const rawWithAnsi = '\x1b[31mRed\x1b[0m \x1b[1;32mGreen\x1b[0m \x1b]777;osc\x07Text';
  const stripped = stripAnsi(rawWithAnsi);
  assert.equal(stripped, 'Red Green Text');

  // Test appendRawData with carriage return overwrites
  manager.appendRawData('Step 1: Downloading 10%\rStep 1: Downloading 50%\rStep 1: Downloading 100%\nDone!\n');
  const res = manager.readTerminal();
  assert.ok(!res.text.includes('Downloading 10%'), 'Overwritten CR text should be replaced');
  assert.ok(res.text.includes('Step 1: Downloading 100%'));
  assert.ok(res.text.includes('Done!'));
  console.log('  -> ANSI stripping and CR handling: PASS');
}

async function testPaginationAndHasMore() {
  console.log('[Test 3] Cursor-based pagination with 500-line cap and has_more flag');
  const manager = new PtyManager();
  manager.spawnSession('local');

  // Write a command generating 600 lines
  const initial = manager.readTerminal();
  manager.writeToTerminal('node -e "for(let i=1;i<=600;i++) console.log(\'LINE_\' + i)"');
  
  // Wait until all 600 lines have arrived
  await waitForOutput(manager, (text) => text.includes('LINE_600'), initial.cursor, 8000);

  // Read first batch with default limit (capped at 500)
  const batch1 = manager.readTerminal({ cursor: initial.cursor, limit: 500 });
  const lines1 = batch1.text.split('\n');
  assert.equal(lines1.length, 500, 'Batch 1 should have exactly 500 lines');
  assert.equal(batch1.has_more, true, 'has_more should be true when > 500 lines available');
  assert.equal(batch1.cursor, initial.cursor + 499);

  // Read next batch starting from batch1.cursor
  const batch2 = manager.readTerminal({ cursor: batch1.cursor });
  assert.ok(batch2.text.includes('LINE_600'), 'Batch 2 should contain tail lines');
  assert.equal(batch2.has_more, false, 'has_more should be false after reaching end');
  console.log('  -> Pagination and has_more: PASS');
}

async function testRollingBufferEviction() {
  console.log('[Test 4] Rolling buffer eviction up to 5,000 lines');
  const manager = new PtyManager();
  
  // Directly append 5200 lines to test buffer eviction
  for (let i = 0; i < 5200; i++) {
    manager.appendRawData(`Line ${i}\n`);
  }

  const status = manager.readTerminal({ cursor: 0 });
  assert.equal(status.total_lines, 5200);
  assert.ok(status.text.includes('Line 200'), 'Oldest lines before 200 should have been trimmed');
  assert.ok(!status.text.includes('Line 50\n'), 'Evicted line should not appear');
  console.log('  -> Rolling buffer eviction: PASS');
}

async function testControlInterrupt() {
  console.log('[Test 5] Control character interrupt (Ctrl+C / \\x03)');
  const manager = new PtyManager();
  manager.spawnSession('local');

  const initial = manager.readTerminal();
  // Start a sleep command that would run for 30s
  manager.writeToTerminal('sleep 30');
  await new Promise((r) => setTimeout(r, 400));

  // Send Ctrl+C without auto_enter
  manager.writeToTerminal('\x03', false);
  await new Promise((r) => setTimeout(r, 200));

  // Verify terminal accepts new commands immediately
  manager.writeToTerminal('echo "AFTER_INTERRUPT"');
  const found = await waitForOutput(manager, (text) => text.includes('AFTER_INTERRUPT'), initial.cursor);
  assert.ok(found.accumulatedText.includes('AFTER_INTERRUPT'));
  console.log('  -> Control interrupt: PASS');
}

async function testExactCursorIndex() {
  console.log('[Test 6] Explicit cursor indexing (cursor = 10 includes line 10)');
  const manager = new PtyManager();
  
  for (let i = 0; i < 20; i++) {
    manager.appendRawData(`Line ${i}\n`);
  }

  // Reading with cursor = 10 and limit = 1 should return exactly "Line 10"
  const res10 = manager.readTerminal({ cursor: 10, limit: 1 });
  assert.equal(res10.text, 'Line 10', 'Passing cursor = 10 must read line 10');
  assert.equal(res10.cursor, 10);
  assert.equal(res10.has_more, true);

  // Reading with cursor = 10 and limit = 3 should return "Line 10\nLine 11\nLine 12"
  const res10_3 = manager.readTerminal({ cursor: 10, limit: 3 });
  assert.equal(res10_3.text, 'Line 10\nLine 11\nLine 12');
  assert.equal(res10_3.cursor, 12);
  console.log('  -> Exact cursor indexing: PASS');
}

async function runAll() {
  console.log('--- Starting Terminal Observer Tests ---');
  await testWriteAndReadBasic();
  await testAnsiStrippingAndCarriageReturns();
  await testPaginationAndHasMore();
  await testRollingBufferEviction();
  await testControlInterrupt();
  await testExactCursorIndex();
  console.log('\n--- All Terminal Observer Tests Passed! ---');
  process.exit(0);
}

runAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
