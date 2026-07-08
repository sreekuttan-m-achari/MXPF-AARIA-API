import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export type PasteInputOptions = {
  onPaste: (text: string) => void;
};

type TtyReadable = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => TtyReadable;
  columns?: number;
  rows?: number;
};

/** readline needs isTTY + setRawMode on its input stream for Tab completion. */
function forwardTty(input: TtyReadable, filtered: PassThrough): TtyReadable {
  const out = filtered as PassThrough & TtyReadable;
  if (!input.isTTY) {
    return out;
  }

  out.isTTY = true;
  if (input.columns !== undefined) out.columns = input.columns;
  if (input.rows !== undefined) out.rows = input.rows;

  if (typeof input.setRawMode === "function") {
    out.setRawMode = (mode: boolean) => {
      input.setRawMode!(mode);
      return out;
    };
    Object.defineProperty(out, "isRaw", {
      get: () => input.isRaw,
      configurable: true,
    });
  }

  input.on("resize", () => {
    if (input.columns !== undefined) out.columns = input.columns;
    if (input.rows !== undefined) out.rows = input.rows;
    filtered.emit("resize");
  });

  return out;
}

/**
 * Wraps a TTY stdin stream so bracketed-paste blobs are delivered whole instead
 * of being split across readline "line" events. Enables bracketed paste mode on
 * the paired output stream when it is a TTY.
 */
export function createPasteAwareInput(
  input: TtyReadable,
  output: Writable & { isTTY?: boolean },
  options: PasteInputOptions,
): TtyReadable {
  const pass = new PassThrough();
  const filtered = forwardTty(input, pass);
  let inPaste = false;
  let pasteBuf = "";

  if (output.isTTY) {
    output.write("\x1b[?2004h");
  }

  const disableBracketedPaste = (): void => {
    if (output.isTTY) {
      output.write("\x1b[?2004l");
    }
  };

  filtered.on("close", disableBracketedPaste);
  process.on("exit", disableBracketedPaste);

  input.on("data", (chunk: Buffer | string) => {
    let rest = typeof chunk === "string" ? chunk : chunk.toString("utf8");

    while (rest.length > 0) {
      if (!inPaste) {
        const start = rest.indexOf(PASTE_START);
        if (start === -1) {
          // Non-bracketed multiline paste: many terminals deliver the whole
          // clipboard in one burst that contains newline characters.
          const normalized = rest.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          const inner = normalized.replace(/\n$/, "");
          if (inner.includes("\n")) {
            rest = "";
            options.onPaste(inner);
            break;
          }
          pass.write(rest);
          rest = "";
          break;
        }
        if (start > 0) {
          pass.write(rest.slice(0, start));
        }
        rest = rest.slice(start + PASTE_START.length);
        inPaste = true;
        pasteBuf = "";
        continue;
      }

      const end = rest.indexOf(PASTE_END);
      if (end === -1) {
        pasteBuf += rest;
        rest = "";
        break;
      }

      pasteBuf += rest.slice(0, end);
      rest = rest.slice(end + PASTE_END.length);
      inPaste = false;

      const text = pasteBuf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      pasteBuf = "";

      const inner = text.replace(/\n$/, "");
      if (inner.includes("\n")) {
        options.onPaste(inner);
      } else if (text.length > 0) {
        pass.write(text.replace(/\n$/, ""));
      }
    }
  });

  input.on("end", () => pass.end());
  input.on("error", (err) => pass.destroy(err));

  return filtered;
}
