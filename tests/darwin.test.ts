import test from "node:test";
import assert from "node:assert/strict";
import {
  createDarwinChannel, appleScriptEscape, terminalAppName,
  buildTerminalNotifierArgs, buildOsc99, escapeRegex,
} from "../src/channels/darwin.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Exec } from "../src/channels/exec.js";
import type { Event } from "../src/event.js";

function recordingExec(calls: { cmd: string; args: string[] }[], failFor: string[] = []): Exec {
  return async (cmd, args) => {
    if (failFor.includes(cmd)) throw new Error(`not available: ${cmd}`);
    calls.push({ cmd, args });
  };
}

const EV: Event = {
  type: "needs_attention",
  title: "Claude needs your attention",
  body: 'Run "npm test"?',
  sessionId: "s1",
  cwd: "/tmp",
};

// ---- pure helpers ---------------------------------------------------------

test("appleScriptEscape escapes backslash and double quote", () => {
  assert.equal(appleScriptEscape('a"b\\c'), 'a\\"b\\\\c');
});

test("appleScriptEscape replaces CR/LF with a space", () => {
  assert.equal(appleScriptEscape("line1\nline2\rnext"), "line1 line2 next");
});

test("terminalAppName maps kitty markers to kitty", () => {
  assert.equal(terminalAppName({ KITTY_WINDOW_ID: "1" }), "kitty");
  assert.equal(terminalAppName({ KITTY_PID: "703" }), "kitty");
  assert.equal(terminalAppName({ TERM: "xterm-kitty" }), "kitty");
  assert.equal(terminalAppName({ TERM_PROGRAM: "kitty" }), "kitty");
});

test("terminalAppName maps TERM_PROGRAM values to app names", () => {
  assert.equal(terminalAppName({ TERM_PROGRAM: "iTerm.app" }), "iTerm");
  assert.equal(terminalAppName({ TERM_PROGRAM: "Apple_Terminal" }), "Terminal");
  assert.equal(terminalAppName({ TERM_PROGRAM: "ghostty" }), "Ghostty");
});

test("terminalAppName returns undefined for unknown terminals", () => {
  assert.equal(terminalAppName({ TERM: "xterm-256color" }), undefined);
  assert.equal(terminalAppName({}), undefined);
});

test("buildTerminalNotifierArgs: pane + terminal app -> click focuses exact pane", () => {
  const args = buildTerminalNotifierArgs(EV, { sound: true, paneId: "w8:pM", terminalApp: "kitty" });
  assert.deepEqual(args, [
    "-title", "Claude needs your attention",
    "-message", 'Run "npm test"?',
    "-sound", "default",
    "-execute", "open -a kitty; herdr agent focus 'w8:pM'",
  ]);
});

test("buildTerminalNotifierArgs: pane without terminal app -> focus command only", () => {
  const args = buildTerminalNotifierArgs(EV, { sound: false, paneId: "w8:pM" });
  assert.deepEqual(args, [
    "-title", "Claude needs your attention",
    "-message", 'Run "npm test"?',
    "-execute", "herdr agent focus 'w8:pM'",
  ]);
});

test("buildTerminalNotifierArgs: no pane id -> no -execute flag at all", () => {
  const args = buildTerminalNotifierArgs(EV, { sound: true });
  assert.deepEqual(args, ["-title", EV.title, "-message", EV.body, "-sound", "default"]);
});

test("buildTerminalNotifierArgs: sound off -> no -sound flag", () => {
  const args = buildTerminalNotifierArgs(EV, { sound: false, paneId: "w8:pM", terminalApp: "kitty" });
  assert.ok(!args.includes("-sound"));
});

test("buildOsc99 emits title and body payloads with control chars stripped", () => {
  const seq = buildOsc99({ ...EV, body: "line1\nline2" });
  assert.ok(seq.includes("\x1b]99;i=1:d=0;Claude needs your attention\x1b\\"));
  assert.ok(seq.includes("\x1b]99;i=1:d=1;line1 line2\x1b\\"));
  assert.ok(!/[\n\r]/.test(seq), "sequence must contain no raw line breaks");
});

