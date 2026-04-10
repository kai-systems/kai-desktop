import type WebSocket from 'ws';

/** Connected web UI clients. The web-server module adds/removes entries. */
export const webClients = new Set<WebSocket>();

/**
 * Push an event to every connected web client.
 * Mirrors the shape sent over the WebSocket protocol so the bridge client
 * script can dispatch it to the matching `on<Event>` callback.
 */
export function broadcastToWebClients(channel: string, data?: unknown): void {
  if (webClients.size === 0) return;
  const message = JSON.stringify({ type: 'event', channel, data });
  for (const ws of webClients) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    } catch {
      // Ignore send errors on stale sockets
    }
  }
}
