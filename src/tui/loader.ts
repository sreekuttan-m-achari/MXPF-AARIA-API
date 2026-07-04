import { stdout as output } from "node:process";

import { c } from "./theme.js";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LETTERS = ["A", "A", "R", "I", "A"];
const BAR_WIDTH = 17;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

/**
 * A short "coming online" boot animation for TUI startup: an AARIA wordmark with
 * a cyan→lavender scan shimmer, a sweeping reactor bar, and a spinner + phase
 * line. Animates in place and erases itself cleanly on stop. Degrades to plain
 * status lines when stdout is not a TTY.
 */
export class BootLoader {
  private timer: NodeJS.Timeout | undefined;
  private frame = 0;
  private phase = "coming online";
  private active = false;
  private lines = 0;

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    if (!output.isTTY) {
      output.write(`${c.dim}AARIA · ${this.phase}…${c.reset}\n`);
      return;
    }
    output.write(HIDE_CURSOR);
    this.render(true);
    this.timer = setInterval(() => this.render(false), 80);
    this.timer.unref?.();
  }

  setPhase(text: string): void {
    this.phase = text;
    if (this.active && !output.isTTY) {
      output.write(`${c.dim}AARIA · ${text}…${c.reset}\n`);
    }
  }

  private wordmark(): string {
    // A bright scan position sweeps across the letters, with a soft lavender halo.
    const span = LETTERS.length + 3;
    const scan = this.frame % span;
    const sep = `${c.dim} · ${c.reset}`;
    return LETTERS.map((ch, i) => {
      const dist = Math.abs(i - scan);
      if (dist === 0) return `${c.brand}${c.bold}${ch}${c.reset}`;
      if (dist === 1) return `${c.agent}${ch}${c.reset}`;
      return `${c.dim}${ch}${c.reset}`;
    }).join(sep);
  }

  private reactorBar(): string {
    const pos = this.frame % BAR_WIDTH;
    let out = "";
    for (let i = 0; i < BAR_WIDTH; i += 1) {
      const dist = Math.abs(i - pos);
      if (dist === 0) out += `${c.brand}${c.bold}━${c.reset}`;
      else if (dist === 1) out += `${c.agent}━${c.reset}`;
      else out += `${c.dim}─${c.reset}`;
    }
    return out;
  }

  private render(first: boolean): void {
    const spin = `${c.brand}${SPIN[this.frame % SPIN.length]}${c.reset}`;
    const dots = ".".repeat((this.frame % 3) + 1).padEnd(3, " ");
    const block = [
      `  ${this.wordmark()}`,
      `  ${this.reactorBar()}`,
      `  ${spin} ${c.dim}${this.phase}${dots}${c.reset}`,
    ];

    if (!first) {
      output.write(`\x1b[${this.lines}A`);
    }
    for (const line of block) {
      output.write(`\r\x1b[2K${line}\n`);
    }
    this.lines = block.length;
    this.frame += 1;
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!output.isTTY || this.lines === 0) {
      return;
    }
    // Erase the animated block and park the cursor where it started so the
    // banner renders in its place.
    output.write(`\x1b[${this.lines}A`);
    for (let i = 0; i < this.lines; i += 1) {
      output.write("\r\x1b[2K\n");
    }
    output.write(`\x1b[${this.lines}A`);
    output.write(SHOW_CURSOR);
    this.lines = 0;
  }

  get running(): boolean {
    return this.active;
  }
}
