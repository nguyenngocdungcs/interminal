import { TabManager } from '../src/backend/pty/tab-manager.js';
import { WebServer } from '../src/backend/server/web-server.js';
import assert from 'node:assert/strict';

async function test() {
  console.log('--- Starting Integration Test: TabManager + WebServer + WebSocket ---');
  
  const tabManager = new TabManager();

  const testPort = 3015;
  const webServer = new WebServer(tabManager, testPort);
  const serverUrl = await webServer.start();
  console.log(`WebServer running at ${serverUrl}`);

  // 1. Connect WebSocket client (simulating browser)
  const ws = new WebSocket(`ws://localhost:${testPort}/ws`);

  const receivedOutputChunks = [];
  const tabListEvents = [];

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
      if (msg.type === 'terminal_output') {
        receivedOutputChunks.push(msg.data);
      } else if (msg.type === 'tab_list') {
        tabListEvents.push(msg.tabs);
      }
    } catch (e) {
      receivedOutputChunks.push(event.data.toString());
    }
  };

  // Wait for initial tab_list
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(tabListEvents.length > 0, 'Should receive initial tab_list event');
  assert.equal(tabListEvents[0][0].id, 0);

  // 2. Execute command via PTY writeToTerminal on tab 0
  console.log('\n[Integration Test] Executing command via backend: echo "WS_STREAM_TEST"');
  const tab0Pty = tabManager.getTab(0).ptyManager;
  const initial = tab0Pty.readTerminal();
  tab0Pty.writeToTerminal('echo "WS_STREAM_TEST"');

  // Wait a moment for WS stream
  await new Promise((r) => setTimeout(r, 600));

  const readResult = tab0Pty.readTerminal({ cursor: initial.cursor });
  assert.ok(readResult.text.includes('WS_STREAM_TEST'), 'readTerminal should contain echo output');

  const totalWsText = receivedOutputChunks.join('');
  const wsReceivedText = totalWsText.includes('WS_STREAM_TEST');
  console.log('WebSocket stream received live chunks:', wsReceivedText);
  assert.ok(wsReceivedText, 'WebSocket should receive live streaming output');

  // 3. Test sending human keystroke from WebSocket client to Tab 0
  console.log('\n[Integration Test] Testing manual human input via WebSocket');
  ws.send(JSON.stringify({
    type: 'terminal_input',
    tabId: 0,
    data: 'echo "INPUT_FROM_WS"\n',
  }));

  await new Promise((r) => setTimeout(r, 800));
  const wsReceivedManualInput = receivedOutputChunks.join('').includes('INPUT_FROM_WS');
  console.log('Manual input reflected in terminal stream:', wsReceivedManualInput);
  assert.ok(wsReceivedManualInput, 'Manual input via WebSocket should be reflected in output');

  // Cleanup
  ws.close();
  await webServer.stop();
  tabManager.destroyAll();

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
  process.exit(0);
}

test().catch((err) => {
  console.error('Integration test failed with error:', err);
  process.exit(1);
});
