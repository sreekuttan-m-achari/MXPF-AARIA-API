/** Serializes all agent.send() work (chat + background learn review). */
let chain: Promise<void> = Promise.resolve();

export function enqueueAgentWork<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
