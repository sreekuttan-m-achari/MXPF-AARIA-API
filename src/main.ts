import "dotenv/config";

import { initAgent, shutdownAgent } from "./agent-manager.js";
import { cancelStaleRuns } from "./agent-busy.js";
import { agentCwd } from "./persona.js";
import { logDebugStartup } from "./debug.js";
import { startFleet, stopFleet } from "./fleet/index.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import { initTts } from "./tts.js";
import { startServer } from "./ws.js";
import { startWarmup } from "./warmup.js";

logDebugStartup();
initTts();

const agent = await initAgent();
const cleared = await cancelStaleRuns(agent.agentId, agentCwd());
if (cleared > 0) {
  console.error(`[aria-agent] Cleared ${cleared} stale run(s) from prior session`);
}
startWarmup(agent);
startScheduler(agent);
await startFleet();

try {
  await startServer(agent);
} finally {
  stopScheduler();
  await stopFleet();
  await shutdownAgent();
}
