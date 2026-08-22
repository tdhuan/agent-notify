import { connect } from "node:net";
import type { Event } from "../event.js";
import type { Config } from "../config.js";
import type { Channel } from "./base.js";

const SOCKET_TIMEOUT_MS = 500;

export function createHerdrChannel(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): Channel {
  return {
    name: "herdr",
    async deliver(event: Event): Promise<boolean> {
      const socketEnv = config.channels.herdr.socketEnv ?? "HERDR_SOCKET_PATH";
      const socketPath = env[socketEnv];
      const paneId = env["HERDR_PANE_ID"];
      if (!socketPath || !paneId) return false;

      const now = Date.now();
      const request = {
        id: `agent-notify:${now}`,
        method: "agent-notify.event",
        params: {
          pane_id: paneId,
          source: "agent-notify:claude",
          agent: "claude",
          event: event.type,
          title: event.title,
          body: event.body,
          seq: now,
        },
      };

      return new Promise<boolean>((resolve) => {
        const socket = connect(socketPath);
        const finish = (ok: boolean): void => {
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(SOCKET_TIMEOUT_MS, () => finish(false));
        socket.on("error", () => finish(false));
        socket.on("connect", () => {
          socket.write(JSON.stringify(request) + "\n");
        });
        socket.on("data", () => finish(true));
      });
    },
  };
}
