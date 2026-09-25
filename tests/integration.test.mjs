import { PtyManager } from '../src/backend/pty/pty-manager.js';
import { WebServer } from '../src/backend/server/web-server.js';
import assert from 'node:assert/strict';

async function test() {
  console.log('--- Starting Integration Test: PtyManager + WebServer + WebSocket ---');
  
  const ptyManager = new PtyManager();
  ptyManager.spawnSession('local');

  const testPort = 3015;
  const webServer = new WebServer(ptyManager, testPort);
  const serverUrl = await webServer.start();
  console.log(`WebServer running at ${serverUrl}`);

  // 1. Connect WebSocket client (simulating browser)
  const ws = new WebSocket(`ws://localhost:${testPort}/ws`);

  const receivedOutputChunks = [];

  await new Promise((resolve, reject) => {
    ws.onopen = () => {
      console.log('WebSocket client connected successfully!');
      resolve();
    };
    ws.onerror = reject;
  });

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data.toString());
      if (msg.type === 'output') {
        receivedOutputChunks.push(msg.data);
      }
    } catch (e) {
      receivedOutputChunks.push(event.data.toString());
    }
  };

  // 2. Execute command via PTY manager writeToTerminal
  console.log('\n[Integration Test] Executing command via backend: echo "WS_STREAM_TEST"');
  const initial = ptyManager.readTerminal();
  ptyManager.writeToTerminal('echo "WS_STREAM_TEST"');

  // Wait a moment for WS stream
  await new Promise((r) => setTimeout(r, 600));

  const readResult = ptyManager.readTerminal({ cursor: initial.cursor });
  assert.ok(readResult.text.includes('WS_STREAM_TEST'), 'readTerminal should contain echo output');

  const totalWsText = receivedOutputChunks.join('');
  const wsReceivedText = totalWsText.includes('WS_STREAM_TEST');
  console.log('WebSocket stream received live chunks:', wsReceivedText);
  assert.ok(wsReceivedText, 'WebSocket should receive live streaming output');

  // 3. Test sending human keystroke from WebSocket client to PTY
  console.log('\n[Integration Test] Testing manual human input via WebSocket');
  ws.send(JSON.stringify({
    type: 'input',
    data: 'echo "INPUT_FROM_WS"\n'
  }));

  await new Promise((r) => setTimeout(r, 800));
  const wsReceivedManualInput = receivedOutputChunks.join('').includes('INPUT_FROM_WS');
  console.log('Manual input reflected in terminal stream:', wsReceivedManualInput);
  assert.ok(wsReceivedManualInput, 'Manual input via WebSocket should be reflected in output');

  // Cleanup
  ws.close();
  await webServer.stop();

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
  process.exit(0);
}

test().catch((err) => {
  console.error('Integration test failed with error:', err);
  process.exit(1);
});
