const PREFIX = "mxpf/v1/aria";

export const consoleTopics = {
  announce: `${PREFIX}/registry/announce`,
  status: (ariaId: string) => `${PREFIX}/${ariaId}/status`,
  webIn: (ariaId: string) => `${PREFIX}/${ariaId}/web/in`,
  webOut: (ariaId: string, msgId: string) =>
    `${PREFIX}/${ariaId}/web/out/${msgId}`,
  webTyping: (ariaId: string) => `${PREFIX}/${ariaId}/web/out/typing`,
} as const;
