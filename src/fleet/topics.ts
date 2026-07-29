const PREFIX = "mxpf/v1";

export const topics = {
  announce: `${PREFIX}/registry/announce`,
  pending: (agentId: string) => `${PREFIX}/registry/pending/${agentId}`,
  approve: (agentId: string) => `${PREFIX}/registry/approve/${agentId}`,
  cmd: (agentId: string) => `${PREFIX}/agents/${agentId}/cmd`,
  status: (agentId: string) => `${PREFIX}/agents/${agentId}/status`,
  result: (agentId: string, jobId: string) =>
    `${PREFIX}/agents/${agentId}/result/${jobId}`,
  event: (agentId: string) => `${PREFIX}/agents/${agentId}/event`,
  reply: (agentId: string, msgId: string) =>
    `${PREFIX}/agents/${agentId}/reply/${msgId}`,
} as const;
