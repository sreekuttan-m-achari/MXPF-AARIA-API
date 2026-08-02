import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { FleetAgent } from "../ops/api.js";

export type AgentPickerAppProps = {
  agents: FleetAgent[];
  onDone: (agentId: string | null) => void;
};

export function AgentPickerApp({
  agents,
  onDone,
}: AgentPickerAppProps): React.ReactElement {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);

  const finish = (id: string | null) => {
    onDone(id);
    exit();
  };

  useInput((input, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      finish(null);
      return;
    }
    if (key.upArrow) {
      setCursor((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((i) => Math.min(agents.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const agent = agents[cursor];
      finish(agent?.agentId ?? null);
    }
  });

  const rows = useMemo(
    () =>
      agents.map((a, i) => {
        const label = a.name ? `${a.name} (${a.agentId})` : a.agentId;
        const meta = [
          a.presence,
          a.host?.purpose,
          a.labels?.env,
        ]
          .filter(Boolean)
          .join(" · ");
        return { label, meta, active: i === cursor };
      }),
    [agents, cursor],
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Remote files
      </Text>
      <Text dimColor>pick an ASTRA minion · Enter select · q cancel</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 ? (
          <Text color="yellow">no approved online minions with exec/fs</Text>
        ) : (
          rows.map((row) => (
            <Text key={row.label} inverse={row.active}>
              {row.active ? "› " : "  "}
              {row.label}
              {row.meta ? <Text dimColor> — {row.meta}</Text> : null}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
