import { PtyManager } from '../src/backend/pty/pty-manager.js';
import assert from 'node:assert/strict';

async function test() {
  console.log('--- Starting PTY Manager Tests ---');
  const pty = new PtyManager();
  
  const status = pty.spawnSession('local');
  console.log('Spawned session PID:', status.pid);

  // Test 1: Simple echo
  console.log('\n[Test 1] Executing: echo "Hello Interminal"');
  const res1 = await pty.executeCommand('echo "Hello Interminal"');
  console.log('Result 1 exitCode:', res1.exitCode);
  console.log('Result 1 contains text:', res1.output.includes('Hello Interminal'));
  assert.equal(res1.exitCode, 0);
  assert.match(res1.output, /Hello Interminal/);

  // Test 2: State persistence (cd /tmp && pwd)
  console.log('\n[Test 2] State persistence (cd /tmp && pwd)');
  await pty.executeCommand('cd /tmp');
  const res2 = await pty.executeCommand('pwd');
  console.log('Result 2 pwd output:', res2.output.trim());
  const passedCd = res2.output.includes('/tmp') || res2.output.includes('/private/tmp');
  console.log('Result 2 cd persistence passed:', passedCd);
  assert.ok(passedCd, 'working directory must persist across commands');

  // Test 3: Exit code handling
  console.log('\n[Test 3] Non-zero exit code (ls /non_existing_dir_xyz_12345)');
  const res3 = await pty.executeCommand('ls /non_existing_dir_xyz_12345');
  console.log('Result 3 exitCode (expected > 0):', res3.exitCode);
  console.log('Result 3 non-zero passed:', res3.exitCode !== 0);
  assert.notEqual(res3.exitCode, 0);

  console.log('\n--- All PTY Tests Passed Successfully! ---');
  process.exit(0);
}

test().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
