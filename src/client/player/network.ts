import type { ServerToPlayerMsg, PlayerToServerMsg } from '@shared/protocol.js';

type MessageHandler = (msg: ServerToPlayerMsg) => void;

let ws: WebSocket | null = null;
/** Set when the server turned us away because both laptop slots are taken */
let rejectedFull = false;
/** A newer tab in this browser took our seat: stop, or the two tabs would keep stealing it */
let replaced = false;

/**
 * One seat per browser, so a reload or a second tab can't count as the second player.
 * Add ?tab (or use ?debug) to make each tab its own player, for testing both seats on one machine.
 */
function laptopId(): string {
  const params = new URLSearchParams(location.search);
  const perTab = params.has('tab') || params.has('debug');
  const store = perTab ? sessionStorage : localStorage;
  let id = store.getItem('nailong-laptop-id');
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    store.setItem('nailong-laptop-id', id);
  }
  return id;
}

export function connectPlayer(onMessage: MessageHandler): void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws?role=player&id=${encodeURIComponent(laptopId())}`;

  ws = new WebSocket(url);
  ws.onopen = () => console.log('[player] WebSocket connected');
  ws.onclose = () => {
    if (replaced) {
      console.log('[player] Opened in another tab; this tab stopped');
      return;
    }
    // Full game: keep checking for a free slot, but not every 2s
    const delay = rejectedFull ? 5000 : 2000;
    console.log(rejectedFull
      ? '[player] Game full (2 laptops already connected), retrying...'
      : '[player] WebSocket closed, reconnecting...');
    rejectedFull = false;
    setTimeout(() => connectPlayer(onMessage), delay);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as ServerToPlayerMsg;
      if (msg.type === 'gameFull') rejectedFull = true;
      if (msg.type === 'replaced') replaced = true;
      onMessage(msg);
    } catch { /* ignore */ }
  };
}

export function send(msg: PlayerToServerMsg): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
