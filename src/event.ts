export type EventType = "needs_attention" | "turn_done";

export interface Event {
  type: EventType;
  /** Filled by dispatch from config after normalization. */
  title: string;
  body: string;
  sessionId: string;
  cwd: string;
}

export type HookPayload = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const FALLBACK_BODY: Record<EventType, string> = {
  needs_attention: "Claude needs your input",
  turn_done: "",
};

/**
 * Map a Claude Code hook payload onto the internal Event.
 * Returns null when the event should be skipped silently:
 * subagent noise (agent_id present) or unknown event names.
 */
export function normalizeClaude(eventName: string, payload: HookPayload): Event | null {
  const type: EventType | null =
    eventName === "notification" ? "needs_attention"
    : eventName === "stop" ? "turn_done"
    : null;
  if (type === null) return null;
  if (payload["agent_id"]) return null;

  const cwd = str(payload["cwd"]);
  let body = str(payload["message"]) || FALLBACK_BODY[type];
  if (type === "turn_done") {
    const base = cwd.split("/").filter(Boolean).pop() ?? "";
    body = `Finished in ${base}`;
  }

  return { type, title: "", body, sessionId: str(payload["session_id"]), cwd };
}
