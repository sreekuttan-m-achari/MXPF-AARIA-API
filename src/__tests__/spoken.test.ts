import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySpeechPronunciations,
  buildAckLineSpeech,
  buildAckSpeech,
  buildDoneSpeech,
  buildGreetingSpeech,
  buildReplySpeech,
  cleanForSpeech,
  hasSpeakableFirstSentence,
} from "../spoken.js";

describe("cleanForSpeech", () => {
  it("strips fenced code and urls", () => {
    const out = cleanForSpeech(
      "Fix this\n```ts\nconst x = 1;\n```\nsee https://example.com/path",
    );
    assert.equal(out.includes("```"), false);
    assert.equal(out.includes("https://"), false);
    assert.match(out, /Fix this/);
  });

  it("rewrites Sree for TTS pronunciation", () => {
    assert.equal(applySpeechPronunciations("Hello, Sree."), "Hello, Shree.");
    assert.match(cleanForSpeech("Good evening, Sree."), /Shree/);
  });
});

describe("buildAckSpeech", () => {
  it("returns On it. for empty/code-only", () => {
    assert.equal(buildAckSpeech(""), "On it.");
    assert.equal(buildAckSpeech("```\nfoo\n```"), "On it.");
  });

  it("prefixes On it for tasks", () => {
    const s = buildAckSpeech("fix the nginx reverse proxy");
    assert.equal(s, "On it: fix the nginx reverse proxy");
  });

  it("prefixes Looking into for questions", () => {
    const s = buildAckSpeech("why is the widget offline?");
    assert.match(s, /^Looking into:/);
  });

  it("clips long messages", () => {
    process.env.AARIA_VOICE_MAX_CHARS = "120";
    const long = "a ".repeat(200);
    const s = buildAckSpeech(long);
    assert.ok(s.length < 140);
    assert.match(s, /^On it:/);
    delete process.env.AARIA_VOICE_MAX_CHARS;
  });
});

describe("buildDoneSpeech", () => {
  it("returns Done. for empty or code-only", () => {
    assert.equal(buildDoneSpeech(""), "Done.");
    assert.equal(buildDoneSpeech("```\ncode\n```"), "Done.");
  });

  it("speaks first sentence with Done prefix", () => {
    const s = buildDoneSpeech(
      "Updated the health check. Then I refactored the queue.",
    );
    assert.equal(
      s,
      "Done, Updated the health check. Then I refactored the queue.",
    );
  });

  it("includes multiple sentences up to max chars", () => {
    process.env.AARIA_VOICE_MAX_CHARS = "280";
    const s = buildDoneSpeech(
      "First point done. Second step complete. Third is extra detail that should be dropped if we exceed the budget by a wide margin.",
    );
    assert.match(s, /^Done, First point done\. Second step complete\./);
    assert.ok(s.length <= 280);
    delete process.env.AARIA_VOICE_MAX_CHARS;
  });

  it("skips markdown noise", () => {
    const s = buildDoneSpeech("## Title\n\n- bullet\n\nAll good on the server.");
    assert.match(s, /^Done,/);
    assert.match(s, /All good on the server/);
  });
});

describe("buildGreetingSpeech", () => {
  it("speaks greeting without Done prefix", () => {
    const s = buildGreetingSpeech(
      "Good evening, Sree. AARIA is online at the work desk.",
    );
    assert.match(s, /^Good evening/);
    assert.equal(s.includes("Done"), false);
  });

  it("returns empty for blank input", () => {
    assert.equal(buildGreetingSpeech(""), "");
    assert.equal(buildGreetingSpeech("```\nx\n```"), "");
  });
});

describe("buildAckLineSpeech / buildReplySpeech", () => {
  it("ack line is first sentence only", () => {
    const s = buildAckLineSpeech(
      "Running a quick work-desk self-check now. Self-check complete later.",
    );
    assert.equal(s, "Running a quick work-desk self-check now.");
  });

  it("reply speech respects max chars without Done", () => {
    process.env.AARIA_VOICE_MAX_CHARS = "80";
    const s = buildReplySpeech(
      "Self-check complete, Sree — systems are up, with host pressure to watch. Extra detail here.",
    );
    assert.match(s, /^Self-check complete/);
    assert.equal(s.includes("Done"), false);
    assert.ok(s.length <= 80);
    delete process.env.AARIA_VOICE_MAX_CHARS;
  });
});

describe("hasSpeakableFirstSentence", () => {
  it("detects a complete first sentence in stream", () => {
    assert.equal(hasSpeakableFirstSentence("Hello there. More"), true);
    assert.equal(hasSpeakableFirstSentence("Still typing"), false);
  });
});
