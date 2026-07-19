import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { Health } from "../bootstrap.js";
import {
  approveFleetAgent,
  approvePending,
  fetchCursorStatus,
  fetchFleet,
  fetchHeartbeat,
  fetchJobs,
  fetchOpsHealth,
  fetchPending,
  fleetCmd,
  rejectPending,
  runJob,
  type CursorStatus,
  type FleetAgent,
  type FleetSnapshot,
  type HeartbeatSnapshot,
  type JobState,
  type PendingEntry,
} from "./api.js";
import { listChatHistory, type ChatHistoryEntry } from "./history.js";
import { ringPush, sparkline } from "./sparkline.js";

type Panel = "health" | "jobs" | "memory" | "chat" | "cursor" | "fleet";

const PANELS: Panel[] = ["health", "jobs", "memory", "chat", "cursor", "fleet"];
const PANEL_LABEL: Record<Panel, string> = {
  health: "Health",
  jobs: "Jobs",
  memory: "Memory",
  chat: "Chat",
  cursor: "Cursor",
  fleet: "Fleet",
};

const TABS: Record<Panel, string[]> = {
  health: ["Snapshot", "History"],
  jobs: ["Overview", "Detail"],
  memory: ["Pending", "Help"],
  chat: ["Preview"],
  cursor: ["Config", "Usage", "Account"],
  fleet: ["Overview", "Detail"],
};

function gauge(pct: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${pct.toFixed(1)}%`;
}

function fmtAgo(iso?: string): string {
  if (!iso) {
    return "—";
  }
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) {
    return iso;
  }
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  return `${Math.floor(m / 60)}h ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case "ok":
    case "running":
      return "green";
    case "error":
      return "red";
    case "skipped":
      return "yellow";
    default:
      return "gray";
  }
}

export type OpsAppProps = {
  onStatus?: (msg: string) => void;
};

