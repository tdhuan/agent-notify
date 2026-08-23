import type { Event } from "../event.js";

export interface Channel {
  name: string;
  /** @returns true if delivered, false on any failure. Must never throw. */
  deliver(event: Event): Promise<boolean>;
}
