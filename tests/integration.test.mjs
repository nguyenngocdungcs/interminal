import { PtyManager } from '../src/backend/pty/pty-manager.js';
import { WebServer } from '../src/backend/server/web-server.js';
import WebSocket from 'ws';

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

  let receivedOutputChunks = [];
  let connectionOpen = false;

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('WebSocket client connected successfully!');
      connectionOpen = true;
      resolve();
    });
    ws.on('error', reject);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'output') {
        receivedOutputChunks.push(msg.data);
      }
    } catch (e) {
      receivedOutputChunks.push(data.toString());
    }
  });

  // 2. Execute command via PTY manager (simulating MCP tool call)
  console.log('\n[Integration Test] Executing command via backend: echo "WS_STREAM_TEST"');
  const result = await ptyManager.executeCommand('echo "WS_STREAM_TEST"');

  console.log('MCP Execution result exitCode:', result.exitCode);
  console.log('MCP Execution result output contains expected text:', result.output.includes('WS_STREAM_TEST'));

  // Wait a moment for WS stream
  await new Promise((r) => setTimeout(r, 500));

  const totalWsText = receivedOutputChunks.join('');
  const wsReceivedText = totalWsText.includes('WS_STREAM_TEST');
  const wsHasNoWrappedNoise = !totalWsText.includes('base64 -d') && !totalWsText.includes('eval "$(');
  console.log('WebSocket stream received live chunks:', wsReceivedText);
  console.log('WebSocket stream suppressed command wrapper noise:', wsHasNoWrappedNoise);

  // 3. Test sending human keystroke from WebSocket client to PTY
  console.log('\n[Integration Test] Testing manual human input via WebSocket');
  ws.send(JSON.stringify({
    type: 'input',
    data: 'echo "INPUT_FROM_WS"\n'
  }));

  await new Promise((r) => setTimeout(r, 1000));
  const wsReceivedManualInput = receivedOutputChunks.join('').includes('INPUT_FROM_WS');
  console.log('Manual input reflected in terminal stream:', wsReceivedManualInput);

  // Cleanup
  ws.close();
  await webServer.stop();

  if (result.exitCode === 0 && wsReceivedText && wsHasNoWrappedNoise && wsReceivedManualInput) {
    console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
    process.exit(0);
  } else {
    console.error('\n❌ Integration test failed assertions.');
    process.exit(1);
  }
}

test().catch((err) => {
  console.error('Integration test failed with error:', err);
  process.exit(1);
});
