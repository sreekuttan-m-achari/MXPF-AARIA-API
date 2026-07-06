import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export type PasteInputOptions = {
  onPaste: (text: string) => void;
};

/**
 * Wraps a TTY stdin stream so bracketed-paste blobs are delivered whole instead
 * of being split across readline "line" events. Enables bracketed paste mode on
 * the paired output stream when it is a TTY.
 */
export function createPasteAwareInput(
  input: Readable & { isTTY?: boolean },
  output: Writable & { isTTY?: boolean },
  options: PasteInputOptions,
): Readable {
  const filtered = new PassThrough();
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
          if (rest.includes("\r\n") || (rest.includes("\n") && rest.length > 1)) {
            const normalized = rest.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            if (normalized.includes("\n")) {
              rest = "";
              options.onPaste(normalized.replace(/\n$/, ""));
              break;
            }
          }
          filtered.write(rest);
          rest = "";
          break;
        }
        if (start > 0) {
          filtered.write(rest.slice(0, start));
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

      if (text.includes("\n")) {
        options.onPaste(text);
      } else if (text.length > 0) {
        filtered.write(text);
      }
    }
  });

  input.on("end", () => filtered.end());
  input.on("error", (err) => filtered.destroy(err));

  return filtered;
}