const SOCK = "unix:/tmp/kitty-remote.sock";

test("escapeRegex escapes regex specials", () => {
  assert.equal(escapeRegex("a.b*(c)"), "a\\.b\\*\\(c\\)");
});

test("full chain: exact kitty window, tab title snapshot, pane focus", () => {
  const args = buildTerminalNotifierArgs(EV, {
    sound: true, paneId: "w8:pM", terminalApp: "kitty",
    kittySocket: SOCK, windowId: "1", tabTitle: "◑ Add agent-notify git remote",
  });
  const cmd = args[args.indexOf("-execute") + 1];
  assert.equal(cmd,
    `kitty @ --to ${SOCK} focus-window --match id:1 || open -a kitty; ` +
    `kitty @ --to ${SOCK} focus-tab --match window_id:1 --match title:^◑ Add agent-notify git remote$; ` +
    `herdr agent focus 'w8:pM'`);
});

test("tab title with regex specials is escaped in the match", () => {
  const args = buildTerminalNotifierArgs(EV, {
    sound: false, paneId: "w8:pM",
    kittySocket: SOCK, windowId: "2", tabTitle: "task (v2) [wip]",
  });
  const cmd = args[args.indexOf("-execute") + 1];
  assert.ok(cmd.includes("title:^task \\(v2\\) \\[wip\\]$"));
});

test("no tabTitle -> window + pane steps only", () => {
  const args = buildTerminalNotifierArgs(EV, {
    sound: false, paneId: "w8:pM", terminalApp: "kitty",
    kittySocket: SOCK, windowId: "1",
  });
  const cmd = args[args.indexOf("-execute") + 1];
  assert.equal(cmd,
    `kitty @ --to ${SOCK} focus-window --match id:1 || open -a kitty; ` +
    `herdr agent focus 'w8:pM'`);
});

test("kittySocket disabled -> legacy open -a chain", () => {
  const args = buildTerminalNotifierArgs(EV, {
    sound: false, paneId: "w8:pM", terminalApp: "kitty",
    kittySocket: "", windowId: "1", tabTitle: "t",
  });
  const cmd = args[args.indexOf("-execute") + 1];
  assert.equal(cmd, "open -a kitty; herdr agent focus 'w8:pM'");
});

test("no terminalApp -> socket chain without open fallback", () => {
  const args = buildTerminalNotifierArgs(EV, {
    sound: false, paneId: "w8:pM", kittySocket: SOCK, windowId: "1",
  });
  const cmd = args[args.indexOf("-execute") + 1];
  assert.ok(cmd.includes("focus-window --match id:1;"), "no fallback segment");
  assert.ok(!cmd.includes("open -a"));
});

// ---- tier selection in deliver --------------------------------------------

test("tier 1: terminal-notifier available -> used with click action, osascript untouched", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls),
    { HERDR_PANE_ID: "w8:pM", KITTY_WINDOW_ID: "1" }, undefined, async () => undefined);
  assert.equal(await ch.deliver(EV), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "terminal-notifier");
  assert.equal(calls[0].args[calls[0].args.indexOf("-execute") + 1],
    `kitty @ --to ${SOCK} focus-window --match id:1 || open -a kitty; ` +
    `herdr agent focus 'w8:pM'`);
});

test("tier 1 delivers with the snapshotted tab title", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fetched: string[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls),
    { HERDR_PANE_ID: "w8:pM", KITTY_WINDOW_ID: "1" }, undefined,
    async (paneId) => { fetched.push(paneId); return "◑ Add agent-notify git remote"; });
  assert.equal(await ch.deliver(EV), true);
  assert.deepEqual(fetched, ["w8:pM"], "title fetched for the exact pane");
  const cmd = calls[0].args[calls[0].args.indexOf("-execute") + 1];
  assert.ok(cmd.includes(
    `focus-tab --match window_id:1 --match title:^◑ Add agent-notify git remote$`));
});

