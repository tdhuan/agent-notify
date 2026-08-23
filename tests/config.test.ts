import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CONFIG, loadConfig, resolveTitle, resolveSound, enabledChannelNames,
} from "../src/config.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-notify-cfg-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("defaults: titles, desktop+herdr enabled, sound on", () => {
  assert.equal(DEFAULT_CONFIG.events.needs_attention.title, "Claude needs your attention");
  assert.equal(DEFAULT_CONFIG.events.turn_done.title, "Claude finished");
  assert.equal(DEFAULT_CONFIG.channels.desktop.enabled, true);
  assert.equal(DEFAULT_CONFIG.channels.desktop.sound, true);
  assert.equal(DEFAULT_CONFIG.channels.herdr.enabled, true);
  assert.equal(DEFAULT_CONFIG.channels.herdr.socketEnv, "HERDR_SOCKET_PATH");
});

test("loadConfig: missing file -> defaults", () => {
  assert.deepEqual(loadConfig(join(tmp, "nope.json")), DEFAULT_CONFIG);
});

test("loadConfig: invalid JSON -> defaults", () => {
  const p = join(tmp, "bad.json");
  writeFileSync(p, "{not json");
  assert.deepEqual(loadConfig(p), DEFAULT_CONFIG);
});

test("loadConfig: user file deep-merges over defaults", () => {
  const p = join(tmp, "user.json");
  writeFileSync(p, JSON.stringify({
    channels: { desktop: { sound: false } },
    events: { turn_done: { title: "Done!" } },
  }));
  const cfg = loadConfig(p);
  assert.equal(cfg.channels.desktop.sound, false);
  assert.equal(cfg.channels.desktop.enabled, true); // untouched default survives
  assert.equal(cfg.events.turn_done.title, "Done!");
  assert.equal(cfg.events.needs_attention.title, "Claude needs your attention");
});

test("resolveSound: event override wins, then channel, then true", () => {
  assert.equal(resolveSound(DEFAULT_CONFIG, "needs_attention"), true);
  const cfg = loadConfig(join(tmp, "nope.json"));
  cfg.channels.desktop.sound = false;
  assert.equal(resolveSound(cfg, "needs_attention"), false);
  cfg.events.turn_done.sound = true;
  assert.equal(resolveSound(cfg, "turn_done"), true);
});

test("resolveTitle", () => {
  assert.equal(resolveTitle(DEFAULT_CONFIG, "turn_done"), "Claude finished");
});

test("enabledChannelNames: default = every enabled channel", () => {
  assert.deepEqual(enabledChannelNames(DEFAULT_CONFIG, "needs_attention").sort(), ["desktop", "herdr"]);
});

test("enabledChannelNames: per-event filter and disabled channel both apply", () => {
  const cfg = loadConfig(join(tmp, "nope.json"));
  cfg.events.needs_attention.channels = ["desktop"];
  assert.deepEqual(enabledChannelNames(cfg, "needs_attention"), ["desktop"]);
  cfg.channels.desktop.enabled = false;
  assert.deepEqual(enabledChannelNames(cfg, "needs_attention"), []);
});

test("loadConfig never shares mutable state with DEFAULT_CONFIG (missing file)", () => {
  const cfg = loadConfig(join(tmp, "nope.json"));
  assert.notEqual(cfg, DEFAULT_CONFIG);
  cfg.channels.desktop.sound = false;
  cfg.events.needs_attention.title = "mutated";
  assert.equal(DEFAULT_CONFIG.channels.desktop.sound, true);
  assert.equal(DEFAULT_CONFIG.events.needs_attention.title, "Claude needs your attention");
});

test("loadConfig: partial user file leaves untouched subtrees unshared", () => {
  const p = join(tmp, "partial.json");
  writeFileSync(p, JSON.stringify({ channels: { desktop: { sound: false } } }));
  const cfg = loadConfig(p);
  cfg.events.turn_done.title = "mutated";
  cfg.channels.herdr.socketEnv = "mutated";
  assert.equal(DEFAULT_CONFIG.events.turn_done.title, "Claude finished");
  assert.equal(DEFAULT_CONFIG.channels.herdr.socketEnv, "HERDR_SOCKET_PATH");
});

test("loadConfig: non-object JSON (null/scalar/array) -> fresh defaults, no crash", () => {
  const p = join(tmp, "nonobj.json");
  for (const bad of ["null", "42", "\"x\"", "[1,2]"]) {
    writeFileSync(p, bad);
    const cfg = loadConfig(p);
    assert.deepEqual(cfg, DEFAULT_CONFIG);
    assert.notEqual(cfg, DEFAULT_CONFIG);
  }
});
