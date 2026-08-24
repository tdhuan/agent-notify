# agent-notify

Desktop notifications for coding agents — know instantly when Claude Code
needs your permission or finishes a turn, and click the notification to
land on the exact agent. Claude Code first; the core is agent-agnostic so
other agents (opencode, Codex CLI) can plug in later.

## Quick start

    # 1. build
    npm install && npm run build

    # 2. one-time macOS tools for clickable notifications
    brew install terminal-notifier

    # 3. kitty: enable remote control (kitty.conf), then restart kitty
    allow_remote_control yes
    listen_on unix:/tmp/kitty-remote.sock

    # 4. optional config
    mkdir -p ~/.config/agent-notify
    cp config.example.json ~/.config/agent-notify/config.json

    # 5. smoke test — a banner should pop; if you're in herdr, clicking it
    #    should raise kitty, open herdr's tab, and focus this pane
    echo '{"hook_event_name":"Notification","session_id":"smoke","cwd":"'$PWD'","message":"Smoke test"}' \
      | node dist/cli.js dispatch --agent claude --event notification

To have Claude Code fire it on real events, either install this directory
as a local plugin (`/plugin` → *Install from local directory*, then
restart Claude Code) or wire the two hooks yourself in
`~/.claude/settings.json`:

```json
"Notification": [{ "matcher": "", "hooks": [
  { "type": "command", "command": "node /path/to/agent-notify/dist/cli.js dispatch --agent claude --event notification", "timeout": 10 }]}],
"Stop": [{ "matcher": "", "hooks": [
  { "type": "command", "command": "node /path/to/agent-notify/dist/cli.js dispatch --agent claude --event stop", "timeout": 10 }]}]
```

Exit code is always 0 — a failed notification can never break a hook.

## What you get

Two events, three delivery channels:

| Event | Meaning |
|---|---|
| `needs_attention` | Claude requests a permission or waits for your input (body = Claude's message) |
| `turn_done` | Claude finished its response |

| Channel | Where | Notes |
|---|---|---|
| `desktop` | macOS banner / Linux `notify-send` | auto-selected by platform |
| `desktop` → herdr | herdr's unix socket | best-effort forward when herdr runs; silent no-op otherwise |

### macOS banner tiers

The desktop channel picks the best mechanism available:

1. **terminal-notifier** — clickable. Clicking runs `click-focus.sh`,
   which lands on the exact agent session, wherever it runs:
   - **under herdr** — resolve kitty's live remote-control socket →
     focus herdr's kitty tab → raise kitty → `herdr agent focus` the
     exact pane that fired
   - **directly in kitty** — focus the kitty tab containing the firing
     window (`focus-tab --match window_id:`), focus the window itself
     (`focus-window --match id:`), raise kitty
2. **kitty OSC 99** — no terminal-notifier but running inside kitty: a
   native kitty notification; clicking raises kitty only (kitty cannot
   run a command on click, so no tab/pane focus).
3. **osascript** — fallback everywhere else; no click action.

Why a helper script: terminal-notifier's `-execute` reliably fires only
short, metachar-free commands — long compound shell chains silently
never run. The dispatch bakes just `<repo>/click-focus.sh <target>` —
the herdr pane id (`w8:pM`) when the session runs under herdr, else
`kwin:<KITTY_WINDOW_ID>` for a direct-kitty session (herdr wins when
both are present). The script does the rest at click time (when the
shell has a minimal environment) and re-resolves kitty's socket, since
kitty appends its PID to `kitty.conf` `listen_on` paths. If the target
no longer exists (kitty restarted since the notification), the click
degrades to raising kitty. Every click is logged to
`/tmp/agent-notify-click.log`.

## Configuration

`~/.config/agent-notify/config.json` (override path with the
`AGENT_NOTIFY_CONFIG` env var). Missing or invalid file = defaults.

| Key | Default | Meaning |
|---|---|---|
| `channels.desktop.sound` | `true` | default alert sound (macOS only) |
| `channels.desktop.terminalApp` | auto | app raised on click; auto-detected (kitty, iTerm, Terminal, Ghostty) |
| `channels.desktop.enabled` | `true` | desktop notifications on/off |
| `channels.herdr.enabled` | `true` | herdr forwarding on/off |
| `channels.herdr.socketEnv` | `"HERDR_SOCKET_PATH"` | env var holding herdr's socket path |
| `events.<type>.title` | `"Claude needs your attention"` / `"Claude finished"` | banner title |
| `events.<type>.sound` | channel default | per-event sound override |
| `events.<type>.channels` | all enabled | restrict channels per event |

herdr forwarding additionally requires `HERDR_PANE_ID` to be set in the
hook environment — with only the socket path set, herdr is silently
absent. Click-to-tab specifics (socket base, herdr tab title) are tuned
in `click-focus.sh`.

## Verifying & troubleshooting

Two log files answer almost everything:

- `~/.local/state/agent-notify/log.jsonl` — one line per dispatch with
  per-channel results (`ok` / `error` / `timeout`). First stop for
  "did it even fire?"
- `/tmp/agent-notify-click.log` — what `click-focus.sh` did on each
  click. First stop for "the click did the wrong thing."

Common issues:

- **Clicks do nothing at all.** Check whether terminal-notifier's
  delivery works on your macOS, independent of this plugin:
  `rm -f /tmp/probe; terminal-notifier -title p -message p -execute 'touch /tmp/probe'`,
  click it, `ls /tmp/probe`. Also: stale notifications in Notification
  Center carry the payload they were posted with — old debug banners
  keep "not working" forever. Clear the history.
- **Wrong tab / wrong window.** `click-focus.sh` matches kitty's tab
  titled `herdr` and needs kitty's remote-control socket (see Quick
  start step 3). `allow_remote_control` without `listen_on` is not
  enough — the click-time shell has no controlling tty.
- **Nothing on screen at all.** `dist/` is gitignored: after a fresh
  clone run `npm install && npm run build` or hooks fail with
  module-not-found.
- **Unbounded log growth.** The dispatch log has no rotation — trim it
  occasionally.

## Extending

- **Add a channel**: implement `Channel` (`name` +
  `deliver(event): Promise<boolean>`) in `src/channels/`, register it in
  `src/channels/registry.ts`, add its default to `DEFAULT_CONFIG`, and
  widen the `channels` type in `src/config.ts`.
- **Add an agent**: write a normalizer mapping that agent's payload to
  `Event` (see `normalizeClaude` in `src/event.ts`) and have the agent's
  hook/notify mechanism call
  `node dist/cli.js dispatch --agent <name> --event <event>`. Core
  changes are also needed today: `src/cli.ts` routes only
  `--agent claude`, and `src/channels/herdr.ts` hardcodes
  `agent: "claude"` in its request params.
