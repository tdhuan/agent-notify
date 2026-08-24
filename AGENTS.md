# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex, OpenCode, …) when working with code in this repository.

## Commands

- `npm run build` — compile `src/` → `dist/` (CommonJS). The Claude Code hooks invoke `dist/cli.js`, so **rebuild after every source change** or live behavior diverges (`dist/` is gitignored).
- `npm test` — compile `src/`+`tests/` via `tsconfig.test.json` into `dist-test/`, then `node --test dist-test/tests/*.test.js`.
- Single test file: `node --test dist-test/tests/darwin.test.js` (after a compile). Single test by name: `node --test --test-name-pattern "tier 1" dist-test/tests/darwin.test.js`.
- CLI smoke test (pops a real macOS notification): `echo '{"hook_event_name":"Notification","session_id":"s","cwd":"'$PWD'","message":"hi"}' | node dist/cli.js dispatch --agent claude --event notification`

## Architecture

Three layers, kept strictly separate:

1. **Agent adapters** — the only Claude-specific code is `normalizeClaude` in `src/event.ts` plus the agent check in `src/cli.ts`. Everything downstream consumes the agent-agnostic `Event`.
2. **Core** — `src/event.ts` (Event type + normalizers), `src/config.ts` (DEFAULT_CONFIG + deep-merge `loadConfig`), `src/log.ts` (JSONL dispatch log). `loadConfig` must return deep-isolated copies (`structuredClone` base + `deepMerge` onto the clone) — tests mutate returned configs; sharing state with `DEFAULT_CONFIG` is a tested-against regression.
3. **Channels** — `src/channels/`: `base.ts` defines the `Channel` contract (`deliver(event): Promise<boolean>` — **never throws**, returns false on failure); `darwin.ts`, `linux.ts`, `herdr.ts` implement it; `registry.ts` selects (desktop = platform-picked, herdr gated on env presence).

**Dispatch flow** (`src/cli.ts`): hook JSON on stdin → `parseArgs` → `normalizeClaude` → title from config → `createChannels` filtered by `enabledChannelNames` → parallel `deliver` each raced against a 2s timeout (`TIMEOUT` symbol sentinel distinguishes `timeout` from `error` in the log) → one JSONL line to `~/.local/state/agent-notify/log.jsonl`.

**Prime directive**: the CLI always exits 0 — a failed notification must never fail a Claude Code hook. Every layer defends this (per-channel try/catch, herdr's socket-close backstop so its promise can never hang, `main`'s catch-all + `finally process.exit(0)`).

**macOS desktop tiering** (`darwin.ts`): terminal-notifier (clickable) → kitty OSC 99 written to `/dev/tty` (works from inside hooks because hook stdout is captured) → osascript banner.

**`click-focus.sh` contract** — the critical, empirically-discovered constraint of this repo:

- terminal-notifier's `-execute` reliably fires only **short, metachar-free commands**; long compound shell chains (quotes, `;`, `||`, redirections) silently never run on click. The dispatch must bake only `<repo>/click-focus.sh <target>` into the notification.
- The `<target>` encodes precedence: herdr pane id (`w8:pM`) when `HERDR_PANE_ID` is set (herdr wins when both env ids exist), else `kwin:<KITTY_WINDOW_ID>` for a session running directly in kitty.
- The script resolves everything at click time because the click-time shell has a minimal environment: no PATH to `kitty`/`herdr`, no HOME guarantees, and kitty PID-suffixes its `kitty.conf` `listen_on` socket paths (so the live socket must be globbed and probed per click).
- Baked kitty ids can go stale across kitty restarts — the script degrades to raising kitty (`open -a kitty`) when no live socket has the target.
- The script always runs `open -a kitty`: `kitty @ focus-tab`/`focus-window` switch tabs/panes inside kitty but do not lift kitty above other apps.
- Click activity logs to `/tmp/agent-notify-click.log`; dispatches log to `~/.local/state/agent-notify/log.jsonl`.

## Testing conventions

- `node:test` + `assert/strict`, no test-framework dependency. Tests import compiled paths (`../src/event.js`) — CommonJS module style throughout.
- All environment-dependent behavior is behind injection seams: `exec` (records argv), `env`, `deps.writeTty`, `deps.clickScriptPath` on `createDarwinChannel`. Inject stubs rather than letting unit tests hit real `which`/`herdr`/sockets.
- This codebase was built test-first (RED → GREEN per behavior); continue that. New behavior in `darwin.ts` should pin exact argv/strings in tests — argv correctness is the product.

## Environment facts

- herdr (terminal workspace manager, CLI at `~/.local/bin/herdr`) provides `HERDR_PANE_ID` (format like `w8:pM`) and `HERDR_SOCKET_PATH` in hook environments; `herdr agent focus <pane>` is the exact-pane focus command; herdr's kitty tab is titled `herdr`.
- kitty requires `allow_remote_control yes` + `listen_on unix:/tmp/kitty-remote.sock` in `kitty.conf` (symlinked from `~/dotfiles/kitty/kitty.conf`) for the click chain to reach it.
- The live hooks live in `~/.claude/settings.json` (`Notification` + `Stop`), pointing at this repo's `dist/cli.js`.
