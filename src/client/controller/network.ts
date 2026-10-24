import type { ControllerMsg, ServerToControllerMsg } from '@shared/protocol.js';

type MessageHandler = (msg: ServerToControllerMsg) => void;

let ws: WebSocket | null = null;
let handlers: { onMessage: MessageHandler; onOpen: () => void; onClose: () => void } | null = null;

export function connect(h: {
  onMessage: MessageHandler;
  onOpen: () => void;
  onClose: () => void;
}): void {
  handlers = h;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws?role=controller`;

  ws = new WebSocket(url);
  ws.onopen = () => handlers!.onOpen();
  ws.onclose = () => {
    handlers!.onClose();
    setTimeout(() => connect(handlers!), 2000);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as ServerToControllerMsg;
      handlers!.onMessage(msg);
    } catch { /* ignore */ }
  };
}

export function send(msg: ControllerMsg): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
