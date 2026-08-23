import type { Event } from "../event.js";
import type { Config } from "../config.js";
import type { Channel } from "./base.js";
import { defaultExec, type Exec } from "./exec.js";

export function createLinuxChannel(_config: Config, exec: Exec = defaultExec): Channel {
  return {
    name: "desktop",
    async deliver(event: Event): Promise<boolean> {
      try {
        await exec("notify-send", ["--app-name=agent-notify", event.title, event.body]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
