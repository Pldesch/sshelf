import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@studio/shared';

export interface WsHub {
  broadcast(deckId: string, msg: ServerMessage): void;
}

export interface WsHubOptions {
  /** Messages to send to a socket right after it subscribes to a deck. */
  onSubscribe?: (deckId: string) => ServerMessage[];
}

/** Room-per-deck WebSocket hub. Clients send {type:'subscribe', deckId}. */
export function createWsHub(server: Server, opts: WsHubOptions = {}): WsHub {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map<string, Set<WebSocket>>();

  function join(deckId: string, ws: WebSocket) {
    let set = rooms.get(deckId);
    if (!set) {
      set = new Set();
      rooms.set(deckId, set);
    }
    set.add(ws);
  }

  function leaveAll(ws: WebSocket) {
    for (const set of rooms.values()) set.delete(ws);
  }

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'subscribe') {
        join(msg.deckId, ws);
        const initial = opts.onSubscribe?.(msg.deckId) ?? [];
        for (const m of initial) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
        }
      } else if (msg.type === 'unsubscribe') {
        rooms.get(msg.deckId)?.delete(ws);
      }
    });
    ws.on('close', () => leaveAll(ws));
    ws.on('error', () => leaveAll(ws));
  });

  return {
    broadcast(deckId, msg) {
      const set = rooms.get(deckId);
      if (!set) return;
      const payload = JSON.stringify(msg);
      for (const ws of set) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    },
  };
}
