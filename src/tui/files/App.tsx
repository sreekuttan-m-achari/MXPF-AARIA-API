import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import path from "node:path";

import {
  displayPath,
  listEntries,
  parentDir,
  type DirEntry,
} from "./fs.js";

export type FileBrowserAppProps = {
  startDir: string;
  /** Called with absolute paths on confirm, or null on cancel. */
  onDone: (paths: string[] | null) => void;
};

const VIEWPORT = 16;

export function FileBrowserApp({ startDir, onDone }: FileBrowserAppProps): React.ReactElement {
  const { exit } = useApp();
  const [cwd, setCwd] = useState(startDir);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const finish = useCallback(
    (paths: string[] | null) => {
      onDone(paths);
      exit();
    },
    [exit, onDone],
  );

  const reload = useCallback(async (dir: string, keepHidden: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const list = await listEntries(dir, { showHidden: keepHidden });
      setEntries(list);
      setCursor(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEntries([]);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(cwd, showHidden);
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
      finish([...selected].sort((a, b) => a.localeCompare(b)));
      return;
    }
    const entry = entries[cursor];
    if (entry && !entry.isDirectory) {
      finish([entry.absolutePath]);
      return;
    }
    // Nothing useful selected — stay in picker.
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
    finish([entry.absolutePath]);
  }, [entries, cursor, selected.size, confirm, finish]);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      finish(null);
      return;
    }
    if (key.ctrl && input === "c") {
      finish(null);
      return;
    }
    if (input === ".") {
      setShowHidden((v) => !v);
      return;
    }
    if (input === "c") {
      setSelected(new Set());
      return;
    }
    if (input === "-" || key.backspace) {
      const parent = parentDir(cwd);
      if (parent) {
        setCwd(parent);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((i) => Math.min(Math.max(0, entries.length - 1), i + 1));
      return;
    }
    if (input === " ") {
      const entry = entries[cursor];
      if (entry) {
        toggleSelect(entry);
      }
      return;
    }
    // Ctrl+Enter is not portable across terminals; use 'a' to accept selection.
    if (input === "a" || (key.ctrl && key.return)) {
      confirm();
      return;
    }
    if (key.return) {
      openOrConfirm();
    }
  });

  const hasParent = parentDir(cwd) !== null;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text bold color="cyan">
          Files
        </Text>
        <Text dimColor> · share paths with AARIA</Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>cwd </Text>
        <Text color="magenta">{displayPath(cwd)}</Text>
      </Box>
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
              <Text key={entry.absolutePath} inverse={active} color={entry.isDirectory ? "cyan" : undefined}>
                {active ? "›" : " "}
                {marker} {kind}
                {label}
              </Text>
            );
          })}
          {entries.length > VIEWPORT && (
            <Text dimColor>
              {scrollOffset + 1}–{Math.min(scrollOffset + VIEWPORT, entries.length)} / {entries.length}
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          ↑↓ move · Space select · Enter open/pick · a accept · - parent · . hidden · c clear · q Esc cancel
        </Text>
        <Text>
          <Text dimColor>selected </Text>
          <Text color="yellow">{selectedList.length}</Text>
          {selectedList.length > 0 && (
            <Text dimColor>
              {" "}
              · {selectedList.slice(0, 3).map(displayPath).join(" · ")}
              {selectedList.length > 3 ? "…" : ""}
            </Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
