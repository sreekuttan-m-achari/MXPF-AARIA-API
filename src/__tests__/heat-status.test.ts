import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { c, formatHeatStatusLine, heatColor } from "../tui/theme.js";

describe("heatColor", () => {
  it("clamps below 0 and above 100", () => {
    assert.equal(heatColor(-10), heatColor(0));
    assert.equal(heatColor(150), heatColor(100));
  });

  it("returns green at 0, orange at 50, red at 100", () => {
    // RGB endpoints locked in theme.ts implementation
    assert.equal(heatColor(0), "\x1b[38;2;80;200;120m");
    assert.equal(heatColor(50), "\x1b[38;2;245;166;35m");
    assert.equal(heatColor(100), "\x1b[38;2;230;70;70m");
  });

  it("interpolates midpoints", () => {
    // 25% = halfway green→orange (Math.round on each channel)
    assert.equal(heatColor(25), "\x1b[38;2;163;183;78m");
    // 75% = halfway orange→red
    assert.equal(heatColor(75), "\x1b[38;2;238;118;53m");
  });
});

describe("formatHeatStatusLine", () => {
  it("renders italic heat segments with dim separators", () => {
    const line = formatHeatStatusLine({
      ctxPct: 100,
      memPct: 77,
      userPct: 50,
    });
    assert.match(line, new RegExp(`^${escapeRegExp(c.italic)}`));
    assert.match(line, /ctx 100%/);
    assert.match(line, /mem 77%/);
    assert.match(line, /user 50%/);
    assert.ok(line.includes(`${c.dim} · ${c.reset}`));
    assert.ok(line.includes(heatColor(100)));
    assert.ok(line.includes(heatColor(77)));
    assert.ok(line.includes(heatColor(50)));
  });

  it("uses dim ctx — when ctxPct is null", () => {
    const line = formatHeatStatusLine({
      ctxPct: null,
      memPct: 10,
      userPct: 20,
    });
    assert.ok(line.includes(`${c.dim}ctx —${c.reset}`));
    assert.equal(line.includes("ctx 0%"), false);
    assert.ok(line.includes(heatColor(10)));
    assert.ok(line.includes(heatColor(20)));
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
