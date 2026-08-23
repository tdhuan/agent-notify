import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDispatch, withTimeout, TIMEOUT } from "../src/cli.js";
import type { Channel } from "../src/channels/base.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-notify-dispatch-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const NOTIFICATION_STDIN = JSON.stringify({
  hook_event_name: "Notification", session_id: "s1",
  cwd: "/Users/huantd/tools/agent-notify",
  message: "Claude needs your permission to use Bash",
});

function fakeChannel(name: string, behavior: "ok" | "throw" | "sleep" | "record",
                     log: string[] = []): Channel {
  return {
    name,
    async deliver(event) {
      if (behavior === "throw") throw new Error("boom");
      if (behavior === "sleep") await new Promise((r) => setTimeout(r, 3000));
      if (behavior === "record") log.push(`${name}:${event.type}:${event.title}`);
      return true;
    },
  };
}

test("withTimeout resolves value when fast, TIMEOUT sentinel when slow", async () => {
  assert.equal(await withTimeout(Promise.resolve(true), 100), true);
  assert.equal(await withTimeout(new Promise((r) => setTimeout(() => r(true), 3000)), 50), TIMEOUT);
});

test("dispatch: normalizes, fills title from config, delivers, logs ok", async () => {
  const logPath = join(tmp, "ok.jsonl");
  const seen: string[] = [];
  await runDispatch(
    ["dispatch", "--agent", "claude", "--event", "notification"],
    NOTIFICATION_STDIN,
    { channels: [fakeChannel("desktop", "record", seen)], logPath },
  );
  assert.deepEqual(seen, ["desktop:needs_attention:Claude needs your attention"]);
  const entry = JSON.parse(readFileSync(logPath, "utf8"));
  assert.equal(entry.eventType, "needs_attention");
  assert.equal(entry.agent, "claude");
  assert.deepEqual(entry.channels, { desktop: "ok" });
});

test("dispatch: isolates throwing and timing-out channels, never throws", async () => {
  const logPath = join(tmp, "mixed.jsonl");
  const seen: string[] = [];
  await runDispatch(
    ["dispatch", "--agent", "claude", "--event", "stop"],
    JSON.stringify({ hook_event_name: "Stop", session_id: "s2", cwd: "/tmp/project" }),
    { channels: [
        fakeChannel("ok", "record", seen),
        fakeChannel("bad", "throw"),
        fakeChannel("slow", "sleep"),
      ], logPath },
  );
  assert.deepEqual(seen, ["ok:turn_done:Claude finished"]);
  const entry = JSON.parse(readFileSync(logPath, "utf8"));
  assert.equal(entry.channels.ok, "ok");
  assert.equal(entry.channels.bad, "error");
  assert.equal(entry.channels.slow, "timeout");
});

test("dispatch: subagent payload skips everything, logs skipped", async () => {
  const logPath = join(tmp, "skip.jsonl");
  const seen: string[] = [];
  await runDispatch(
    ["dispatch", "--agent", "claude", "--event", "notification"],
    JSON.stringify({ ...JSON.parse(NOTIFICATION_STDIN), agent_id: "a1" }),
    { channels: [fakeChannel("desktop", "record", seen)], logPath },
  );
  assert.deepEqual(seen, []);
  const entry = JSON.parse(readFileSync(logPath, "utf8"));
  assert.equal(entry.eventType, "skipped");
});

test("dispatch: invalid stdin JSON never throws", async () => {
  const seen: string[] = [];
  await runDispatch(["dispatch", "--agent", "claude", "--event", "stop"], "{oops", {
    channels: [fakeChannel("desktop", "record", seen)], logPath: join(tmp, "bad.jsonl"),
  });
  assert.deepEqual(seen, []);
});
