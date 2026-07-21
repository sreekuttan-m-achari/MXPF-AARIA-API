import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { c } from "../tui/theme.js";
import { fitCommandHint, visibleWidth } from "../tui/render.js";

describe("fitCommandHint", () => {
  it("leaves short hints unchanged", () => {
    const text = `${c.cmd}/help[/h]${c.reset}  ${c.cmd}/ops[/o]${c.reset}`;
    assert.equal(fitCommandHint(text, 80), text);
  });

  it("truncates to one row with an ellipsis", () => {
    const text = Array.from({ length: 12 }, (_, i) => `${c.cmd}/cmd${i}[/x]${c.reset}`).join(
      "  ",
    );
    const fitted = fitCommandHint(text, 40);
    assert.ok(visibleWidth(fitted) <= 40);
    assert.ok(fitted.includes("…"));
  });

  it("ignores ANSI when measuring width", () => {
    const text = `${c.cmd}${c.bold}/health[/hl]${c.reset}`;
    assert.equal(visibleWidth(text), "/health[/hl]".length);
    assert.equal(fitCommandHint(text, 80), text);
  });
});
