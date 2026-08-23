import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClaude } from "../src/event.js";

const NOTIFICATION = {
  hook_event_name: "Notification",
  session_id: "sess-1",
  cwd: "/Users/huantd/tools/agent-notify",
  message: "Claude needs your permission to use Bash",
};

const STOP = {
  hook_event_name: "Stop",
  session_id: "sess-2",
  cwd: "/Users/huantd/tools/agent-notify",
};

test("Notification payload -> needs_attention with message body", () => {
  const ev = normalizeClaude("notification", NOTIFICATION);
  assert.ok(ev);
  assert.equal(ev.type, "needs_attention");
  assert.equal(ev.body, "Claude needs your permission to use Bash");
  assert.equal(ev.sessionId, "sess-1");
  assert.equal(ev.cwd, "/Users/huantd/tools/agent-notify");
  assert.equal(ev.title, "");
});

test("Notification without message -> fallback body", () => {
  const ev = normalizeClaude("notification", { ...NOTIFICATION, message: undefined });
  assert.ok(ev);
  assert.equal(ev.body, "Claude needs your input");
});

test("Stop payload -> turn_done with cwd basename body", () => {
  const ev = normalizeClaude("stop", STOP);
  assert.ok(ev);
  assert.equal(ev.type, "turn_done");
  assert.equal(ev.body, "Finished in agent-notify");
});

test("subagent payload (agent_id set) -> null", () => {
  assert.equal(normalizeClaude("notification", { ...NOTIFICATION, agent_id: "a1" }), null);
  assert.equal(normalizeClaude("stop", { ...STOP, agent_id: "a1" }), null);
});

test("unknown event name -> null", () => {
  assert.equal(normalizeClaude("sessionstart", { session_id: "s" }), null);
});

test("missing optional fields -> empty strings, not undefined", () => {
  const ev = normalizeClaude("stop", {});
  assert.ok(ev);
  assert.equal(ev.sessionId, "");
  assert.equal(ev.cwd, "");
  assert.equal(ev.body, "Finished in ");
});
