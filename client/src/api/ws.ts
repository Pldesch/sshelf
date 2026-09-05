import type { ServerMessage } from '@studio/shared';

export interface WsClient {
  subscribe(deckId: string): void;
  close(): void;
}

/** Auto-reconnecting WebSocket that re-subscribes to the active deck on reconnect. */
export function createWsClient(onMessage: (msg: ServerMessage) => void): WsClient {
  let ws: WebSocket | null = null;
  let deckId: string | null = null;
  let closed = false;
  let retry = 0;

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      if (deckId) ws!.send(JSON.stringify({ type: 'subscribe', deckId }));
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 400 * retry);
    };
    ws.onerror = () => ws?.close();
  }
  connect();

  return {
    subscribe(id) {
      deckId = id;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', deckId: id }));
      }
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
