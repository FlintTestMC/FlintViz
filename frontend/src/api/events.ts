import type { FileChangedEvent } from "./types";

export type EventsListener = (event: FileChangedEvent) => void;

// Opens an EventSource at /api/events and forwards `file-changed` events.
// EventSource auto-reconnects on transport drop, so the returned disposer just
// closes the connection.
export function subscribeEvents(onEvent: EventsListener): () => void {
  const es = new EventSource("/api/events");
  const handler = (e: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(e.data) as FileChangedEvent);
    } catch {
      // Ignore malformed payloads — wire format is fixed; this would only
      // happen if the server emits a non-JSON `file-changed` event.
    }
  };
  es.addEventListener("file-changed", handler as EventListener);
  return () => {
    es.removeEventListener("file-changed", handler as EventListener);
    es.close();
  };
}
