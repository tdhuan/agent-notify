import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Event } from "../event.js";
import { resolveSound, type Config } from "../config.js";
import type { Channel } from "./base.js";
import { defaultExec, type Exec } from "./exec.js";

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

/** click-focus.sh lives at the repo/plugin root: dist/channels/ → ../.. */
export function defaultClickScriptPath(): string {
  return join(__dirname, "..", "..", "click-focus.sh");
}

interface NotifierOptions {
  sound: boolean;
  paneId?: string;
  /** Absolute path to click-focus.sh; presence enables the click action. */
  clickScript?: string;
}

/** terminal-notifier argv. The click action stays a short, metachar-free
 * script invocation — long compound shell chains do not survive
 * terminal-notifier's click delivery on macOS. */
export function buildTerminalNotifierArgs(event: Event, opts: NotifierOptions): string[] {
  const args = ["-title", event.title, "-message", event.body];
  if (opts.sound) args.push("-sound", "default");
  if (opts.paneId && opts.clickScript) {
    args.push("-execute", `${opts.clickScript} ${opts.paneId}`);
  }
  return args;
}

/** Kitty OSC 99 notification: title payload then body payload. */
export function buildOsc99(event: Event): string {
  const clean = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, " ");
  return `\x1b]99;i=1:d=0;${clean(event.title)}\x1b\\\x1b]99;i=1:d=1;${clean(event.body)}\x1b\\`;
}

export interface ChannelDeps {
  writeTty?: WriteTty;
  clickScriptPath?: string;
}

export function createDarwinChannel(
  config: Config,
  exec: Exec = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
  deps: ChannelDeps = {},
): Channel {
  const writeTty = deps.writeTty ?? defaultWriteTty;
  return {
    name: "desktop",
    async deliver(event: Event): Promise<boolean> {
      const sound = resolveSound(config, event.type);
      const paneId = env.HERDR_PANE_ID ? String(env.HERDR_PANE_ID) : undefined;
      const clickScript = deps.clickScriptPath ?? defaultClickScriptPath();
      const script =
        paneId && clickScript && existsSync(clickScript) ? clickScript : undefined;

      // Tier 1: terminal-notifier — the only macOS notification with a click action.
      try {
        await exec("terminal-notifier",
          buildTerminalNotifierArgs(event, { sound, paneId, clickScript: script }));
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
      const osa =
        `display notification "${appleScriptEscape(event.body)}" ` +
        `with title "${appleScriptEscape(event.title)}"` +
        (sound ? ' sound name "default"' : "");
      try {
        await exec("osascript", ["-e", osa]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
