import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Event } from "../event.js";
import { resolveSound, type Config } from "../config.js";
import type { Channel } from "./base.js";
import { defaultExec, type Exec } from "./exec.js";

const execFileAsync = promisify(execFile);

export function appleScriptEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, " ");
}

type WriteTty = (sequence: string) => void;

function defaultWriteTty(sequence: string): void {
  writeFileSync("/dev/tty", sequence);
}

/** Terminal app name for click-to-focus, detected from the hook environment. */
export function terminalAppName(env: NodeJS.ProcessEnv): string | undefined {
  if (isKitty(env)) return "kitty";
  switch (env.TERM_PROGRAM) {
    case "iTerm.app": return "iTerm";
    case "Apple_Terminal": return "Terminal";
    case "ghostty": return "Ghostty";
    default: return undefined;
  }
}

function isKitty(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.KITTY_WINDOW_ID || env.KITTY_PID
    || env.TERM === "xterm-kitty" || env.TERM_PROGRAM === "kitty",
  );
}

interface NotifierOptions {
  sound: boolean;
  paneId?: string;
  terminalApp?: string;
  kittySocket?: string;
  windowId?: string;
  tabTitle?: string;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shell chain run when the notification is clicked: exact kitty window,
 * herdr's tab inside it, then the exact herdr pane. */
function buildFocusChain(opts: NotifierOptions): string | undefined {
  const steps: string[] = [];
  if (opts.kittySocket && opts.windowId) {
    const fallback = opts.terminalApp ? ` || open -a ${opts.terminalApp}` : "";
    steps.push(`kitty @ --to ${opts.kittySocket} focus-window --match id:${opts.windowId}${fallback}`);
    if (opts.tabTitle) {
      steps.push(
        `kitty @ --to ${opts.kittySocket} focus-tab` +
        ` --match window_id:${opts.windowId}` +
        ` --match title:^${escapeRegex(opts.tabTitle)}$`,
      );
    }
  } else if (opts.terminalApp) {
    steps.push(`open -a ${opts.terminalApp}`);
  }
  if (opts.paneId) steps.push(`herdr agent focus '${opts.paneId}'`);
  return steps.length > 0 ? steps.join("; ") : undefined;
}

/** terminal-notifier argv; when a herdr pane is known, clicking focuses it. */
export function buildTerminalNotifierArgs(event: Event, opts: NotifierOptions): string[] {
  const args = ["-title", event.title, "-message", event.body];
  if (opts.sound) args.push("-sound", "default");
  const chain = buildFocusChain(opts);
  if (chain) args.push("-execute", chain);
  return args;
}

/** Kitty OSC 99 notification: title payload then body payload. */
export function buildOsc99(event: Event): string {
  const clean = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, " ");
  return `\x1b]99;i=1:d=0;${clean(event.title)}\x1b\\\x1b]99;i=1:d=1;${clean(event.body)}\x1b\\`;
}

type GetTabTitle = (paneId: string) => Promise<string | undefined>;

/** Snapshot herdr's terminal (tab) title for the pane, best-effort. */
async function defaultGetTabTitle(paneId: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("herdr", ["agent", "get", paneId], { timeout: 1500 });
    const parsed = JSON.parse(stdout) as { result?: { agent?: { terminal_title?: unknown } } };
    const title = parsed?.result?.agent?.terminal_title;
    return typeof title === "string" && title ? title : undefined;
  } catch {
    return undefined;
  }
}

export function createDarwinChannel(
  config: Config,
  exec: Exec = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
  writeTty: WriteTty = defaultWriteTty,
  getTabTitle: GetTabTitle = defaultGetTabTitle,
): Channel {
  return {
    name: "desktop",
    async deliver(event: Event): Promise<boolean> {
      const sound = resolveSound(config, event.type);
      const paneId = env.HERDR_PANE_ID ? String(env.HERDR_PANE_ID) : undefined;
      const terminalApp = config.channels.desktop.terminalApp ?? terminalAppName(env);
      const kittySocket = config.channels.desktop.kittySocket;
      const windowId = env.KITTY_WINDOW_ID ? String(env.KITTY_WINDOW_ID) : undefined;

      let tabTitle: string | undefined;
      if (kittySocket && windowId && paneId) {
        try {
          tabTitle = await getTabTitle(paneId);
        } catch { /* best-effort — chain works without the tab step */ }
      }

      // Tier 1: terminal-notifier — the only macOS notification with a click action.
      try {
        await exec("terminal-notifier",
          buildTerminalNotifierArgs(event, { sound, paneId, terminalApp, kittySocket, windowId, tabTitle }));
        return true;
      } catch { /* not installed, or it failed — next tier */ }

      // Tier 2: kitty OSC 99 — clicking raises kitty; no external tools needed.
      if (isKitty(env)) {
        try {
          writeTty(buildOsc99(event));
          return true;
        } catch { /* no controlling tty — next tier */ }
      }

      // Tier 3: osascript banner — always available on macOS, no click action.
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
