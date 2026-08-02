import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import path from "node:path";

import {
  displayPath,
  listEntries,
  parentDir,
  type DirEntry,
} from "./fs.js";

export type BrowserSession = {
  cwd: string;
  selected: string[];
  showHidden: boolean;
  cursorName?: string;
};

export type BrowserOutcome =
  | { action: "cancel" }
  | { action: "confirm"; paths: string[] }
  | { action: "edit"; path: string; session: BrowserSession };

export type FileBrowserAppProps = {
  session: BrowserSession;
  /** Optional subtitle (e.g. remote agent id). */
  subtitle?: string;
  listEntriesFn?: typeof listEntries;
  displayPathFn?: (p: string) => string;
  parentDirFn?: typeof parentDir;
  onDone: (outcome: BrowserOutcome) => void;
};

const VIEWPORT = 16;

export function FileBrowserApp({
  session,
  subtitle,
  listEntriesFn = listEntries,
  displayPathFn = displayPath,
  parentDirFn = parentDir,
  onDone,
}: FileBrowserAppProps): React.ReactElement {
  const { exit } = useApp();
  const [cwd, setCwd] = useState(session.cwd);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(session.selected),
  );
  const [showHidden, setShowHidden] = useState(session.showHidden);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const snapshot = useCallback((): BrowserSession => {
    const entry = entries[cursor];
    return {
      cwd,
      selected: [...selected],
      showHidden,
      cursorName: entry?.name,
    };
  }, [cwd, selected, showHidden, entries, cursor]);

  const finish = useCallback(
    (outcome: BrowserOutcome) => {
      onDone(outcome);
      exit();
    },
    [exit, onDone],
  );

  const reload = useCallback(
    async (dir: string, keepHidden: boolean, preferName?: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await listEntriesFn(dir, { showHidden: keepHidden });
        setEntries(list);
        if (preferName) {
          const idx = list.findIndex((e) => e.name === preferName);
          setCursor(idx >= 0 ? idx : 0);
        } else {
          setCursor(0);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setEntries([]);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [listEntriesFn],
  );

  useEffect(() => {
    void reload(cwd, showHidden, session.cursorName);
    // Only on mount / cwd / hidden — not when cursorName changes mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [cwd, showHidden, reload]);

  const selectedList = useMemo(
    () => [...selected].sort((a, b) => a.localeCompare(b)),
    [selected],
  );

  const scrollOffset = useMemo(() => {
    if (entries.length <= VIEWPORT) {
      return 0;
    }
    const mid = Math.floor(VIEWPORT / 2);
    return Math.max(0, Math.min(cursor - mid, entries.length - VIEWPORT));
  }, [cursor, entries.length]);

  const visible = entries.slice(scrollOffset, scrollOffset + VIEWPORT);

  const toggleSelect = useCallback((entry: DirEntry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.absolutePath)) {
        next.delete(entry.absolutePath);
      } else {
        next.add(entry.absolutePath);
      }
      return next;
    });
  }, []);

  const confirm = useCallback(() => {
    if (selected.size > 0) {
      finish({
        action: "confirm",
        paths: [...selected].sort((a, b) => a.localeCompare(b)),
      });
      return;
    }
    const entry = entries[cursor];
    if (entry && !entry.isDirectory) {
      finish({ action: "confirm", paths: [entry.absolutePath] });
      return;
    }
  }, [selected, entries, cursor, finish]);

  const openOrConfirm = useCallback(() => {
    const entry = entries[cursor];
    if (!entry) {
      confirm();
      return;
    }
    if (entry.isDirectory) {
      setCwd(entry.absolutePath);
      return;
    }
    if (selected.size > 0) {
      confirm();
      return;
    }
    finish({ action: "confirm", paths: [entry.absolutePath] });
  }, [entries, cursor, selected.size, confirm, finish]);

  const requestEdit = useCallback(() => {
    const entry = entries[cursor];
    if (!entry || entry.isDirectory) {
      setStatus("select a file to edit (e)");
      return;
    }
    finish({ action: "edit", path: entry.absolutePath, session: snapshot() });
  }, [entries, cursor, finish, snapshot]);

  useInput((inputKey, key) => {
    if (key.escape || inputKey === "q") {
      finish({ action: "cancel" });
      return;
    }
    if (key.ctrl && inputKey === "c") {
      finish({ action: "cancel" });
      return;
    }
    if (inputKey === ".") {
      setShowHidden((v) => !v);
      return;
    }
    if (inputKey === "c") {
      setSelected(new Set());
      setStatus(null);
      return;
    }
    if (inputKey === "e" || inputKey === "v") {
      requestEdit();
      return;
    }
    if (inputKey === "-" || key.backspace) {
      const parent = parentDirFn(cwd);
      if (parent) {
        setCwd(parent);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((i) => Math.max(0, i - 1));
      setStatus(null);
      return;
    }
    if (key.downArrow) {
      setCursor((i) => Math.min(Math.max(0, entries.length - 1), i + 1));
      setStatus(null);
      return;
    }
    if (inputKey === " ") {
      const entry = entries[cursor];
      if (entry) {
        toggleSelect(entry);
      }
      return;
    }
    if (inputKey === "a" || (key.ctrl && key.return)) {
      confirm();
      return;
    }
    if (key.return) {
      openOrConfirm();
    }
  });

  const hasParent = parentDirFn(cwd) !== null;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text bold color="cyan">
          Files
        </Text>
        <Text dimColor>
          {subtitle ? ` · ${subtitle}` : " · share paths with AARIA"}
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>cwd </Text>
        <Text color="magenta">{displayPathFn(cwd)}</Text>
      </Box>
      {status ? <Text color="yellow">{status}</Text> : null}
      {error ? (
        <Text color="red">{error}</Text>
      ) : loading ? (
        <Text dimColor>loading…</Text>
      ) : entries.length === 0 ? (
        <Text dimColor>(empty)</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {hasParent && (
            <Text dimColor>  ..  (Backspace / - parent)</Text>
          )}
          {visible.map((entry, i) => {
            const index = scrollOffset + i;
            const active = index === cursor;
            const marked = selected.has(entry.absolutePath);
            const marker = marked ? "[x]" : "[ ]";
            const kind = entry.isDirectory ? "/" : entry.isSymlink ? "@" : " ";
            const label = `${entry.name}${entry.isDirectory ? path.sep : ""}`;
            return (
              <Text
                key={entry.absolutePath}
                inverse={active}
                color={entry.isDirectory ? "cyan" : undefined}
              >
                {active ? "›" : " "}
                {marker} {kind}
                {label}
              </Text>
            );
          })}
          {entries.length > VIEWPORT && (
            <Text dimColor>
              {scrollOffset + 1}–{Math.min(scrollOffset + VIEWPORT, entries.length)} /{" "}
              {entries.length}
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          ↑↓ move · Space select · Enter open · e edit · a accept · - parent · . hidden · q cancel
        </Text>
        <Text>
          <Text dimColor>selected </Text>
          <Text color="yellow">{selectedList.length}</Text>
          {selectedList.length > 0 && (
            <Text dimColor>
              {" "}
              · {selectedList.slice(0, 3).map(displayPathFn).join(" · ")}
              {selectedList.length > 3 ? "…" : ""}
            </Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
