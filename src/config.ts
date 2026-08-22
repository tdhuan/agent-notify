import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventType } from "./event.js";

export interface DesktopChannelConfig { enabled?: boolean; sound?: boolean }
export interface HerdrChannelConfig { enabled?: boolean; socketEnv?: string }
export interface EventConfig { title?: string; sound?: boolean; channels?: string[] }

export interface Config {
  channels: { desktop: DesktopChannelConfig; herdr: HerdrChannelConfig };
  events: Record<EventType, EventConfig>;
}

export const DEFAULT_CONFIG: Config = {
  channels: {
    desktop: { enabled: true, sound: true },
    herdr: { enabled: true, socketEnv: "HERDR_SOCKET_PATH" },
  },
  events: {
    needs_attention: { title: "Claude needs your attention" },
    turn_done: { title: "Claude finished" },
  },
};

export function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base !== "object" || base === null) return override as T;
  if (typeof override !== "object" || Array.isArray(override)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] = key in (base as Record<string, unknown>)
      ? deepMerge(baseValue, value)
      : value;
  }
  return out as T;
}

export function configFilePath(): string {
  return process.env.AGENT_NOTIFY_CONFIG
    ?? join(homedir(), ".config", "agent-notify", "config.json");
}

export function loadConfig(path?: string): Config {
  const file = path ?? configFilePath();
  if (!existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  try {
    return deepMerge(DEFAULT_CONFIG, JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function resolveTitle(config: Config, type: EventType): string {
  return config.events[type].title ?? "";
}

export function resolveSound(config: Config, type: EventType): boolean {
  return config.events[type].sound ?? config.channels.desktop.sound ?? true;
}

export function enabledChannelNames(config: Config, type: EventType): string[] {
  const enabled = (name: string): boolean => {
    const cfg = (config.channels as Record<string, { enabled?: boolean }>)[name];
    return cfg ? cfg.enabled !== false : false;
  };
  const filter = config.events[type].channels;
  if (filter) return filter.filter(enabled);
  return Object.keys(config.channels).filter(enabled);
}
