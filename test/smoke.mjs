/**
 * Smoke test: start server, connect two clients, exchange messages.
 * Run: node test/smoke.mjs (after pnpm build)
 */
import { SkynetWorkspace } from '../packages/workspace/dist/index.js';
import { SkynetClient } from '../packages/sdk/dist/index.js';
import { AgentType } from '../packages/protocol/dist/index.js';
import { randomUUID } from 'node:crypto';

async function main() {
  // 1. Start server
  const server = new SkynetWorkspace({ port: 4118 });
  await server.start();
  console.log('Server started on port 4118');

  // 2. Connect client A
  const clientA = new SkynetClient({
    serverUrl: 'http://localhost:4118',
    agent: {
      agentId: randomUUID(),
      name: 'alice',
      type: AgentType.HUMAN,
      capabilities: ['chat'],
      status: 'idle',
    },
    roomId: 'test-room',
    reconnect: false,
  });

  const stateA = await clientA.connect();
  console.log(`Alice joined. Members: ${stateA.members.map((m) => m.name).join(', ')}`);

  // 3. Connect client B
  const clientB = new SkynetClient({
    serverUrl: 'http://localhost:4118',
    agent: {
      agentId: randomUUID(),
      name: 'bob',
      type: AgentType.CLAUDE_CODE,
      capabilities: ['code-edit'],
      status: 'idle',
    },
    roomId: 'test-room',
    reconnect: false,
  });

  const stateB = await clientB.connect();
  console.log(`Bob joined. Members: ${stateB.members.map((m) => m.name).join(', ')}`);

  // 4. Exchange messages
  const received = [];

  clientB.on('chat', (msg) => {
    const payload = msg.payload;
    received.push(payload.text);
    console.log(`Bob received: "${payload.text}" from ${msg.from}`);
  });

  clientA.on('chat', (msg) => {
    const payload = msg.payload;
    console.log(`Alice received: "${payload.text}" from ${msg.from}`);
  });

  // Wait a bit for event handlers to be set up
  await sleep(100);

  // Alice sends a message
  clientA.chat('Hello Bob!');
  await sleep(200);

  // Bob replies
  clientB.chat('Hi Alice, I can help with code!');
  await sleep(200);

  // 5. Verify
  if (received.length > 0 && received[0] === 'Hello Bob!') {
    console.log('\nSMOKE TEST PASSED: Messages exchanged successfully');
  } else {
    console.error('\nSMOKE TEST FAILED: Expected messages not received');
    console.error('Received:', received);
  }

  // 6. Cleanup
  await clientA.close();
  await clientB.close();
  await server.stop();
  console.log('Cleanup complete');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
