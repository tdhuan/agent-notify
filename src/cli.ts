import { readFileSync } from "node:fs";
import type { Event } from "./event.js";
import { normalizeClaude, type HookPayload } from "./event.js";
import { loadConfig, resolveTitle, enabledChannelNames } from "./config.js";
import { appendLog, defaultLogPath, type DispatchLog } from "./log.js";
import { createChannels } from "./channels/registry.js";
import type { Channel } from "./channels/base.js";

const USAGE = `agent-notify — desktop notifications for coding agents

Usage:
  node dist/cli.js dispatch --agent claude --event notification|stop

Reads the agent's hook payload as JSON on stdin.`;

const CHANNEL_TIMEOUT_MS = 2000;

/** Sentinel returned by withTimeout when the deadline wins the race. */
export const TIMEOUT = Symbol("timeout");

export interface DispatchDeps {
  channels?: Channel[];
  configPath?: string;
  logPath?: string;
  now?: () => string;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}

function parseArgs(argv: string[]): { agent: string; event: string } | null {
  const agentIndex = argv.indexOf("--agent");
  const eventIndex = argv.indexOf("--event");
  if (agentIndex === -1 || eventIndex === -1) return null;
  const agent = argv[agentIndex + 1];
  const event = argv[eventIndex + 1];
  return agent && event ? { agent, event } : null;
}

export async function runDispatch(argv: string[], stdin: string, deps: DispatchDeps = {}): Promise<void> {
  const config = loadConfig(deps.configPath);
  const logPath = deps.logPath ?? defaultLogPath();
  const now = deps.now ?? (() => new Date().toISOString());

  const writeLog = (eventType: DispatchLog["eventType"], input: unknown,
                    channels: Record<string, string>, sessionId: string): void =>
    appendLog({ ts: now(), agent: "claude", eventType, sessionId, input, channels }, logPath);

  let payload: HookPayload = {};
  try {
    payload = stdin.trim() ? (JSON.parse(stdin) as HookPayload) : {};
  } catch {
    writeLog("skipped", stdin, {}, "");
    return;
  }

  const args = parseArgs(argv);
  if (!args || args.agent !== "claude") {
    writeLog("skipped", payload, {}, String(payload["session_id"] ?? ""));
    return;
  }

  const event: Event | null = normalizeClaude(args.event, payload);
  if (!event) {
    writeLog("skipped", payload, {}, String(payload["session_id"] ?? ""));
    return;
  }
  event.title = resolveTitle(config, event.type);

  const wanted = new Set(enabledChannelNames(config, event.type));
  const channels = deps.channels ?? createChannels(config).filter((c) => wanted.has(c.name));

  const results = await Promise.all(
    channels.map(async (channel): Promise<[string, string]> => {
      try {
        const outcome = await withTimeout(channel.deliver(event), CHANNEL_TIMEOUT_MS);
        const status = outcome === TIMEOUT ? "timeout" : outcome === true ? "ok" : "error";
        return [channel.name, status];
      } catch {
        return [channel.name, "error"];
      }
    }),
  );
  writeLog(event.type, payload, Object.fromEntries(results), event.sessionId);
}

async function main(): Promise<void> {
  try {
    let stdin = "";
    try {
      stdin = readFileSync(0, "utf8");
    } catch {
      stdin = "";
    }
    const argv = process.argv.slice(2);
    if (argv[0] !== "dispatch") {
      process.stdout.write(USAGE + "\n");
      return;
    }
    await runDispatch(argv, stdin);
  } catch {
    // Prime directive: never fail the host agent's hook.
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  void main();
}
