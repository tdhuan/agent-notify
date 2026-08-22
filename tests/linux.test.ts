import test from "node:test";
import assert from "node:assert/strict";
import { createLinuxChannel } from "../src/channels/linux.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Exec } from "../src/channels/exec.js";

const EV = {
  type: "turn_done" as const,
  title: "Claude finished",
  body: "Finished in agent-notify",
  sessionId: "s1",
  cwd: "/tmp",
};

test("delivers via notify-send with app name, title, body", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const exec: Exec = async (cmd, args) => { calls.push({ cmd, args }); };
  const ch = createLinuxChannel(DEFAULT_CONFIG, exec);
  assert.equal(await ch.deliver(EV), true);
  assert.equal(calls[0].cmd, "notify-send");
  assert.deepEqual(calls[0].args, ["--app-name=agent-notify", "Claude finished", "Finished in agent-notify"]);
});

test("exec failure -> false, no throw", async () => {
  const failing: Exec = async () => { throw new Error("boom"); };
  assert.equal(await createLinuxChannel(DEFAULT_CONFIG, failing).deliver(EV), false);
});
