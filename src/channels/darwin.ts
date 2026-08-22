import { writeFileSync } from "node:fs";
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

interface NotifierOptions {
  sound: boolean;
  paneId?: string;
  terminalApp?: string;
}

/** terminal-notifier argv; when a herdr pane is known, clicking focuses it. */
export function buildTerminalNotifierArgs(event: Event, opts: NotifierOptions): string[] {
  const args = ["-title", event.title, "-message", event.body];
  if (opts.sound) args.push("-sound", "default");
  if (opts.paneId) {
    const raise = opts.terminalApp ? `open -a ${opts.terminalApp}; ` : "";
    args.push("-execute", `${raise}herdr agent focus '${opts.paneId}'`);
  }
  return args;
}

/** Kitty OSC 99 notification: title payload then body payload. */
export function buildOsc99(event: Event): string {
  const clean = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, " ");
  return `\x1b]99;i=1:d=0;${clean(event.title)}\x1b\\\x1b]99;i=1:d=1;${clean(event.body)}\x1b\\`;
}

export function createDarwinChannel(
  config: Config,
  exec: Exec = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
  writeTty: WriteTty = defaultWriteTty,
): Channel {
  return {
    name: "desktop",
    async deliver(event: Event): Promise<boolean> {
      const sound = resolveSound(config, event.type);
      const paneId = env.HERDR_PANE_ID ? String(env.HERDR_PANE_ID) : undefined;
      const terminalApp = config.channels.desktop.terminalApp ?? terminalAppName(env);

      // Tier 1: terminal-notifier — the only macOS notification with a click action.
      try {
        await exec("terminal-notifier",
          buildTerminalNotifierArgs(event, { sound, paneId, terminalApp }));
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
