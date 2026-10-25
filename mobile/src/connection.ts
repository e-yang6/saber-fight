import type { ControllerMsg, ServerToControllerMsg } from '../../src/shared/protocol';

export interface ControllerLink {
  wsUrl: string;
  token: string;
}

/**
 * Turn the laptop's QR link (…/controller/?token=…[&ws=ws://LAN-IP:3000]) into a socket URL.
 * On the LAN the QR points at the self-signed HTTPS port, which the app can't trust, so the
 * laptop adds a plain `ws` origin. Over a tunnel the link has a real certificate: use wss:// on it.
 * Parsed by hand: React Native's URL has no working searchParams.
 */
export function parseControllerLink(data: string): ControllerLink | null {
  const m = /^(https?):\/\/([^/?#]+)[^?#]*\?([^#]*)/i.exec(data.trim());
  if (!m) return null;
  const [, scheme, host, query] = m;
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  if (!params.token) return null;
  const origin = params.ws || `${scheme.toLowerCase() === 'https' ? 'wss' : 'ws'}://${host}`;
  return { wsUrl: `${origin.replace(/\/$/, '')}/ws?role=controller`, token: params.token };
}

interface Handlers {
  onOpen: () => void;
  onClose: () => void;
  onMessage: (msg: ServerToControllerMsg) => void;
}

/** WebSocket that reconnects every 2s until closed by the caller */
export class Connection {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string, private handlers: Handlers) {
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => this.handlers.onOpen();
    ws.onmessage = (ev) => {
      try {
        this.handlers.onMessage(JSON.parse(String(ev.data)) as ServerToControllerMsg);
      } catch { /* ignore malformed */ }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.handlers.onClose();
      this.retry = setTimeout(() => this.open(), 2000);
    };
  }

  send(msg: ControllerMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }
}
