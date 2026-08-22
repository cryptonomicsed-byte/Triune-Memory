// Standalone entrypoint: `node dist/sse-subscribe-cli.js`
// Connects to an Omo-Koda2 kernel's /v1/events and mirrors AgentBorn /
// ThoughtSealed / ActExecuted into Triune-Memory's own Seal->Walrus->Sui
// pipeline, additively. See src/sse-subscriber.ts for the real behavior
// and its documented attribution limitation.

import { defaultSubscriber } from './sse-subscriber.js';

const kernelUrl = process.env.OMOKODA_KERNEL_URL || 'http://localhost:8080';
const dataDir = process.env.MEMORY_DATA_DIR || './data';

const subscriber = defaultSubscriber(kernelUrl, dataDir);

console.log(`[triune-memory] subscribing to ${kernelUrl}/v1/events -> ${dataDir}`);

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

async function runForever() {
  for (;;) {
    try {
      await subscriber.run(controller.signal);
      if (controller.signal.aborted) break;
      console.error('[triune-memory] SSE stream ended unexpectedly, reconnecting in 3s');
    } catch (err) {
      if (controller.signal.aborted) break;
      console.error('[triune-memory] SSE subscriber error, reconnecting in 3s:', err);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('[triune-memory] subscriber stopped');
}

runForever();
