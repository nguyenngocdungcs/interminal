import assert from 'node:assert/strict';
import { PtyManager } from '../src/backend/pty/pty-manager.js';

async function testStateAndExclusivity() {
  const firstManager = new PtyManager();
  const secondManager = new PtyManager();
  firstManager.spawnSession('local');
  secondManager.spawnSession('local');

  const first = firstManager.startCommand('sleep 10');
  const second = secondManager.startCommand('sleep 10');

  assert.equal(first.status, 'running');
  assert.equal(first.command, 'sleep 10');
  assert.equal(first.exitCode, null);
  assert.equal(first.output, '');
  assert.equal(first.nextOffset, 0);
  assert.notEqual(first.commandId, second.commandId, 'command IDs must be globally unique');
  assert.throws(
    () => firstManager.startCommand('echo should-not-run'),
    /another command/i,
    'a PTY must reject a second foreground command',
  );
}

async function testDelayedOutputAndExitCode() {
  const manager = new PtyManager();
  manager.spawnSession('local');

  const startedAt = Date.now();
  const delayed = await manager.executeCommand(
    `node -e "setTimeout(() => console.log('late'), 500)"`,
    5000,
  );
  assert.ok(Date.now() - startedAt >= 450, 'executeCommand must wait for actual process exit');
  assert.match(delayed.output, /late/);
  assert.doesNotMatch(delayed.output, /interminal;/, 'private lifecycle markers must be removed');
  assert.equal(delayed.exitCode, 0);

  const sleepStartedAt = Date.now();
  const slept = await manager.executeCommand('node scripts/sleep.js 1', 5000);
  assert.ok(Date.now() - sleepStartedAt >= 900);
  assert.match(slept.output, /You'd slept for 1 seconds/);

  const failed = await manager.executeCommand(`node -e "process.exit(7)"`, 5000);
  assert.equal(failed.exitCode, 7, 'the real shell exit code must be returned');
}

async function pollUntil(manager, commandId, predicate, offset = 0, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let collected = '';
  let nextOffset = offset;
  while (Date.now() < deadline) {
    const snapshot = manager.pollCommand(commandId, nextOffset);
    collected += snapshot.output;
    nextOffset = snapshot.nextOffset;
    if (predicate(snapshot, collected)) {
      return { snapshot, collected, nextOffset };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out polling command ${commandId}; output: ${collected}`);
}

async function testLifecycleMarkersAcrossChunkBoundaries() {
  const manager = new PtyManager();
  manager.spawnSession('local');
  manager.write = () => {};
  const started = manager.startCommand('unused', 5000);
  const record = manager.commands.get(started.commandId);
  const startSplit = Math.floor(record.startMarker.length / 2);
  const endMarker = `${record.endPrefix}7\x07`;
  const endSplit = Math.floor(endMarker.length / 2);

  manager.consumeCommandData(record, record.startMarker.slice(0, startSplit));
  manager.consumeCommandData(record, `${record.startMarker.slice(startSplit)}chunked-output${endMarker.slice(0, endSplit)}`);
  manager.consumeCommandData(record, endMarker.slice(endSplit));

  const result = await manager.waitForCommand(started.commandId);
  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 7);
  assert.equal(result.output, 'chunked-output');
}

async function testReplacedSessionCannotAffectNewCommand() {
  const manager = new PtyManager();
  manager.spawnSession('local');
  const oldCommand = manager.startCommand('sleep 10', 5000);

  manager.spawnSession('local');
  const oldResult = await manager.waitForCommand(oldCommand.commandId);
  assert.equal(oldResult.status, 'cancelled');

  const newResult = await manager.executeCommand(
    `node -e "setTimeout(() => console.log('NEW_SESSION_OK'), 300)"`,
    5000,
  );
  assert.equal(newResult.status, 'exited');
  assert.equal(newResult.exitCode, 0);
  assert.match(newResult.output, /NEW_SESSION_OK/);
  assert.equal(manager.getStatus().isBusy, false);
  assert.notEqual(manager.getStatus().pid, -1, 'the replacement PTY must remain current');
}

async function testCompletedHistoryIsBounded() {
  const manager = new PtyManager();
  manager.spawnSession('local');
  const commandIds = [];

  for (let index = 0; index < 21; index += 1) {
    const result = await manager.executeCommand(`printf 'history-${index}'`, 5000);
    commandIds.push(result.commandId);
  }

  assert.throws(
    () => manager.pollCommand(commandIds[0]),
    /unknown or stale/i,
    'the oldest completed command must be evicted from bounded history',
  );
  assert.equal(manager.pollCommand(commandIds.at(-1)).status, 'exited');
}

async function testInteractiveLifecycle() {
  const manager = new PtyManager();
  manager.spawnSession('local');
  const started = manager.startCommand('node scripts/prompt.js', 5000);

  const namePrompt = await pollUntil(manager, started.commandId, (_snapshot, output) => output.includes('What is your name?'));
  manager.sendInput(started.commandId, 'Alice\n');
  const agePrompt = await pollUntil(manager, started.commandId, (_snapshot, output) => output.includes('How old are you?'), namePrompt.nextOffset);
  manager.sendInput(started.commandId, '30\n');
  const finished = await manager.waitForCommand(started.commandId);
  const tail = manager.pollCommand(started.commandId, agePrompt.nextOffset);

  assert.equal(finished.status, 'exited');
  assert.equal(finished.exitCode, 0);
  assert.match(tail.output, /Your name is Alice and you are 30 years old\./);
  assert.throws(() => manager.sendInput(started.commandId, 'late\n'), /not running/i);
  assert.throws(() => manager.sendInput('missing-command-id', 'x'), /unknown or stale/i);
}

async function testTimeoutAndCancel() {
  const manager = new PtyManager();
  manager.spawnSession('local');
  const timed = manager.startCommand('sleep 10', 100);
  const timedResult = await manager.waitForCommand(timed.commandId);
  assert.equal(timedResult.status, 'timed_out');
  assert.equal(timedResult.exitCode, null);
  assert.throws(() => manager.sendInput(timed.commandId, 'x'), /not running/i);

  const cancelManager = new PtyManager();
  cancelManager.spawnSession('local');
  const cancellable = cancelManager.startCommand('sleep 10', 5000);
  const cancelled = await cancelManager.cancelCommand(cancellable.commandId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.exitCode, null);
  assert.equal(cancelManager.getStatus().isBusy, false, 'cancel must wait until ownership is released');

  const stubbornManager = new PtyManager();
  stubbornManager.spawnSession('local');
  const stubborn = stubbornManager.startCommand(
    `node -e "process.on('SIGINT', () => {}); console.log('READY'); setInterval(() => {}, 1000)"`,
    5000,
  );
  await pollUntil(stubbornManager, stubborn.commandId, (_snapshot, output) => output.includes('READY'));
  const stubbornCancelled = await stubbornManager.cancelCommand(stubborn.commandId);
  assert.equal(stubbornCancelled.status, 'cancelled');
  assert.equal(stubbornManager.getStatus().isBusy, false);
  const afterCancel = await stubbornManager.executeCommand('echo AFTER_CANCEL', 5000);
  assert.match(afterCancel.output, /AFTER_CANCEL/, 'a cancelled process must no longer own the PTY');
}

await testStateAndExclusivity();
console.log('command lifecycle state and exclusivity: PASS');
await testDelayedOutputAndExitCode();
console.log('delayed output and real exit code: PASS');
await testLifecycleMarkersAcrossChunkBoundaries();
console.log('chunk-split lifecycle markers: PASS');
await testReplacedSessionCannotAffectNewCommand();
console.log('replaced-session event isolation: PASS');
await testCompletedHistoryIsBounded();
console.log('bounded completed-command history: PASS');
await testInteractiveLifecycle();
console.log('interactive polling and scoped input: PASS');
await testTimeoutAndCancel();
console.log('timeout and cancellation: PASS');
process.exit(0);