test("tier 1 title fetch failure -> chain without the tab step", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls),
    { HERDR_PANE_ID: "w8:pM", KITTY_WINDOW_ID: "1" }, undefined,
    async () => { throw new Error("herdr down"); });
  assert.equal(await ch.deliver(EV), true);
  const cmd = calls[0].args[calls[0].args.indexOf("-execute") + 1];
  assert.ok(!cmd.includes("focus-tab"));
});

test("title fetcher not called without kitty markers in env", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fetched: string[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls),
    { HERDR_PANE_ID: "w8:pM" }, undefined, async (p) => { fetched.push(p); return "t"; });
  await ch.deliver(EV);
  assert.deepEqual(fetched, []);
});

test("tier 1: config terminalApp overrides env detection", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const cfg = { ...DEFAULT_CONFIG, channels: { ...DEFAULT_CONFIG.channels,
    desktop: { ...DEFAULT_CONFIG.channels.desktop, terminalApp: "iTerm" } } };
  const ch = createDarwinChannel(cfg, recordingExec(calls), { HERDR_PANE_ID: "w8:pM" });
  await ch.deliver(EV);
  assert.equal(calls[0].args[calls[0].args.indexOf("-execute") + 1],
    "open -a iTerm; herdr agent focus 'w8:pM'");
});

test("tier 2: no terminal-notifier, kitty env -> OSC 99 written to tty", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const written: string[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG,
    recordingExec(calls, ["terminal-notifier"]), { KITTY_WINDOW_ID: "1" }, (s) => { written.push(s); });
  assert.equal(await ch.deliver(EV), true);
  assert.deepEqual(calls, [], "tier 2 settles the delivery; no exec tier runs");
  assert.equal(written.length, 1);
  assert.ok(written[0].includes("\x1b]99;i=1:d=0;Claude needs your attention\x1b\\"));
});

test("tier 2 failure falls through to osascript", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG,
    recordingExec(calls, ["terminal-notifier"]), { KITTY_WINDOW_ID: "1" },
    () => { throw new Error("no tty"); });
  assert.equal(await ch.deliver(EV), true);
  assert.deepEqual(calls.map((c) => c.cmd), ["osascript"]);
});

test("tier 3: no terminal-notifier, no kitty -> osascript with title, body, sound on", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls, ["terminal-notifier"]), {});
  assert.equal(await ch.deliver(EV), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "osascript");
  const script = calls[0].args[1];
  assert.ok(script.includes('display notification "Run \\"npm test\\"?"'));
  assert.ok(script.includes('with title "Claude needs your attention"'));
  assert.ok(script.includes('sound name "default"'), "needs_attention defaults to sound on");
});

test("multi-line body produces a script with no raw line breaks", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const ch = createDarwinChannel(DEFAULT_CONFIG, recordingExec(calls, ["terminal-notifier"]), {});
  await ch.deliver({ ...EV, body: "line1\nline2" });
  const script = calls[0].args[1];
  assert.ok(script.includes('display notification "line1 line2"'));
  assert.ok(!/[\n\r]/.test(script), "script must contain no raw newlines");
});

test("sound omitted when config disables it", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const cfg = { ...DEFAULT_CONFIG, channels: { ...DEFAULT_CONFIG.channels,
    desktop: { ...DEFAULT_CONFIG.channels.desktop, sound: false } } };
  const ch = createDarwinChannel(cfg, recordingExec(calls, ["terminal-notifier"]), {});
  await ch.deliver(EV);
  assert.ok(!calls[0].args[1].includes("sound name"));
});

test("exec failure on every tier -> deliver returns false, no throw", async () => {
  const failing: Exec = async () => { throw new Error("boom"); };
  const ch = createDarwinChannel(DEFAULT_CONFIG, failing, {});
  assert.equal(await ch.deliver(EV), false);
});
