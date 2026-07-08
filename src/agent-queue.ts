/** Serializes all agent.send() work (chat + background learn review). */
let chain: Promise<void> = Promise.resolve();
let queueDepth = 0;

export function isAgentQueueIdle(): boolean {
  return queueDepth === 0;
}

export function enqueueAgentWork<T>(fn: () => Promise<T>): Promise<T> {
  queueDepth += 1;
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {
      queueDepth -= 1;
    },
    () => {
      queueDepth -= 1;
    },
  );
  return run;
}
