# agent-notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that sends desktop notifications (macOS/Linux) — and optional herdr socket reports — when Claude needs attention or finishes a turn.

**Architecture:** A Claude Code plugin (`.claude-plugin/plugin.json` + `hooks/hooks.json`) shells out to one TypeScript-compiled CLI (`dist/cli.js`). The CLI normalizes hook JSON into an internal `Event`, merges user config over defaults, and fans out in parallel to channel implementations (darwin/linux/herdr). The core never imports Claude-specific code beyond the normalizer.

**Tech Stack:** TypeScript (strict), Node ≥ 20, zero runtime dependencies, `typescript` as the only dev dependency, `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-08-22-agent-notify-design.md`

## Global Constraints

- Zero runtime dependencies; `typescript` is the only dev dependency
- Node ≥ 20 (`npm test` uses `node --test <dir>`)
- The CLI **always exits 0** on dispatch — a failed notification must never fail a Claude Code hook
- Default titles verbatim: `"Claude needs your attention"` (needs_attention), `"Claude finished"` (turn_done)
- Config path: `~/.config/agent-notify/config.json` (env override `AGENT_NOTIFY_CONFIG`); missing file = defaults, never an error
- Log path: `~/.local/state/agent-notify/log.jsonl`, one JSON line per dispatch
- herdr channel: no-op unless `HERDR_SOCKET_PATH` **and** `HERDR_PANE_ID` are set; 0.5s socket timeout
- Per-channel delivery timeout: 2s, parallel, isolated failures
- Skip any hook payload with a truthy `agent_id` (subagent noise)
- TypeScript `"module": "commonjs"`, `"strict": true`, `"target": "ES2022"`
- Commit after every task (Conventional Commits, e.g. `feat:`, `test:`, `chore:`)

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `.gitignore`
- Create: `src/cli.ts` (usage stub only)

**Interfaces:**
- Consumes: nothing
- Produces: `npm run build` emitting `dist/cli.js`; `npm test` running `node --test dist-test/tests/` (empty for now, exit 0); `src/cli.ts` exporting nothing yet

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "agent-notify",
  "version": "0.1.0",
  "private": true,
  "description": "Desktop notifications for coding agents. Claude Code first.",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.test.json && node --test dist-test/tests/"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist-test",
    "rootDir": "."
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
dist-test/
.DS_Store
```

- [ ] **Step 5: Create `src/cli.ts` usage stub**

```ts
const USAGE = `agent-notify — desktop notifications for coding agents

Usage:
  node cli.js dispatch --agent claude --event notification|stop

Reads the agent's hook payload as JSON on stdin.`;

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] !== "dispatch") {
    process.stdout.write(USAGE + "\n");
  }
  // Real dispatch arrives in Task 8.
}

main();
```

- [ ] **Step 6: Install, build, verify**

Run: `cd /Users/huantd/tools/agent-notify && npm install && npm run build && node dist/cli.js`
Expected: `npm install` succeeds (only typescript); build emits `dist/cli.js`; running it prints the usage text and exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json tsconfig.test.json .gitignore src/cli.ts package-lock.json
git commit -m "chore: scaffold TypeScript project with build and test scripts"
```

---

### Task 2: Event model + Claude normalizer

