import { appendFileSync } from 'node:fs';
import type { CompanyEvent, CompanyEventPayload } from '@olympus/shared';

type Listener = (event: CompanyEvent) => void;

const MAX_EVENTS_IN_MEMORY = 5000;

/** Append-only event log: kept in memory for the dashboard, mirrored to a JSONL file. */
export class EventBus {
  private events: CompanyEvent[] = [];
  private nextId = 1;
  private listeners = new Set<Listener>();

  constructor(private readonly logFile: string | null = null) {}

  emit(payload: CompanyEventPayload): CompanyEvent {
    const event = { ...payload, id: this.nextId++, ts: new Date().toISOString() } as CompanyEvent;
    this.events.push(event);
    if (this.events.length > MAX_EVENTS_IN_MEMORY) this.events.shift();
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, JSON.stringify(event) + '\n');
      } catch (err) {
        console.error('[events] could not write event log:', err);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[events] listener failed:', err);
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit: number): CompanyEvent[] {
    return this.events.slice(-limit);
  }

  all(): readonly CompanyEvent[] {
    return this.events;
  }
}
