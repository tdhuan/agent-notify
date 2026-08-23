import test from "node:test";
import assert from "node:assert/strict";
import { createChannels } from "../src/channels/registry.js";
import { DEFAULT_CONFIG } from "../src/config.js";

test("darwin platform + herdr env -> desktop(darwin) and herdr", async () => {
  const chans = createChannels(DEFAULT_CONFIG,
    { HERDR_SOCKET_PATH: "/tmp/x.sock", HERDR_PANE_ID: "%1" }, "darwin");
  assert.deepEqual(chans.map((c) => c.name), ["desktop", "herdr"]);
  assert.equal(chans.length, 2);
});

test("linux platform picks linux impl, no herdr env -> desktop only", async () => {
  const chans = createChannels(DEFAULT_CONFIG, {}, "linux");
  assert.deepEqual(chans.map((c) => c.name), ["desktop"]);
});

test("desktop disabled in config -> absent even with platform set", async () => {
  const cfg = { ...DEFAULT_CONFIG, channels: { ...DEFAULT_CONFIG.channels,
    desktop: { ...DEFAULT_CONFIG.channels.desktop, enabled: false } } };
  const chans = createChannels(cfg, {}, "darwin");
  assert.deepEqual(chans, []);
});
