# agent-notify — Design

Date: 2026-08-22
Status: Approved (all design sections reviewed)

## Overview

`agent-notify` is a notification plugin that tells you when a coding agent
needs attention or finishes its turn — via desktop notifications (macOS and
Linux) and, optionally, herdr's unix socket.

It ships as a Claude Code plugin first, but the core is agent-agnostic:
adapters for other agents (opencode, Codex CLI) are thin wrappers around the
same CLI, with zero core changes.

Written in TypeScript, compiled to plain JS, zero runtime dependencies.

## Goals

- Notify on two Claude Code events in v1:
  - **needs_attention** — the `Notification` hook (permission requested,
    waiting for input)
  - **turn_done** — the `Stop` hook (main agent finished responding)
- Deliver via:
  - **desktop** — `osascript` on macOS, `notify-send` on Linux; auto-selected
  - **herdr** — best-effort forward to herdr's unix socket when present
- Channels are pluggable: adding one (Telegram, webhooks, …) later means
  adding one file implementing the Channel interface
- Personal-use packaging: local directory plugin install

## Non-goals (v1)

- Session start/end or per-tool event notifications
- Transcript parsing for rich notification bodies
- A daemon, queue, or persistent process — hooks spawn the CLI, it exits
- Focus detection / quiet hours / debouncing (structure permits adding later)
- opencode / Codex CLI adapters (structure permits adding later)
- Marketplace publishing polish

## Architecture

Three independent layers:

```
agent adapters          core (agent-agnostic)                 channels
-----------------       --------------------------------      --------------------
claude:                 normalize hook JSON -> Event          darwin (osascript)
  plugin hooks    stdin   Event + config -> channel fan-out   linux (notify-send)
opencode: (later) ----->  always exit 0                       herdr (unix socket)
codex: (later)                                               ...pluggable
```

The `src/` tree never imports Claude Code specifics beyond the normalizer
that maps Claude hook payloads onto the internal `Event`.

### Repo layout

```
agent-notify/
├── .claude-plugin/plugin.json     # plugin manifest
├── hooks/hooks.json               # Notification + Stop -> node dist/cli.js
├── package.json                   # dev dep: typescript only
├── tsconfig.json
├── src/
│   ├── cli.ts                     # parse args, read stdin, dispatch
│   ├── event.ts                   # Event type + per-agent normalizers
│   ├── config.ts                  # load + merge config over defaults
│   ├── log.ts                     # one JSON line per dispatch
│   └── channels/
│       ├── base.ts                # Channel interface
│       ├── darwin.ts
│       ├── linux.ts
│       ├── herdr.ts
│       └── registry.ts            # name -> channel impl
├── dist/                          # compiled JS (built via npm run build)
├── tests/                         # node:test
├── config.example.json
└── README.md
```

## Components

### Plugin glue (`.claude-plugin/plugin.json` + `hooks/hooks.json`)

`hooks.json` registers two events, each running:

```
node $CLAUDE_PLUGIN_ROOT/dist/cli.js dispatch --agent claude --event notification|stop
```

Claude Code pipes the hook payload as JSON on stdin.

### Event (src/event.ts)

Internal normalized shape:

```ts
type EventType = "needs_attention" | "turn_done";
interface Event {
  type: EventType;
  title: string;      // from config
  body: string;       // human-readable detail
  sessionId: string;
  cwd: string;
}
```

- `Notification` → `needs_attention`, body = hook's `message` field
- `Stop` → `turn_done`, body = `Finished in <basename of cwd>`
- Guard: payloads with `agent_id` (subagent noise) are skipped

### Config (src/config.ts)

`~/.config/agent-notify/config.json`, merged over defaults; missing file =
defaults, never an error:

```json
{
  "channels": {
    "desktop": { "enabled": true, "sound": true },
    "herdr":   { "enabled": true, "socketEnv": "HERDR_SOCKET_PATH" }
  },
  "events": {
    "needs_attention": { "title": "Claude needs your attention", "channels": ["desktop", "herdr"] },
    "turn_done":       { "title": "Claude finished", "sound": false }
  }
}
```

- `channels.*.enabled` gates globally; `events.*.channels` filters per event
  (default: all enabled channels)
- Event-level keys (e.g. `events.turn_done.sound`) override channel-level
  defaults for that event
- `desktop` resolves to darwin or linux at runtime by `process.platform`
- `herdr` is a no-op unless `HERDR_SOCKET_PATH` and `HERDR_PANE_ID` are set
  (same contract as herdr's managed hook)

### Channels (src/channels/)

```ts
interface Channel {
  name: string;
  deliver(event: Event): Promise<boolean>;
}
```

- **darwin**: `execFile("osascript", [...])` — `display notification`,
  optionally `with sound`
- **linux**: `execFile("notify-send", [...])`
- **herdr**: connect to the socket from `socketEnv` (default
  `HERDR_SOCKET_PATH`), send one JSON line, best-effort. v1 sends an
  `agent-notify`-namespaced request; herdr's actual protocol method for state
  events is unconfirmed — the channel is designed to be corrected against
  herdr's real API without touching anything else

## Data flow

1. Claude Code fires `Notification` or `Stop`; runs the hook command with
   the payload on stdin
2. `cli.ts` reads stdin → normalizer produces an `Event`
3. `config.ts` merges user config over defaults
4. `registry.ts` resolves enabled channels for the event type; every
   `deliver()` runs in parallel with a 2s timeout each
5. Log one JSON line; exit 0

## Error handling

Prime directive: never disturb the host agent.

- Top-level catch in `cli.ts` → **always exit 0**
- Per-channel try/catch + 2s timeout; failures are isolated
- herdr socket: 0.5s timeout, refused connection = silent no-op
- Unparseable stdin / missing config / unknown event → silent defaults
- Each dispatch appends `{input, resolvedConfig, results}` to
  `~/.local/state/agent-notify/log.jsonl`

## Testing

TDD during implementation. `node:test` (no framework dependency):

- Unit: normalizers (fixture hook payloads), config merge/defaults,
  registry resolution, subagent skip guard
- Channels: assert exact `osascript`/`notify-send` argv via mocked
  `execFile`; herdr against a fake unix socket server
- Manual smoke (documented in README):
  - `echo '<fixture>' | node dist/cli.js dispatch --agent claude --event notification`
  - Full loop: plugin installed, real Claude Code turn, notification appears

## Install

1. `git init`, `npm install`, `npm run build`
2. Install as local plugin: `/plugin` → local directory →
   `/Users/huantd/tools/agent-notify`
3. `cp config.example.json ~/.config/agent-notify/config.json`, tweak
4. No daemon, no launchd/systemd — hooks spawn the CLI per event

## Future work (explicitly deferred)

- opencode / Codex CLI adapters (thin wrappers over `dist/cli.js`)
- Additional channels (Telegram, Slack/Discord webhooks, ntfy) — new files
  in `src/channels/` plus registry entries
- Focus detection, quiet hours, debouncing (likely as a later daemon mode,
  which the CLI-forwarding shape already permits)
- Marketplace publishing
