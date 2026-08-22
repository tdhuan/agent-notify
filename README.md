# agent-notify

Desktop notifications for coding agents. Claude Code first; the core is
agent-agnostic so other agents (opencode, Codex CLI) can plug in later.

## What you get

- **Needs attention** — Claude requests a permission or waits for your input
- **Turn finished** — Claude completed its response

Delivered as macOS or Linux desktop notifications, plus an optional
best-effort report to herdr's unix socket when herdr is running.

## Click behavior (macOS)

The desktop channel picks the best notification mechanism available:

1. **terminal-notifier** — if installed, notifications carry a click
   action: raise your terminal and run `herdr agent focus` on the exact
   agent pane that fired the event (when running inside herdr). Install
   once with `brew install terminal-notifier`.
2. **kitty OSC 99** — without terminal-notifier, inside kitty: a native
   kitty notification; clicking it raises kitty (but cannot run a command,
   so no per-pane focus).
3. **osascript** — fallback everywhere else; no click action.

**Known caveat (macOS 15 / Sequoia):** terminal-notifier exits right
after posting a notification, and newer macOS versions often fail to
deliver the click back to the exited process — the banner appears but
clicking does nothing. The embedded focus command itself is verified
working (`herdr agent focus` reports the pane focused). If clicks do
nothing on your machine, run the probe in Troubleshooting to check
whether `-execute` works at all.

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
- `channels.desktop.terminalApp` — terminal app name used to raise the
  terminal on notification click (macOS, terminal-notifier tier);
  auto-detected from the environment (kitty, iTerm, Terminal, Ghostty),
  override when detection fails
- `events.<type>.sound` — per-event override of the channel default
- `events.<type>.channels` — restrict which channels fire for that event
  (omit for all enabled channels)
- `channels.herdr.socketEnv` — env var holding herdr's socket path
  (default `HERDR_SOCKET_PATH`); herdr is a silent no-op without it

The config path defaults to `~/.config/agent-notify/config.json` and can
be overridden with the `AGENT_NOTIFY_CONFIG` env var. The herdr channel
requires BOTH `HERDR_SOCKET_PATH` (or the configured `socketEnv`) and
`HERDR_PANE_ID` to be set — with only the socket path set, herdr is
silently absent.

A missing or invalid config file silently falls back to defaults.

## Smoke test

    echo '{"hook_event_name":"Notification","session_id":"smoke","cwd":"'$PWD'","message":"Smoke test"}' \
      | node dist/cli.js dispatch --agent claude --event notification

A macOS banner should appear. Exit code is always 0.

## Troubleshooting

Every dispatch appends one JSON line to
`~/.local/state/agent-notify/log.jsonl` — input, resolved results per
channel (`ok` / `error` / `timeout`). That file is the first place to look.

`dist/` is a gitignored build artifact: after a fresh clone, run
`npm install && npm run build` or hooks will fail with module-not-found.
The log file also grows unbounded (one JSON line per dispatch, no
rotation), so trim it occasionally.

**Notification clicks do nothing?** Check whether terminal-notifier's
click delivery works on your macOS at all, independent of this plugin:

    rm -f /tmp/agent-notify-click-probe
    terminal-notifier -title "click probe" -message "click me" \
      -execute 'touch /tmp/agent-notify-click-probe'

Click the banner, then check `ls /tmp/agent-notify-click-probe`. If the
file never appears, `-execute` is broken at the platform level (see the
caveat above). The focus command itself can always be run manually:

    open -a kitty; herdr agent focus "$HERDR_PANE_ID"

## Adding a channel

Implement `Channel` (`name` + `deliver(event): Promise<boolean>`) in
`src/channels/`, register it in `src/channels/registry.ts`, add its default
to `DEFAULT_CONFIG`, and widen the `channels` type in `src/config.ts` to
accept the new name.

## Adding an agent

Write a normalizer mapping that agent's payload to `Event` (see
`normalizeClaude` in `src/event.ts`) and have the agent's hook/notify
mechanism call `node dist/cli.js dispatch --agent <name> --event <event>`.
Core changes are also needed today: `src/cli.ts` routes only
`--agent claude` (the agent check plus `normalizeClaude`), and
`src/channels/herdr.ts` hardcodes `agent: "claude"` in its request params —
a second adapter touches those points as well.
