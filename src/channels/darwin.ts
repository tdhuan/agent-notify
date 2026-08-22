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
