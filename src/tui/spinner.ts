import { stdout as output } from "node:process";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\r\x1b[2K";

/**
 * A single-line "agent is working" indicator. Redraws in place on its own line
 * and clears itself on stop so streamed output starts on a clean line. No-ops
 * when stdout is not a TTY (piped / non-interactive).
 */
export class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private frame = 0;
  private active = false;

  constructor(private readonly render: (frame: string) => string) {}

  start(): void {
    if (this.active || !output.isTTY) {
      return;
    }
    this.active = true;
    output.write(HIDE_CURSOR);
    this.tick();
    this.timer = setInterval(() => this.tick(), 90);
    this.timer.unref?.();
  }

  private tick(): void {
    const frame = FRAMES[this.frame % FRAMES.length];
    this.frame += 1;
    output.write(`${CLEAR_LINE}${this.render(frame)}`);
  }

  /** Stop animating. When `clear` is true, wipe the spinner line. */
  stop(clear = true): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    output.write(clear ? `${CLEAR_LINE}${SHOW_CURSOR}` : SHOW_CURSOR);
  }

  get running(): boolean {
    return this.active;
  }
}
