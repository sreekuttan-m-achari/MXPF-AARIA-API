import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { Health } from "../bootstrap.js";
import {
  approvePending,
  fetchHeartbeat,
  fetchJobs,
  fetchOpsHealth,
  fetchPending,
  rejectPending,
  runJob,
  type HeartbeatSnapshot,
  type JobState,
  type PendingEntry,
} from "./api.js";
import { listChatHistory, type ChatHistoryEntry } from "./history.js";
import { ringPush, sparkline } from "./sparkline.js";

type Panel = "health" | "jobs" | "memory" | "chat";

const PANELS: Panel[] = ["health", "jobs", "memory", "chat"];
const PANEL_LABEL: Record<Panel, string> = {
  health: "Health",
  jobs: "Jobs",
  memory: "Memory",
  chat: "Chat",
};

const TABS: Record<Panel, string[]> = {
  health: ["Snapshot", "History"],
  jobs: ["Overview", "Detail"],
  memory: ["Pending", "Help"],
  chat: ["Preview"],
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
  const [memSeries, setMemSeries] = useState<number[]>([]);
  const [loadSeries, setLoadSeries] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const tabs = TABS[panel];
  const tabIdxClamped = Math.min(tabIdx, tabs.length - 1);

  const listLen = useMemo(() => {
    switch (panel) {
      case "jobs":
        return Math.max(1, jobs.length);
      case "memory":
        return Math.max(1, pending.length);
      case "chat":
        return Math.max(1, chat.length);
      default:
        return 1;
    }
  }, [panel, jobs.length, pending.length, chat.length]);

  const refresh = useCallback(async () => {
    try {
      const [h, snapshot, j, p] = await Promise.all([
        fetchOpsHealth(),
        fetchHeartbeat(),
        fetchJobs(),
        fetchPending(),
      ]);
      setHealth(h);
      setHb(snapshot);
      setJobs(j);
      setPending(p);
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
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 1000);
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
    async (action: "run" | "approve" | "reject") => {
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
        } else if (panel === "memory" && action === "approve" && pending.length > 0) {
          setStatus("approving all…");
          await approvePending("all");
          setStatus("approved all");
          await refresh();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`error: ${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, panel, jobs, pending, listIdx, refresh],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "o") {
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
    if (input === "a" && panel === "memory") {
      void doAction("approve");
      return;
    }
    if (input === "x" && panel === "memory") {
      void doAction("reject");
      return;
    }
    if (key.tab) {
      const idx = PANELS.indexOf(panel);
      const delta = key.shift ? -1 : 1;
      setPanel(PANELS[(idx + delta + PANELS.length) % PANELS.length]!);
    }
  });

  const hints = useMemo(() => {
    const base = "1-4 panels · ←/→ tabs · ↑/↓ list · q exit";
    if (panel === "jobs") {
      return `${base} · r run job`;
    }
    if (panel === "memory") {
      return `${base} · a approve · x reject`;
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
        <Text dimColor>a = approve selected · x = reject selected</Text>
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
