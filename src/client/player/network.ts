import type { ServerToPlayerMsg, PlayerToServerMsg } from '@shared/protocol.js';

type MessageHandler = (msg: ServerToPlayerMsg) => void;

let ws: WebSocket | null = null;

export function connectPlayer(onMessage: MessageHandler): void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws?role=player`;

  ws = new WebSocket(url);
  ws.onopen = () => console.log('[player] WebSocket connected');
  ws.onclose = () => {
    console.log('[player] WebSocket closed, reconnecting...');
    setTimeout(() => connectPlayer(onMessage), 2000);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as ServerToPlayerMsg;
      onMessage(msg);
    } catch { /* ignore */ }
  };
}

export function send(msg: PlayerToServerMsg): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
