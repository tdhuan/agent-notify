import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLog, defaultLogPath } from "../src/log.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-notify-log-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("appendLog creates dirs and writes one JSON line per entry", () => {
  const p = join(tmp, "nested", "dir", "log.jsonl");
  appendLog({ ts: "2026-08-22T00:00:00Z", agent: "claude", eventType: "turn_done",
              sessionId: "s1", input: { a: 1 }, channels: { desktop: "ok" } }, p);
  appendLog({ ts: "2026-08-22T00:00:01Z", agent: "claude", eventType: "needs_attention",
              sessionId: "s1", input: { a: 2 }, channels: { herdr: "error" } }, p);
  const lines = readFileSync(p, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]).channels, { desktop: "ok" });
  assert.deepEqual(JSON.parse(lines[1]).channels, { herdr: "error" });
});

test("appendLog swallows errors (unwritable path)", () => {
  assert.doesNotThrow(() =>
    appendLog({ ts: "t", agent: "claude", eventType: "skipped",
                sessionId: "", input: null, channels: {} }, "/definitely/not/writable/log.jsonl"));
});

test("defaultLogPath is under ~/.local/state", () => {
  // Only check the shape here; don't write outside tmp.
  assert.ok(defaultLogPath().includes(join(".local", "state", "agent-notify")));
  assert.ok(!existsSync("/definitely"));
});
