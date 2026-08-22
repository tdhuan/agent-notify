import type { Config } from "../config.js";
import type { Channel } from "./base.js";
import { createDarwinChannel } from "./darwin.js";
import { createLinuxChannel } from "./linux.js";
import { createHerdrChannel } from "./herdr.js";
import { defaultExec, type Exec } from "./exec.js";

export function createChannels(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exec: Exec = defaultExec,
): Channel[] {
  const channels: Channel[] = [];
  if (config.channels.desktop.enabled !== false) {
    channels.push(
      platform === "darwin"
        ? createDarwinChannel(config, exec)
        : createLinuxChannel(config, exec),
    );
  }
  const socketEnv = config.channels.herdr.socketEnv ?? "HERDR_SOCKET_PATH";
  if (
    config.channels.herdr.enabled !== false &&
    env[socketEnv] &&
    env["HERDR_PANE_ID"]
  ) {
    channels.push(createHerdrChannel(config, env));
  }
  return channels;
}
