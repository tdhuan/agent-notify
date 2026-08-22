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
