import test from "node:test";
import assert from "node:assert/strict";
import { createDarwinChannel, appleScriptEscape } from "../src/channels/darwin.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Exec } from "../src/channels/exec.js";

function recordingExec(calls: { cmd: string; args: string[] }[]): Exec {
  return async (cmd, args) => { calls.push({ cmd, args }); };
}

const EV = {
  type: "needs_attention" as const,
  title: "Claude needs your attention",
  body: 'Run "npm test"?',
  sessionId: "s1",
  cwd: "/tmp",
};

test("appleScriptEscape escapes backslash and double quote", () => {
  assert.equal(appleScriptEscape('a"b\\c'), 'a\\"b\\\\c');
});

test("delivers via osascript -e with title, body, and default sound on", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls));
  assert.equal(await ch.deliver(EV), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "osascript");
  assert.equal(calls[0].args[0], "-e");
  const script = calls[0].args[1];
  assert.ok(script.includes('display notification "Run \\"npm test\\"?"'));
  assert.ok(script.includes('with title "Claude needs your attention"'));
  assert.ok(script.includes('sound name "default"'), "needs_attention defaults to sound on");
});

test("sound omitted when config disables it", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const cfg = { ...DEFAULT_CONFIG, channels: { ...DEFAULT_CONFIG.channels,
    desktop: { ...DEFAULT_CONFIG.channels.desktop, sound: false } } };
  const ch = createDarwinChannel(cfg, recordingExec(calls));
  await ch.deliver(EV);
  assert.ok(!calls[0].args[1].includes("sound name"));
});

test("exec failure -> deliver returns false, no throw", async () => {
  const failing: Exec = async () => { throw new Error("boom"); };
  const ch = createDarwinChannel(DEFAULT_CONFIG, failing);
  assert.equal(await ch.deliver(EV), false);
});
