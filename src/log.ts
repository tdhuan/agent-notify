import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { EventType } from "./event.js";

export interface DispatchLog {
  ts: string;
  agent: string;
  eventType: EventType | "skipped";
  sessionId: string;
  input: unknown;
  /** channel name -> "ok" | "error" | "timeout" | "skipped" */
  channels: Record<string, string>;
}

export function defaultLogPath(): string {
  return join(homedir(), ".local", "state", "agent-notify", "log.jsonl");
}

export function appendLog(entry: DispatchLog, path?: string): void {
  try {
    const file = path ?? defaultLogPath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Never let logging break a dispatch.
  }
}