**Files:**
- Create: `src/event.ts`
- Test: `tests/event.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by Tasks 5–9):
  - `type EventType = "needs_attention" | "turn_done"`
  - `interface Event { type: EventType; title: string; body: string; sessionId: string; cwd: string }`
  - `type HookPayload = Record<string, unknown>`
  - `function normalizeClaude(eventName: string, payload: HookPayload): Event | null` — `null` means "skip silently" (subagent or unknown event). `title` is left empty here; dispatch fills it from config.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/event.js'` (event.ts doesn't exist yet).

- [ ] **Step 3: Write `src/event.ts`**

```ts
export type EventType = "needs_attention" | "turn_done";

export interface Event {
  type: EventType;
  /** Filled by dispatch from config after normalization. */
  title: string;
  body: string;
  sessionId: string;
  cwd: string;
}

export type HookPayload = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const FALLBACK_BODY: Record<EventType, string> = {
  needs_attention: "Claude needs your input",
  turn_done: "",
};

/**
 * Map a Claude Code hook payload onto the internal Event.
 * Returns null when the event should be skipped silently:
 * subagent noise (agent_id present) or unknown event names.
 */
export function normalizeClaude(eventName: string, payload: HookPayload): Event | null {
  const type: EventType | null =
    eventName === "notification" ? "needs_attention"
    : eventName === "stop" ? "turn_done"
    : null;
  if (type === null) return null;
  if (payload["agent_id"]) return null;

  const cwd = str(payload["cwd"]);
  let body = str(payload["message"]) || FALLBACK_BODY[type];
  if (type === "turn_done") {
    const base = cwd.split("/").filter(Boolean).pop() ?? "";
    body = `Finished in ${base}`;
  }

  return { type, title: "", body, sessionId: str(payload["session_id"]), cwd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all `tests/event.test.ts` tests PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/event.ts tests/event.test.ts
git commit -m "feat: normalize Claude hook payloads into agent-agnostic events"
```

---

### Task 3: Config loading + resolution helpers

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `EventType` from `src/event.ts`
- Produces (used by Tasks 5–9):
  - `interface DesktopChannelConfig { enabled?: boolean; sound?: boolean }`
  - `interface HerdrChannelConfig { enabled?: boolean; socketEnv?: string }`
  - `interface EventConfig { title?: string; sound?: boolean; channels?: string[] }`
  - `interface Config { channels: { desktop: DesktopChannelConfig; herdr: HerdrChannelConfig }; events: Record<EventType, EventConfig> }`
  - `const DEFAULT_CONFIG: Config`
  - `function deepMerge<T>(base: T, override: unknown): T`
  - `function configFilePath(): string` — `$AGENT_NOTIFY_CONFIG` if set, else `~/.config/agent-notify/config.json`
  - `function loadConfig(path?: string): Config` — missing/unreadable/invalid file → `DEFAULT_CONFIG`
  - `function resolveTitle(config: Config, type: EventType): string`
  - `function resolveSound(config: Config, type: EventType): boolean` — `events[type].sound ?? channels.desktop.sound ?? true`
  - `function enabledChannelNames(config: Config, type: EventType): string[]` — `events[type].channels` if set, else every channel with `enabled !== false`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventType } from "./event.js";

export interface DesktopChannelConfig { enabled?: boolean; sound?: boolean }
export interface HerdrChannelConfig { enabled?: boolean; socketEnv?: string }
export interface EventConfig { title?: string; sound?: boolean; channels?: string[] }

export interface Config {
  channels: { desktop: DesktopChannelConfig; herdr: HerdrChannelConfig };
  events: Record<EventType, EventConfig>;
}

export const DEFAULT_CONFIG: Config = {
  channels: {
    desktop: { enabled: true, sound: true },
    herdr: { enabled: true, socketEnv: "HERDR_SOCKET_PATH" },
  },
  events: {
    needs_attention: { title: "Claude needs your attention" },
    turn_done: { title: "Claude finished" },
  },
};

export function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base !== "object" || base === null) return override as T;
  if (typeof override !== "object" || Array.isArray(override)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] = key in (base as Record<string, unknown>)
      ? deepMerge(baseValue, value)
      : value;
  }
  return out as T;
}

export function configFilePath(): string {
  return process.env.AGENT_NOTIFY_CONFIG
    ?? join(homedir(), ".config", "agent-notify", "config.json");
}