export function OpsApp(_props: OpsAppProps): React.ReactElement {
  const { exit } = useApp();
  const [panel, setPanel] = useState<Panel>("health");
  const [tabIdx, setTabIdx] = useState(0);
  const [listIdx, setListIdx] = useState(0);
  const [status, setStatus] = useState("ready");
  const [health, setHealth] = useState<Health | null>(null);
  const [hb, setHb] = useState<HeartbeatSnapshot | null>(null);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [chat, setChat] = useState<ChatHistoryEntry[]>(() => listChatHistory());
  const [cursor, setCursor] = useState<CursorStatus | null>(null);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [memSeries, setMemSeries] = useState<number[]>([]);
  const [loadSeries, setLoadSeries] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const tabs = TABS[panel];
  const tabIdxClamped = Math.min(tabIdx, tabs.length - 1);
  const fleetAgents = fleet?.agents ?? [];

  const listLen = useMemo(() => {
    switch (panel) {
      case "jobs":
        return Math.max(1, jobs.length);
      case "memory":
        return Math.max(1, pending.length);
      case "chat":
        return Math.max(1, chat.length);
      case "fleet":
        return Math.max(1, fleetAgents.length);
      default:
        return 1;
    }
  }, [panel, jobs.length, pending.length, chat.length, fleetAgents.length]);

  const pollTick = useRef(0);

  const refresh = useCallback(async () => {
    try {
      pollTick.current += 1;
      const tick = pollTick.current;
      // Cursor/Fleet are heavier — fetch every tick on that panel, else sparsely.
      const wantCursor = panel === "cursor" || tick % 3 === 1;
      const wantFleet = panel === "fleet" || tick % 2 === 1;

      const [h, snapshot, j, p, cur, fl] = await Promise.all([
        fetchOpsHealth(),
        fetchHeartbeat(),
        fetchJobs(),
        fetchPending(),
        wantCursor ? fetchCursorStatus() : Promise.resolve(null),
        wantFleet
          ? fetchFleet().catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              setStatus(`fleet: ${msg}`);
              return null;
            })
          : Promise.resolve(undefined),
      ]);
      setHealth(h);
      setHb(snapshot);
      setJobs(j);
      setPending(p);
      if (cur) {
        setCursor(cur);
      }
      if (fl !== undefined) {
        setFleet(fl);
      }
      setChat(listChatHistory());
      if (snapshot) {
        setMemSeries((prev) => {
          const next = prev.slice();
          ringPush(next, snapshot.memory.usedPercent);
          return next;
        });
        setLoadSeries((prev) => {
          const next = prev.slice();
          ringPush(next, snapshot.load.one);
          return next;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`error: ${msg}`);
    }
  }, [panel]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    setTabIdx(0);
    setListIdx(0);
  }, [panel]);

  useEffect(() => {
    setListIdx((i) => Math.min(i, listLen - 1));
  }, [listLen]);

  const doAction = useCallback(
    async (
      action:
        | "run"
        | "approve"
        | "approve-all"
        | "reject"
        | "fleet-approve"
        | "fleet-health",
    ) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        if (action === "run" && panel === "jobs" && jobs[listIdx]) {
          const id = jobs[listIdx]!.id;
          setStatus(`running job ${id}…`);
          await runJob(id);
          setStatus(`ran ${id}`);
          await refresh();
        } else if (action === "approve-all" && panel === "memory" && pending.length > 0) {
          setStatus("approving all…");
          await approvePending("all");
          setStatus("approved all");
          await refresh();
        } else if (panel === "memory" && pending[listIdx]) {
          const id = pending[listIdx]!.id;
          if (action === "approve") {
            setStatus(`approving ${id}…`);
            await approvePending(id);
            setStatus(`approved ${id}`);
          } else if (action === "reject") {
            setStatus(`rejecting ${id}…`);
            await rejectPending(id);
            setStatus(`rejected ${id}`);
          }
          await refresh();
        } else if (panel === "fleet" && fleetAgents[listIdx]) {
          const agent = fleetAgents[listIdx]!;
          if (action === "fleet-approve") {
            setStatus(`approving ${agent.agentId}…`);
            await approveFleetAgent(agent.agentId, agent.labels, agent.caps.length ? agent.caps : ["health", "exec"]);
            setStatus(`approved ${agent.agentId}`);
            await refresh();
          } else if (action === "fleet-health") {
            setStatus(`health → ${agent.agentId}…`);
            const { jobId } = await fleetCmd(agent.agentId, "health", {});
            setStatus(`health job ${jobId.slice(0, 8)}…`);
            await refresh();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`error: ${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, panel, jobs, pending, listIdx, refresh, fleetAgents],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      exit();
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (input === "1") {
      setPanel("health");
      return;
    }
    if (input === "2") {
      setPanel("jobs");
      return;
    }
    if (input === "3") {
      setPanel("memory");
      return;
    }
    if (input === "4") {
      setPanel("chat");
      return;
    }
    if (input === "5") {
      setPanel("cursor");
      return;
    }
    if (input === "6") {
      setPanel("fleet");
      return;
    }
    if (key.leftArrow || input === "[") {
      setTabIdx((i) => (i - 1 + tabs.length) % tabs.length);
      return;
    }
    if (key.rightArrow || input === "]") {
      setTabIdx((i) => (i + 1) % tabs.length);
      return;
    }
    if (key.upArrow) {
      setListIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setListIdx((i) => Math.min(listLen - 1, i + 1));
      return;
    }
    if (input === "r" && panel === "jobs") {
      void doAction("run");
      return;
    }
    if (input === "A" && panel === "memory") {
      void doAction("approve-all");
      return;
    }
    if (input === "a" && panel === "memory") {
      void doAction("approve");
      return;
    }
    if (input === "x" && panel === "memory") {
      void doAction("reject");
      return;
    }
    if (input === "a" && panel === "fleet") {
      void doAction("fleet-approve");
      return;
    }
    if (input === "h" && panel === "fleet") {
      void doAction("fleet-health");
      return;
    }
    if (key.tab) {
      const idx = PANELS.indexOf(panel);
      const delta = key.shift ? -1 : 1;
      setPanel(PANELS[(idx + delta + PANELS.length) % PANELS.length]!);
    }
  });

  const hints = useMemo(() => {
    const base = "1-6 panels · ←/→ tabs · ↑/↓ list · q/Ctrl+C exit";
    if (panel === "jobs") {
      return `${base} · r run job`;
    }
    if (panel === "memory") {
      return `${base} · a approve · A all · x reject`;
    }
    if (panel === "fleet") {
      return `${base} · a approve · h health`;
    }
    return base;
  }, [panel]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexGrow={1}>
        <Box
          flexDirection="column"
          width={22}
          borderStyle="single"
          borderColor={panel ? "cyan" : "gray"}
          paddingX={1}
        >
          <Text bold color="cyan">
            AARIA ops
          </Text>
          {PANELS.map((p, i) => {
            const active = p === panel;
            return (
              <Text key={p} color={active ? "cyan" : undefined} bold={active}>
                {active ? "›" : " "} [{i + 1}] {PANEL_LABEL[p]}
              </Text>
            );
          })}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>status</Text>
            <Text color={health?.ok ? "green" : "yellow"}>
              {health?.ok ? "api ok" : "api ?"} · {health?.warm ? "warm" : "cold"}
            </Text>
            {fleet && (
              <Text dimColor>
                fleet {fleet.connected ? "up" : fleet.enabled ? "…" : "off"} ·{" "}
                {fleetAgents.filter((a) => a.presence === "online").length}/
                {fleetAgents.length} online
                {fleet.hub
                  ? ` · ↑${fleet.hub.messagesOut} ↓${fleet.hub.messagesIn}`
                  : ""}
              </Text>
            )}
          </Box>
        </Box>

        <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
          <Text>
            {tabs.map((t, i) => {
              const on = i === tabIdxClamped;
              return (
                <Text key={t} color={on ? "magenta" : "gray"} bold={on}>
                  {on ? "●" : "○"} {t}
                  {i < tabs.length - 1 ? "  " : ""}
                </Text>
              );
            })}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {panel === "health" && (
              <HealthView
                tab={tabs[tabIdxClamped]!}
                health={health}
                hb={hb}
                memSeries={memSeries}
                loadSeries={loadSeries}
              />
            )}
            {panel === "jobs" && (
              <JobsView tab={tabs[tabIdxClamped]!} jobs={jobs} selected={listIdx} />
            )}
            {panel === "memory" && (
              <MemoryView tab={tabs[tabIdxClamped]!} pending={pending} selected={listIdx} />
            )}
            {panel === "chat" && <ChatView chat={chat} selected={listIdx} />}
            {panel === "cursor" && (
              <CursorView tab={tabs[tabIdxClamped]!} cursor={cursor} />
            )}
            {panel === "fleet" && (
              <FleetView
                tab={tabs[tabIdxClamped]!}
                fleet={fleet}
                agents={fleetAgents}
                selected={listIdx}
              />
            )}
          </Box>
        </Box>
      </Box>

      <Box borderStyle="single" paddingX={1} justifyContent="space-between">
        <Text dimColor>{hints}</Text>
        <Text dimColor>{status}</Text>
      </Box>
    </Box>
  );
}

function presenceColor(p: string): string {
  switch (p) {
    case "online":
      return "green";
    case "idle":
      return "yellow";
    case "pending":
      return "cyan";
    default:
      return "red";
  }
}

function HubStrip(props: {
  fleet: FleetSnapshot;
}): React.ReactElement {
  const { fleet } = props;
  const hub = fleet.hub;
  if (!hub) {
    return (
      <Text dimColor>
        hub {fleet.connected ? "connected" : "down"}
      </Text>
    );
  }
  const linkColor = fleet.connected ? "green" : "yellow";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold>Hub </Text>
        <Text color="cyan">{hub.provider}</Text>
        {" · "}
        <Text color={linkColor} bold>
          {fleet.connected ? "connected" : "down"}
        </Text>
        {" · "}
        <Text dimColor>{hub.host}</Text>
      </Text>
      <Text dimColor>
        ↓{hub.messagesIn} in · ↑{hub.messagesOut} out
        {hub.lastTopic
          ? ` · last ${shortTopic(hub.lastTopic)} ${fmtAgo(hub.lastTrafficAt)}`
          : " · no traffic yet"}
        {hub.connectedSince && fleet.connected
          ? ` · up ${fmtAgo(hub.connectedSince)}`
          : ""}
      </Text>
      <Text dimColor>
        sub {hub.subscriptions.map(shortTopic).join(" · ") || "—"}
      </Text>
    </Box>
  );
}

function shortTopic(topic: string): string {
  if (topic.startsWith("mxpf/v1/")) {
    return topic.slice("mxpf/v1/".length);
  }
  return topic.length > 42 ? `${topic.slice(0, 40)}…` : topic;
}

function FleetView(props: {
  tab: string;
  fleet: FleetSnapshot | null;
  agents: FleetAgent[];
  selected: number;
}): React.ReactElement {
  const { tab, fleet, agents, selected } = props;
  if (!fleet) {
    return <Text dimColor>Fleet bridge offline or loading…</Text>;
  }
  if (!fleet.enabled) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Fleet MQTT disabled</Text>
        <Text dimColor>Set AARIA_MQTT_URL in .env to enable ASTRA minions.</Text>
      </Box>
    );
  }
  if (agents.length === 0) {
    return (
      <Box flexDirection="column">
        <HubStrip fleet={fleet} />
        <Text dimColor>Waiting for ASTRA announce on MQTT…</Text>
      </Box>
    );
  }

  const agent = agents[Math.min(selected, agents.length - 1)]!;

  if (tab === "Detail") {
    const labels = Object.entries(agent.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(" · ");
    const last = agent.lastResult;
    return (
      <Box flexDirection="column">
        <HubStrip fleet={fleet} />
        <Text bold color="cyan">
          {agent.agentId}
        </Text>
        <Text>
          presence{" "}
          <Text color={presenceColor(agent.presence)} bold>
            {agent.presence}
          </Text>
          {" · registry "}
          {agent.status}
        </Text>
        <Text dimColor>
          {agent.name ?? "—"}
          {agent.hostname ? ` · ${agent.hostname}` : ""}
        </Text>
        <Text dimColor>seen {fmtAgo(agent.lastSeenAt)} · approved {fmtAgo(agent.approvedAt)}</Text>
        {labels ? <Text dimColor>{labels}</Text> : null}
        <Text>
          <Text bold>caps </Text>
          {agent.caps.join(", ") || "—"}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Current / last task</Text>
          <Text color={agent.currentJob ? "yellow" : undefined}>{agent.task}</Text>
          {agent.currentJob && (
            <Text dimColor>
              job {agent.currentJob.jobId.slice(0, 12)}… · since{" "}
              {fmtAgo(agent.currentJob.dispatchedAt)}
            </Text>
          )}
        </Box>
        {last && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Last result</Text>
            <Text>
              {String(last.action ?? "?")} ·{" "}
              <Text color={last.ok === true ? "green" : last.ok === false ? "red" : "gray"}>
                {String(last.ok)}
              </Text>
              {typeof last.at === "string" ? ` · ${fmtAgo(last.at)}` : ""}
            </Text>
            {last.data &&
            typeof last.data === "object" &&
            "hostname" in (last.data as object) ? (
              <Text dimColor>
                host {String((last.data as { hostname?: string }).hostname)}
              </Text>
            ) : null}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            {agent.status === "pending" ? "a = approve · " : ""}
            h = health check
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <HubStrip fleet={fleet} />
      <Text dimColor>
        {agents.length} minion{agents.length === 1 ? "" : "s"}
      </Text>
      {agents.map((a, i) => {
        const on = i === selected;
        const label = (a.name?.trim() || a.agentId).padEnd(22).slice(0, 22);
        return (
          <Text key={a.agentId} inverse={on}>
            {on ? "› " : "  "}
            <Text color={presenceColor(a.presence)}>{a.presence.padEnd(8)}</Text>
            <Text bold>{label}</Text>
            <Text dimColor>{a.task.slice(0, 36)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function HealthView(props: {
  tab: string;
  health: Health | null;
  hb: HeartbeatSnapshot | null;
  memSeries: number[];
  loadSeries: number[];
}): React.ReactElement {
  const { tab, health, hb, memSeries, loadSeries } = props;
  if (tab === "History") {
    return (
      <Box flexDirection="column">
        <Text bold>Memory used</Text>
        <Text color="cyan">{sparkline(memSeries)}</Text>
        <Text dimColor>
          {memSeries.length > 0
            ? `${memSeries[memSeries.length - 1]!.toFixed(1)}% (last ${memSeries.length}s)`
            : "sampling…"}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Load (1m)</Text>
          <Text color="yellow">{sparkline(loadSeries)}</Text>
          <Text dimColor>
            {loadSeries.length > 0
              ? `${loadSeries[loadSeries.length - 1]!.toFixed(2)} (last ${loadSeries.length}s)`
              : "sampling…"}
          </Text>
        </Box>
      </Box>
    );
  }

  if (!hb) {
    return <Text dimColor>No heartbeat yet (scheduler may be idle).</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Host mem </Text>
        <Text color={hb.memory.usedPercent >= 90 ? "red" : hb.memory.usedPercent >= 80 ? "yellow" : "green"}>
          {gauge(hb.memory.usedPercent)}
        </Text>
      </Text>
      <Text dimColor>
        {hb.memory.freeMb} / {hb.memory.totalMb} MB free · uptime {Math.floor(hb.uptimeSec / 3600)}h
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>Load </Text>
          {hb.load.one.toFixed(2)} / {hb.load.five.toFixed(2)} / {hb.load.fifteen.toFixed(2)}
        </Text>
        <Text>
          <Text bold>Process </Text>
          rss {hb.process.rssMb} MB · heap {hb.process.heapUsedMb} MB
        </Text>
        <Text>
          <Text bold>Agent </Text>
          {hb.warm ? <Text color="green">warm</Text> : <Text color="yellow">cold</Text>}
          {" · "}
          {hb.ok ? <Text color="green">ok</Text> : <Text color="red">warn</Text>}
          {health?.sessionId ? ` · session ${health.sessionId.slice(0, 12)}…` : ""}
        </Text>
      </Box>
      {hb.warnings.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>
            Warnings
          </Text>
          {hb.warnings.map((w) => (
            <Text key={w} color="yellow">
              • {w}
            </Text>
          ))}
        </Box>
      )}
      {health?.mcp && (
        <Box marginTop={1}>
          <Text dimColor>
            MCP: {health.mcp.loaded ? health.mcp.servers.join(", ") || "loaded" : "off"}
            {health.memoryStats
              ? ` · mem ${health.memoryStats.entries} entries / ${health.memoryStats.chars}ch`
              : ""}
          </Text>
        </Box>
      )}
      <Text dimColor>snap {fmtAgo(hb.at)}</Text>
    </Box>
  );
}

function JobsView(props: {
  tab: string;
  jobs: JobState[];
  selected: number;
}): React.ReactElement {
  const { tab, jobs, selected } = props;
  if (jobs.length === 0) {
    return <Text dimColor>No jobs configured.</Text>;
  }
  const job = jobs[Math.min(selected, jobs.length - 1)]!;

  if (tab === "Detail") {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">
          {job.id}
        </Text>
        <Text>
          type={job.type} · enabled={String(job.enabled)} · status=
          <Text color={statusColor(job.status)}>{job.status}</Text>
        </Text>
        <Text dimColor>last run {fmtAgo(job.lastRunAt)} · next {fmtAgo(job.nextRunAt)}</Text>
        <Text dimColor>
          runs={job.runCount}
          {job.lastDurationMs != null ? ` · last ${job.lastDurationMs}ms` : ""}
        </Text>
        {job.lastError ? <Text color="red">{job.lastError}</Text> : null}
        <Box marginTop={1}>
          <Text dimColor>Press r to run this job now</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {jobs.map((j, i) => {
        const on = i === selected;
        return (
          <Text key={j.id} inverse={on}>
            {on ? "› " : "  "}
            <Text bold>{j.id.padEnd(16)}</Text>
            <Text color={statusColor(j.status)}>{j.status.padEnd(8)}</Text>
            <Text dimColor>
              {" "}
              next {fmtAgo(j.nextRunAt)}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}

function MemoryView(props: {
  tab: string;
  pending: PendingEntry[];
  selected: number;
}): React.ReactElement {
  const { tab, pending, selected } = props;
  if (tab === "Help") {
    return (
      <Box flexDirection="column">
        <Text>Pending learn entries staged when AARIA_LEARN_APPROVAL=1.</Text>
        <Text dimColor>a = approve selected · A = approve all · x = reject selected</Text>
        <Text dimColor>Chat slash cmds still work in light mode: /memory …</Text>
      </Box>
    );
  }
  if (pending.length === 0) {
    return <Text dimColor>No pending learn entries.</Text>;
  }
  return (
    <Box flexDirection="column">
      {pending.map((p, i) => {
        const on = i === selected;
        return (
          <Box key={p.id} flexDirection="column" marginBottom={1}>
            <Text inverse={on}>
              {on ? "› " : "  "}
              <Text dimColor>{p.id}</Text> <Text color="yellow">[{p.target}]</Text>
            </Text>
            <Text> {p.content.slice(0, 100)}{p.content.length > 100 ? "…" : ""}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ChatView(props: {
  chat: ChatHistoryEntry[];
  selected: number;
}): React.ReactElement {
  const { chat, selected } = props;
  if (chat.length === 0) {
    return <Text dimColor>No messages in this session yet. Chat in light mode first.</Text>;
  }
  const entry = chat[Math.min(selected, chat.length - 1)]!;
  return (
    <Box flexDirection="column">
      {chat.map((e, i) => {
        const on = i === selected;
        return (
          <Text key={e.id} inverse={on}>
            {on ? "› " : "  "}
            <Text color={e.role === "user" ? "cyan" : "magenta"}>{e.role.padEnd(9)}</Text>
            <Text>{e.preview}</Text>
          </Text>
        );
      })}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {entry.at} · {entry.role}
        </Text>
      </Box>
    </Box>
  );
}

function CursorView(props: {
  tab: string;
  cursor: CursorStatus | null;
}): React.ReactElement {
  const { tab, cursor } = props;
  if (!cursor) {
    return <Text dimColor>Loading Cursor status…</Text>;
  }

  if (tab === "Usage") {
    const u = cursor.usage;
    const t = u.tokens;
    const ctx = cursor.context;
    const memPct = ctx
      ? Math.round(
          (ctx.prompts.memoryChars / Math.max(1, ctx.prompts.memoryLimit)) * 100,
        )
      : 0;
    const userPct = ctx
      ? Math.round(
          (ctx.prompts.userLearnedChars /
            Math.max(1, ctx.prompts.userLearnedLimit)) *
            100,
        )
      : 0;
    return (
      <Box flexDirection="column">
        <Text bold>Context window</Text>
        {ctx ? (
          <Box flexDirection="column">
            <Text>
              {ctx.window.percent != null
                ? `${ctx.window.percent}% filled`
                : "no run yet"}
              {ctx.window.usedTokens != null
                ? ` · ${ctx.window.usedTokens.toLocaleString()} / ${ctx.window.limitTokens.toLocaleString()} tokens`
                : ` · limit ${ctx.window.limitTokens.toLocaleString()} tokens`}
            </Text>
            <Text dimColor>
              {gauge(ctx.window.percent ?? 0)}
              {ctx.window.model ? ` · ${ctx.window.model}` : ""}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text bold>Standing prompts</Text>
              <Text dimColor>
                soul {ctx.prompts.soulChars}ch · user {ctx.prompts.userChars}ch · fleet{" "}
                {ctx.prompts.fleetChars}ch · standing {ctx.prompts.standingChars}ch
              </Text>
              <Text>
                mem {memPct}% ({ctx.prompts.memoryChars}/{ctx.prompts.memoryLimit}) ·{" "}
                {gauge(memPct, 12)}
              </Text>
              <Text>
                user-learned {userPct}% ({ctx.prompts.userLearnedChars}/
                {ctx.prompts.userLearnedLimit}) · {gauge(userPct, 12)}
              </Text>
            </Box>
          </Box>
        ) : (
          <Text dimColor>Context status unavailable</Text>
        )}
        <Box marginTop={1} flexDirection="column">
        <Text bold>Session usage</Text>
        <Text dimColor>since {fmtAgo(u.since)} · process lifetime</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>Runs </Text>
            {u.runs.total} total ·{" "}
            <Text color="green">{u.runs.finished} ok</Text>
            {" · "}
            <Text color="red">{u.runs.error} err</Text>
            {" · "}
            <Text color="yellow">{u.runs.cancelled} cancel</Text>
          </Text>
          <Text>
            <Text bold>Tokens </Text>
            total {t.totalTokens.toLocaleString()} · in {t.inputTokens.toLocaleString()} · out{" "}
            {t.outputTokens.toLocaleString()}
          </Text>
          <Text dimColor>
            cache read {t.cacheReadTokens.toLocaleString()} · write{" "}
            {t.cacheWriteTokens.toLocaleString()}
            {t.reasoningTokens > 0 ? ` · reasoning ${t.reasoningTokens.toLocaleString()}` : ""}
          </Text>
        </Box>
        {u.lastRun && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Last run</Text>
            <Text>
              <Text color={statusColor(u.lastRun.status === "finished" ? "ok" : u.lastRun.status)}>
                {u.lastRun.status}
              </Text>
              {" · "}
              {u.lastRun.model ?? "?"}
              {u.lastRun.durationMs != null ? ` · ${u.lastRun.durationMs}ms` : ""}
            </Text>
            <Text dimColor>
              {u.lastRun.id.slice(0, 18)}… · {fmtAgo(u.lastRun.at)}
            </Text>
            {u.lastRun.usage && (
              <Text dimColor>
                tokens in {u.lastRun.usage.inputTokens} / out {u.lastRun.usage.outputTokens} / total{" "}
                {u.lastRun.usage.totalTokens}
              </Text>
            )}
          </Box>
        )}
        {u.recent.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Recent</Text>
            {u.recent.slice(0, 6).map((r) => (
              <Text key={r.id + r.at} dimColor>
                {r.status.padEnd(9)} {(r.model ?? "?").padEnd(12)}{" "}
                {r.durationMs != null ? `${r.durationMs}ms` : "—"}
              </Text>
            ))}
          </Box>
        )}
        {u.runs.total === 0 && (
          <Text dimColor>No runs yet this process — chat in light mode to accumulate usage.</Text>
        )}
        </Box>
      </Box>
    );
  }

  if (tab === "Account") {
    if (cursor.accountError && !cursor.account) {
      return (
        <Box flexDirection="column">
          <Text color="red">Account lookup failed</Text>
          <Text dimColor>{cursor.accountError}</Text>
        </Box>
      );
    }
    const a = cursor.account;
    if (!a) {
      return <Text dimColor>No account info.</Text>;
    }
    const name = [a.userFirstName, a.userLastName].filter(Boolean).join(" ");
    return (
      <Box flexDirection="column">
        <Text bold>Cursor account</Text>
        <Text>
          <Text bold>Key </Text>
          {a.apiKeyName}
        </Text>
        {name ? (
          <Text>
            <Text bold>User </Text>
            {name}
          </Text>
        ) : null}
        {a.userEmail ? (
          <Text>
            <Text bold>Email </Text>
            {a.userEmail}
          </Text>
        ) : null}
        {a.userId != null ? (
          <Text dimColor>userId {a.userId}</Text>
        ) : (
          <Text dimColor>team/service key (no userId)</Text>
        )}
        <Text dimColor>key created {fmtAgo(a.createdAt)}</Text>
      </Box>
    );
  }

  // Config
  const c = cursor.config;
  const modelIds = cursor.models?.ids ?? [];
  const modelMarked = modelIds.includes(c.model);
  return (
    <Box flexDirection="column">
      <Text bold>Cursor API config</Text>
      <Text>
        <Text bold>Model </Text>
        <Text color="cyan">{c.model}</Text>
        {c.model === "default" ? <Text dimColor> (Auto)</Text> : null}
      </Text>
      <Text>
        <Text bold>Learn </Text>
        {c.learnModel}
      </Text>
      <Text>
        <Text bold>API key </Text>
        {c.apiKeyConfigured ? (
          <Text color="green">{c.apiKeyHint}</Text>
        ) : (
          <Text color="red">unset</Text>
        )}
      </Text>
      <Text>
        <Text bold>Session </Text>
        {c.sessionId ? `${c.sessionId.slice(0, 20)}…` : "—"}
        {" · "}
        {c.warm ? <Text color="green">warm</Text> : <Text color="yellow">cold</Text>}
      </Text>
      {c.sdkVersion ? (
        <Text dimColor>@cursor/sdk {c.sdkVersion}</Text>
      ) : null}
      <Text dimColor>cwd {c.agentCwd}</Text>
      {cursor.models && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>
            Models available ({cursor.models.count})
          </Text>
          <Text dimColor>
            {modelIds.slice(0, 8).join(", ")}
            {modelIds.length > 8 ? "…" : ""}
          </Text>
          {!modelMarked && c.model !== "default" && (
            <Text color="yellow">current model not in catalog list</Text>
          )}
          <Text dimColor>Override with AARIA_MODEL / AARIA_LEARN_MODEL in .env</Text>
        </Box>
      )}
    </Box>
  );
}

