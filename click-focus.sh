#!/bin/sh
# agent-notify click handler — focus the kitty tab/pane running the agent.
# Invoked by terminal-notifier's -execute with a minimal environment, so it
# must not rely on PATH, HOME-based lookup, or complex quoting upstream.
#
# Usage: click-focus.sh <target> [tab-title] [socket-base]
#   target = w8:pM     herdr pane id  -> focus herdr's kitty tab, then the pane
#          | kwin:17   kitty window id -> focus that kitty tab + window directly
PANE_ID="$1"
TAB_TITLE="${2:-herdr}"
SOCKET_BASE="${3:-unix:/tmp/kitty-remote.sock}"
LOG="${AGENT_NOTIFY_CLICK_LOG:-/tmp/agent-notify-click.log}"

KITTY_BIN="/Applications/kitty.app/Contents/MacOS/kitty"
HERDR_BIN="$HOME/.local/bin/herdr"
[ -x "$HERDR_BIN" ] || HERDR_BIN="/Users/huantd/.local/bin/herdr"

log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }

# kitty appends its PID to kitty.conf listen_on paths, so the live socket is
# always one of the suffixed candidates under the configured base.
prefix="${SOCKET_BASE#unix:}"
dir="${prefix%/*}"
stem="${prefix##*/}"

# kitty-direct session: focus the tab containing window <id>, then the window
# itself. Attempting focus-tab per socket doubles as instance resolution —
# only the kitty owning the window has a matching tab.
case "$PANE_ID" in
  kwin:*)
    win="${PANE_ID#kwin:}"
    for cand in "$dir/$stem"-*; do
      [ -S "$cand" ] || continue
      if "$KITTY_BIN" @ --to "unix:$cand" focus-tab --match "window_id:$win" 2>/dev/null; then
        "$KITTY_BIN" @ --to "unix:$cand" focus-window --match "id:$win" 2>/dev/null \
          && log "kitty focus ok (win $win, unix:$cand)" \
          || log "focus-window FAILED (win $win, unix:$cand)"
        open -a kitty
        exit 0
      fi
    done
    log "no socket has window $win — raising app only"
    open -a kitty
    exit 0
    ;;
esac

# herdr session: resolve the socket whose kitty hosts the herdr tab.
socket=""
for cand in "$dir/$stem"-*; do
  [ -S "$cand" ] || continue
  if "$KITTY_BIN" @ --to "unix:$cand" ls 2>/dev/null | grep -q "\"title\":.*$TAB_TITLE"; then
    socket="unix:$cand"
    break
  fi
done

if [ -n "$socket" ]; then
  "$KITTY_BIN" @ --to "$socket" focus-tab --match "title:^${TAB_TITLE}$" \
    && log "focus-tab ok ($socket)" || log "focus-tab FAILED ($socket)"
else
  log "no socket with tab '$TAB_TITLE' — raising app only"
fi
# focus-tab selects the tab inside kitty but does not bring kitty above
# other apps — always activate the app when handling a click.
open -a kitty

if [ -n "$PANE_ID" ]; then
  "$HERDR_BIN" agent focus "$PANE_ID" && log "pane focus ok ($PANE_ID)" \
    || log "pane focus FAILED ($PANE_ID)"
fi