export function loadConfig(path?: string): Config {
  const file = path ?? configFilePath();
  if (!existsSync(file)) return DEFAULT_CONFIG;
  try {
    return deepMerge(DEFAULT_CONFIG, JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function resolveTitle(config: Config, type: EventType): string {
  return config.events[type].title ?? "";
}

export function resolveSound(config: Config, type: EventType): boolean {
  return config.events[type].sound ?? config.channels.desktop.sound ?? true;
}

export function enabledChannelNames(config: Config, type: EventType): string[] {
  const enabled = (name: string): boolean => {
    const cfg = (config.channels as Record<string, { enabled?: boolean }>)[name];
    return cfg ? cfg.enabled !== false : false;
  };
  const filter = config.events[type].channels;
  if (filter) return filter.filter(enabled);
  return Object.keys(config.channels).filter(enabled);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all config + event tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config load with deep-merge defaults and per-event resolution"
```

---

### Task 4: Dispatch log

**Files:**
- Create: `src/log.ts`
- Test: `tests/log.test.ts`

**Interfaces:**
- Consumes: `EventType` from `src/event.ts`
- Produces (used by Task 8):
  - `interface DispatchLog { ts: string; agent: string; eventType: EventType | "skipped"; sessionId: string; input: unknown; channels: Record<string, string> }` — channel values are `"ok"`, `"error"`, `"timeout"`, or `"skipped"`
  - `function defaultLogPath(): string` — `~/.local/state/agent-notify/log.jsonl`
  - `function appendLog(entry: DispatchLog, path?: string): void` — never throws; creates parent dirs; appends one JSON line

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/log.js'`.

- [ ] **Step 3: Write `src/log.ts`**

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { EventType } from "./event.js";

export interface DispatchLog {
  ts: string;
  agent: string;
  eventType: EventType | "skipped";
  sessionId: string;
  input: unknown;
  /** channel name -> "ok" | "error" | "timeout" | "skipped" */
  channels: Record<string, string>;
}

export function defaultLogPath(): string {
  return join(homedir(), ".local", "state", "agent-notify", "log.jsonl");
}

export function appendLog(entry: DispatchLog, path?: string): void {
  try {
    const file = path ?? defaultLogPath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Never let logging break a dispatch.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all log tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/log.ts tests/log.test.ts
git commit -m "feat: JSONL dispatch log with error-swallowing append"
```

---

### Task 5: darwin channel (macOS notifications)

**Files:**
- Create: `src/channels/base.ts`
- Create: `src/channels/exec.ts`
- Create: `src/channels/darwin.ts`
- Test: `tests/darwin.test.ts`

**Interfaces:**
- Consumes: `Event` from `src/event.ts`; `Config`, `resolveSound` from `src/config.ts`
- Produces (used by Tasks 6–8):
  - `interface Channel { name: string; deliver(event: Event): Promise<boolean> }` (in `src/channels/base.ts`)
  - `type Exec = (command: string, args: string[]) => Promise<void>` (in `src/channels/exec.ts`)
  - `function defaultExec(command: string, args: string[]): Promise<void>` — promisified `execFile`, rejects on non-zero exit
  - `function createDarwinChannel(config: Config, exec: Exec = defaultExec): Channel`
  - `function appleScriptEscape(s: string): string` (exported for testing)

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/channels/darwin.js'`.

- [ ] **Step 3: Write `src/channels/base.ts`**

```ts
import type { Event } from "../event.js";

export interface Channel {
  name: string;
  /** @returns true if delivered, false on any failure. Must never throw. */
  deliver(event: Event): Promise<boolean>;
}
```

- [ ] **Step 4: Write `src/channels/exec.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Exec = (command: string, args: string[]) => Promise<void>;

export async function defaultExec(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, { timeout: 1500 });
}
```

- [ ] **Step 5: Write `src/channels/darwin.ts`**

```ts
import type { Event } from "../event.js";
import { resolveSound, type Config } from "../config.js";
import type { Channel } from "./base.js";
import { defaultExec, type Exec } from "./exec.js";

export function appleScriptEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function createDarwinChannel(config: Config, exec: Exec = defaultExec): Channel {
  return {
    name: "desktop",
    async deliver(event: Event): Promise<boolean> {
      const sound = resolveSound(config, event.type);
      const script =
        `display notification "${appleScriptEscape(event.body)}" ` +
        `with title "${appleScriptEscape(event.title)}"` +
        (sound ? ' sound name "default"' : "");
      try {
        await exec("osascript", ["-e", script]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: all darwin tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/channels/base.ts src/channels/exec.ts src/channels/darwin.ts tests/darwin.test.ts
git commit -m "feat: macOS desktop channel via osascript with sound resolution"
```

---

### Task 6: linux channel (notify-send)

**Files:**
- Create: `src/channels/linux.ts`
- Test: `tests/linux.test.ts`

**Interfaces:**
- Consumes: `Event` from `src/event.ts`; `Config` from `src/config.ts`; `Channel` from `src/channels/base.ts`; `Exec` from `src/channels/exec.ts`
- Produces: `function createLinuxChannel(config: Config, exec: Exec = defaultExec): Channel` — name `"desktop"`; sound is ignored on Linux (notify-send has no portable sound flag — documented in README, Task 9)

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/channels/linux.js'`.

- [ ] **Step 3: Write `src/channels/linux.ts`**

```ts
import type { Event } from "../event.js";
import type { Config } from "../config.js";
import type { Channel } from "./base.js";
import { defaultExec, type Exec } from "./exec.js";

export function createLinuxChannel(_config: Config, exec: Exec = defaultExec): Channel {
  return {
    name: "desktop",
    async deliver(event: Event): Promise<boolean> {
      try {
        await exec("notify-send", ["--app-name=agent-notify", event.title, event.body]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all linux tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels/linux.ts tests/linux.test.ts
git commit -m "feat: Linux desktop channel via notify-send"
```

---

### Task 7: herdr channel (unix socket forwarder)

**Files:**
- Create: `src/channels/herdr.ts`
- Test: `tests/herdr.test.ts`

**Interfaces:**
- Consumes: `Event` from `src/event.ts`; `Config` from `src/config.ts`; `Channel` from `src/channels/base.ts`
- Produces: `function createHerdrChannel(config: Config, env: NodeJS.ProcessEnv = process.env): Channel` — name `"herdr"`; no-op returning `false` when `env[socketEnv]` or `env.HERDR_PANE_ID` missing; 0.5s connect+send budget; request shape (newline-terminated JSON):
  ```ts
  {
    id: `agent-notify:${Date.now()}`,
    method: "agent-notify.event",
    params: {
      pane_id: string,          // env.HERDR_PANE_ID
      source: "agent-notify:claude",
      agent: "claude",
      event: EventType,         // "needs_attention" | "turn_done"
      title: string,
      body: string,
      seq: number               // Date.now()
    }
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHerdrChannel } from "../src/channels/herdr.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-notify-herdr-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const EV = {
  type: "needs_attention" as const,
  title: "Claude needs your attention",
  body: "Claude needs your permission to use Bash",
  sessionId: "s1",
  cwd: "/tmp",
};

test("no-op (false) when herdr env is absent", async () => {
  const ch = createHerdrChannel(DEFAULT_CONFIG, {});
  assert.equal(await ch.deliver(EV), false);
});

test("forwards agent-notify.event request to the socket", async () => {
  const sockPath = join(tmp, "herdr.sock");
  const received: string[] = [];
  const server = createServer((sock) => {
    sock.on("data", (d) => { received.push(String(d)); sock.write("{}\n"); });
  });
  server.listen(sockPath);
  await once(server, "listening");

  const ch = createHerdrChannel(DEFAULT_CONFIG, {
    HERDR_SOCKET_PATH: sockPath, HERDR_PANE_ID: "%5",
  });
  assert.equal(await ch.deliver(EV), true);

  const req = JSON.parse(received[0].trim());
  assert.equal(req.method, "agent-notify.event");
  assert.equal(req.params.pane_id, "%5");
  assert.equal(req.params.source, "agent-notify:claude");
  assert.equal(req.params.event, "needs_attention");
  assert.equal(req.params.title, "Claude needs your attention");

  server.close();
});

test("dead socket path -> false, no throw", async () => {
  const ch = createHerdrChannel(DEFAULT_CONFIG, {
    HERDR_SOCKET_PATH: join(tmp, "missing.sock"), HERDR_PANE_ID: "%5",
  });
  assert.equal(await ch.deliver(EV), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/channels/herdr.js'`.

- [ ] **Step 3: Write `src/channels/herdr.ts`**

```ts
import { connect } from "node:net";
import type { Event } from "../event.js";
import type { Config } from "../config.js";
import type { Channel } from "./base.js";

const SOCKET_TIMEOUT_MS = 500;

export function createHerdrChannel(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): Channel {
  return {
    name: "herdr",
    async deliver(event: Event): Promise<boolean> {
      const socketEnv = config.channels.herdr.socketEnv ?? "HERDR_SOCKET_PATH";
      const socketPath = env[socketEnv];
      const paneId = env["HERDR_PANE_ID"];
      if (!socketPath || !paneId) return false;

      const now = Date.now();
      const request = {
        id: `agent-notify:${now}`,
        method: "agent-notify.event",
        params: {
          pane_id: paneId,
          source: "agent-notify:claude",
          agent: "claude",
          event: event.type,
          title: event.title,
          body: event.body,
          seq: now,
        },
      };

      return new Promise<boolean>((resolve) => {
        const socket = connect(socketPath);
        const finish = (ok: boolean): void => {
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(SOCKET_TIMEOUT_MS, () => finish(false));
        socket.on("error", () => finish(false));
        socket.on("connect", () => {
          socket.write(JSON.stringify(request) + "\n", () => finish(true));
        });
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all herdr tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels/herdr.ts tests/herdr.test.ts
git commit -m "feat: herdr channel forwarding events over its unix socket"
```

---

### Task 8: Registry + dispatch orchestration + CLI entry

**Files:**
- Create: `src/channels/registry.ts`
- Modify: `src/cli.ts` (replace usage stub)
- Test: `tests/registry.test.ts`
- Test: `tests/dispatch.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7
- Produces:
  - `function createChannels(config: Config, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exec: Exec = defaultExec): Channel[]` (registry.ts) — returns enabled channels: `desktop` (darwin on `darwin`, linux otherwise) + `herdr` when its env is present
  - `const TIMEOUT: unique symbol` and `function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT>` (cli.ts, both exported) — timeout wins the race via sentinel so logs distinguish `timeout` from `error`
  - `interface DispatchDeps { channels?: Channel[]; configPath?: string; logPath?: string; now?: () => string }`
  - `async function runDispatch(argv: string[], stdin: string, deps: DispatchDeps = {}): Promise<void>` (cli.ts, exported) — never throws
  - `main()` in `src/cli.ts`: reads stdin from fd 0, calls `runDispatch`, always `process.exit(0)`

- [ ] **Step 1: Write the failing registry test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: compile error — `Cannot find module '../src/channels/registry.js'`.

- [ ] **Step 3: Write `src/channels/registry.ts`**

```ts
import type { Config } from "../config.js";
import type { Channel } from "./base.js";
import { createDarwinChannel } from "./darwin.js";
import { createLinuxChannel } from "./linux.js";
import { createHerdrChannel } from "./herdr.js";
import { defaultExec, type Exec } from "./exec.js";

export function createChannels(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exec: Exec = defaultExec,
): Channel[] {
  const channels: Channel[] = [];
  if (config.channels.desktop.enabled !== false) {
    channels.push(
      platform === "darwin"
        ? createDarwinChannel(config, exec)
        : createLinuxChannel(config, exec),
    );
  }
  if (config.channels.herdr.enabled !== false) {
    channels.push(createHerdrChannel(config, env));
  }
  return channels;
}
```

- [ ] **Step 4: Run the registry test to verify it passes**

Run: `npm test`
Expected: registry tests PASS.

- [ ] **Step 5: Write the failing dispatch test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDispatch, withTimeout, TIMEOUT } from "../src/cli.js";
import type { Channel } from "../src/channels/base.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-notify-dispatch-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const NOTIFICATION_STDIN = JSON.stringify({
  hook_event_name: "Notification", session_id: "s1",
  cwd: "/Users/huantd/tools/agent-notify",
  message: "Claude needs your permission to use Bash",
});

function fakeChannel(name: string, behavior: "ok" | "throw" | "sleep" | "record",
                     log: string[] = [], deliverResult = true): Channel {
  return {
    name,
    async deliver(event) {
      if (behavior === "throw") throw new Error("boom");
      if (behavior === "sleep") await new Promise((r) => setTimeout(r, 3000));
      if (behavior === "record") log.push(`${name}:${event.type}:${event.title}`);
      return deliverResult;
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
```

(Per-event channel filtering by config is covered by the `enabledChannelNames` tests in Task 3 and the `createChannels` tests in the registry suite — dispatch only applies the filter, it does not decide it.)

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: dispatch tests FAIL — `runDispatch`/`withTimeout` not exported from `src/cli.js` (stub only).

- [ ] **Step 7: Replace `src/cli.ts`**

```ts
import { readFileSync } from "node:fs";
import type { Event } from "./event.js";
import { normalizeClaude, type HookPayload } from "./event.js";
import { loadConfig, resolveTitle, enabledChannelNames } from "./config.js";
import { appendLog, defaultLogPath, type DispatchLog } from "./log.js";
import { createChannels } from "./channels/registry.js";
import type { Channel } from "./channels/base.js";

const USAGE = `agent-notify — desktop notifications for coding agents

Usage:
  node cli.js dispatch --agent claude --event notification|stop

Reads the agent's hook payload as JSON on stdin.`;

const CHANNEL_TIMEOUT_MS = 2000;

/** Sentinel returned by withTimeout when the deadline wins the race. */
export const TIMEOUT = Symbol("timeout");

export interface DispatchDeps {
  channels?: Channel[];
  configPath?: string;
  logPath?: string;
  now?: () => string;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}

function parseArgs(argv: string[]): { agent: string; event: string } | null {
  const agentIndex = argv.indexOf("--agent");
  const eventIndex = argv.indexOf("--event");
  if (agentIndex === -1 || eventIndex === -1) return null;
  const agent = argv[agentIndex + 1];
  const event = argv[eventIndex + 1];
  return agent && event ? { agent, event } : null;
}

export async function runDispatch(argv: string[], stdin: string, deps: DispatchDeps = {}): Promise<void> {
  const config = loadConfig(deps.configPath);
  const logPath = deps.logPath ?? defaultLogPath();
  const now = deps.now ?? (() => new Date().toISOString());

  const writeLog = (eventType: DispatchLog["eventType"], input: unknown,
                    channels: Record<string, string>, sessionId: string): void =>
    appendLog({ ts: now(), agent: "claude", eventType, sessionId, input, channels }, logPath);

  let payload: HookPayload = {};
  try {
    payload = stdin.trim() ? (JSON.parse(stdin) as HookPayload) : {};
  } catch {
    writeLog("skipped", stdin, {}, "");
    return;
  }

  const args = parseArgs(argv);
  if (!args || args.agent !== "claude") {
    writeLog("skipped", payload, {}, String(payload["session_id"] ?? ""));
    return;
  }

  const event: Event | null = normalizeClaude(args.event, payload);
  if (!event) {
    writeLog("skipped", payload, {}, String(payload["session_id"] ?? ""));
    return;
  }
  event.title = resolveTitle(config, event.type);

  const wanted = new Set(enabledChannelNames(config, event.type));
  const channels = (deps.channels ?? createChannels(config)).filter((c) => wanted.has(c.name));

  const results = await Promise.all(
    channels.map(async (channel): Promise<[string, string]> => {
      try {
        const outcome = await withTimeout(channel.deliver(event), CHANNEL_TIMEOUT_MS);
        const status = outcome === TIMEOUT ? "timeout" : outcome === true ? "ok" : "error";
        return [channel.name, status];
      } catch {
        return [channel.name, "error"];
      }
    }),
  );
  writeLog(event.type, payload, Object.fromEntries(results), event.sessionId);
}

async function main(): Promise<void> {
  try {
    let stdin = "";
    try {
      stdin = readFileSync(0, "utf8");
    } catch {
      stdin = "";
    }
    const argv = process.argv.slice(2);
    if (argv[0] !== "dispatch") {
      process.stdout.write(USAGE + "\n");
      return;
    }
    await runDispatch(argv, stdin);
  } catch {
    // Prime directive: never fail the host agent's hook.
  } finally {
    process.exit(0);
  }
}

void main();
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS (event, config, log, darwin, linux, herdr, registry, dispatch).

- [ ] **Step 9: Manual CLI smoke on macOS**

Run:
```bash
npm run build
echo '{"hook_event_name":"Notification","session_id":"smoke","cwd":"/Users/huantd/tools/agent-notify","message":"Smoke test — permission requested"}' | node dist/cli.js dispatch --agent claude --event notification
echo '---'; echo $?
```
Expected: exit code `0`; a macOS notification banner titled "Claude needs your attention" appears; last line of `~/.local/state/agent-notify/log.jsonl` shows `"channels": {"desktop": "ok"}`.

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts src/channels/registry.ts tests/registry.test.ts tests/dispatch.test.ts
git commit -m "feat: dispatch orchestration — parallel channels, timeouts, always exit 0"
```

---

### Task 9: Plugin wiring, config example, README

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `hooks/hooks.json`
- Create: `config.example.json`
- Create: `README.md`

**Interfaces:**
- Consumes: `dist/cli.js` from Task 1–8 (built via `npm run build`)
- Produces: an installable Claude Code local plugin; user-facing docs

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "agent-notify",
  "version": "0.1.0",
  "description": "Desktop notifications for Claude Code events — needs attention, turn finished. Optional herdr forwarding.",
  "author": { "name": "huantd" }
}
```

- [ ] **Step 2: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PLUGIN_ROOT/dist/cli.js\" dispatch --agent claude --event notification",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PLUGIN_ROOT/dist/cli.js\" dispatch --agent claude --event stop",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Create `config.example.json`** (matches spec § Config exactly)

```json
{
  "channels": {
    "desktop": { "enabled": true, "sound": true },
    "herdr": { "enabled": true, "socketEnv": "HERDR_SOCKET_PATH" }
  },
  "events": {
    "needs_attention": { "title": "Claude needs your attention", "channels": ["desktop", "herdr"] },
    "turn_done": { "title": "Claude finished", "sound": false }
  }
}
```

- [ ] **Step 4: Create `README.md`**

```markdown
# agent-notify

Desktop notifications for coding agents. Claude Code first; the core is
agent-agnostic so other agents (opencode, Codex CLI) can plug in later.

## What you get

- **Needs attention** — Claude requests a permission or waits for your input
- **Turn finished** — Claude completed its response

Delivered as macOS (`osascript`) or Linux (`notify-send`) desktop
notifications, plus an optional best-effort report to herdr's unix socket
when herdr is running.

## Install (personal, local plugin)

    npm install && npm run build

Then in Claude Code: `/plugin` → *Install from local directory* → select
this directory. Restart Claude Code afterwards.

## Config

Copy the example to `~/.config/agent-notify/config.json` and edit:

    mkdir -p ~/.config/agent-notify
    cp config.example.json ~/.config/agent-notify/config.json

- `channels.desktop.sound` — play the default alert sound (macOS only;
  notify-send has no portable sound)
- `events.<type>.sound` — per-event override of the channel default
- `events.<type>.channels` — restrict which channels fire for that event
  (omit for all enabled channels)
- `channels.herdr.socketEnv` — env var holding herdr's socket path
  (default `HERDR_SOCKET_PATH`); herdr is a silent no-op without it

An missing or invalid config file silently falls back to defaults.

## Smoke test

    echo '{"hook_event_name":"Notification","session_id":"smoke","cwd":"'$PWD'","message":"Smoke test"}' \
      | node dist/cli.js dispatch --agent claude --event notification

A macOS banner should appear. Exit code is always 0.

## Troubleshooting

Every dispatch appends one JSON line to
`~/.local/state/agent-notify/log.jsonl` — input, resolved results per
channel (`ok` / `error` / `timeout`). That file is the first place to look.

## Adding a channel

Implement `Channel` (`name` + `deliver(event): Promise<boolean>`) in
`src/channels/`, register it in `src/channels/registry.ts`, add its default
to `DEFAULT_CONFIG`. No other changes needed.

## Adding an agent

Write a normalizer mapping that agent's payload to `Event` (see
`normalizeClaude` in `src/event.ts`) and have the agent's hook/notify
mechanism call `node dist/cli.js dispatch --agent <name> --event <event>`.
```

- [ ] **Step 5: Build and verify plugin shape**

Run: `npm run build && npm test && ls dist/cli.js .claude-plugin/plugin.json hooks/hooks.json`
Expected: build + full test suite PASS; all three paths exist.

- [ ] **Step 6: End-to-end manual verification (user)**

Install as local plugin via `/plugin` → local directory → `/Users/huantd/tools/agent-notify`, restart Claude Code, run any turn. Expected: notification when the turn finishes; notification when Claude asks a permission question. This step needs the user — flag it in the task report rather than marking complete without it.

- [ ] **Step 7: Commit**

```bash
git add .claude-plugin/plugin.json hooks/hooks.json config.example.json README.md
git commit -m "feat: Claude Code plugin wiring, config example, README"
```

---

## Self-Review notes (resolved during planning)

- **Spec coverage check**: events (Task 2), config + precedence (Task 3), log (Task 4), darwin/linux/herdr channels (Tasks 5–7), parallel + 2s timeout + exit-0 (Task 8), plugin/hooks/config example/README (Task 9), subagent skip (Tasks 2 & 8). Deferred items match the spec's non-goals.
- **Type consistency**: `Event`/`EventType` (Task 2) used unchanged in Tasks 4–8; `Channel` (Task 5 base.ts) used in Tasks 6–8; `withTimeout`/`TIMEOUT` sentinel exported from `src/cli.ts` and consumed by the dispatch test with the same names; `enabledChannelNames` (Task 3) consumed in Task 8.
- **Executor-clarity cleanup**: darwin sound-default expectations corrected inline (needs_attention defaults to sound **on**); the redundant dispatch filter test was removed in favor of the Task 3/registry coverage; `withTimeout` uses a `TIMEOUT` sentinel so channel failure (`false`) and deadline expiry log as distinct statuses; `parseArgs` explicitly rejects missing flags instead of relying on downstream agent-name checks.
