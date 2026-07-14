import { stdout as output } from "node:process";

import { Spinner } from "./spinner.js";
import { colorizeReplyChunk } from "./render.js";
import { agentPrefix, c } from "./theme.js";

/** Gap without streamed text before the working indicator reappears (tool runs, etc.). */
const IDLE_MS = 600;

/**
 * Manages the per-turn activity indicator: spinner before the first token, then
 * again whenever the agent goes quiet mid-reply (shell commands, MCP tools, …)
 * until the turn completes.
 */
export class TurnActivity {
  private spinner: Spinner;
  private idleTimer: NodeJS.Timeout | undefined;
  private ended = false;
  private opened = false;

  constructor() {
    this.spinner = new Spinner((frame) =>
      `${agentPrefix()}${c.brand}${frame}${c.reset} ${c.gold}working…${c.reset} ${c.dim}(Ctrl+C to cancel)${c.reset}`,
    );
  }

  /** Call once when the turn starts (before the first chunk). */
  begin(): void {
    output.write("\n");
    this.spinner.start();
  }

  /** Streamed assistant text — hides the indicator and reschedules idle detection. */
  onChunk(text: string): void {
    if (this.ended) {
      return;
    }
    this.clearIdle();

    if (this.spinner.running) {
      this.spinner.stop();
      if (!this.opened) {
        output.write(agentPrefix());
        this.opened = true;
      }
    }

    output.write(colorizeReplyChunk(text));
    this.opened = true;
    this.scheduleIdle();
  }

  /** Call when the turn ends (done, cancelled, error). */
  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.clearIdle();
    this.spinner.stop();
  }

  get hasContent(): boolean {
    return this.opened;
  }

  get running(): boolean {
    return !this.ended && (this.spinner.running || this.idleTimer !== undefined);
  }

  private scheduleIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.ended || !output.isTTY) {
        return;
      }
      output.write("\n");
      this.spinner.start();
    }, IDLE_MS);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}
