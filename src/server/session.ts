/**
 * Game session managing two player slots.
 * Each slot has a laptop (player) connection and a phone (controller) connection.
 * A token links the phone to the correct player slot.
 */

import type { WebSocket } from 'ws';
import crypto from 'crypto';
import type {
  PlayerSlot, PlayerToken, PlayerId,
  ServerToPlayerMsg, ServerToControllerMsg, ControllerMsg,
} from '../shared/protocol.js';
import { RECONNECT_TIMEOUT } from '../shared/constants.js';

interface PlayerConnection {
  ws: WebSocket;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

interface SlotInfo {
  token: PlayerToken;
  player: PlayerConnection | null;   // laptop
  /** Browser that owns the laptop seat, so a reload or second tab can't take the other seat */
  laptopId: string | null;
  controller: PlayerConnection | null; // phone
  controllerId: PlayerId | null;
}

export class GameSession {
  private slots: Map<PlayerSlot, SlotInfo> = new Map();

  constructor() {
    this.slots.set(1, { token: this.genToken(), player: null, laptopId: null, controller: null, controllerId: null });
    this.slots.set(2, { token: this.genToken(), player: null, laptopId: null, controller: null, controllerId: null });
  }

  // ─── Laptop (player) connections ──────────────────────────────────

  /**
   * Laptop connects. A browser that already holds a seat takes it back (its old socket is
   * kicked and the token is kept, so the paired phone stays paired). Otherwise it gets
   * the first open seat. Returns null when the game is full.
   */
  playerJoin(ws: WebSocket, laptopId: string | null):
    { slot: PlayerSlot; token: PlayerToken; replaced: WebSocket | null } | null {
    if (laptopId) {
      for (const [slot, info] of this.slots) {
        if (info.laptopId === laptopId && info.player) {
          const replaced = info.player.ws;
          info.player = { ws };
          return { slot, token: info.token, replaced };
        }
      }
    }
    for (const [slot, info] of this.slots) {
      if (!info.player || !isOpen(info.player.ws)) {
        info.player = { ws };
        info.laptopId = laptopId;
        return { slot, token: info.token, replaced: null };
      }
    }
    return null;
  }

  /** Returns true if this socket still owned a seat (false if it was already replaced). */
  playerDisconnect(ws: WebSocket): boolean {
    for (const [, info] of this.slots) {
      if (info.player?.ws === ws) {
        info.player = null;
        info.laptopId = null;
        info.token = this.genToken(); // new token on reconnect
        return true;
      }
    }
    return false;
  }

  // ─── Phone (controller) connections ───────────────────────────────

  /** Phone connects with a token — link to the matching slot. */
  controllerJoin(ws: WebSocket, token: PlayerToken, playerId: PlayerId):
    { slot: PlayerSlot } | { error: string } {

    // Check for reconnect by playerId
    for (const [slot, info] of this.slots) {
      if (info.controllerId === playerId) {
        if (info.controller?.disconnectTimer) {
          clearTimeout(info.controller.disconnectTimer);
        }
        info.controller = { ws };
        return { slot };
      }
    }

    // Find slot by token
    for (const [slot, info] of this.slots) {
      if (info.token === token) {
        if (info.controller && !info.controller.disconnectTimer) {
          return { error: 'Controller already connected for this player' };
        }
        info.controller = { ws };
        info.controllerId = playerId;

        // Notify the laptop
        this.sendToPlayer(slot, { type: 'controllerConnected', slot, connected: true });
        return { slot };
      }
    }

    return { error: 'Invalid token' };
  }

  controllerDisconnect(ws: WebSocket): void {
    for (const [slot, info] of this.slots) {
      if (info.controller?.ws === ws) {
        info.controller.disconnectTimer = setTimeout(() => {
          info.controller = null;
          info.controllerId = null;
          this.sendToPlayer(slot, { type: 'controllerConnected', slot, connected: false });
        }, RECONNECT_TIMEOUT);

        this.sendToPlayer(slot, { type: 'controllerConnected', slot, connected: false });
        break;
      }
    }
  }

  // ─── Routing ──────────────────────────────────────────────────────

  /** Get which slot a controller WebSocket belongs to */
  getControllerSlot(ws: WebSocket): PlayerSlot | null {
    for (const [slot, info] of this.slots) {
      if (info.controller?.ws === ws) return slot;
    }
    return null;
  }

  /** Get which slot a player WebSocket belongs to */
  getPlayerSlot(ws: WebSocket): PlayerSlot | null {
    for (const [slot, info] of this.slots) {
      if (info.player?.ws === ws) return slot;
    }
    return null;
  }

  sendToPlayer(slot: PlayerSlot, msg: ServerToPlayerMsg): void {
    const info = this.slots.get(slot);
    if (info?.player?.ws.readyState === 1) {
      info.player.ws.send(JSON.stringify(msg));
    }
  }

  sendToController(slot: PlayerSlot, msg: ServerToControllerMsg): void {
    const info = this.slots.get(slot);
    if (info?.controller?.ws.readyState === 1) {
      info.controller.ws.send(JSON.stringify(msg));
    }
  }

  broadcastToPlayers(msg: ServerToPlayerMsg): void {
    this.sendToPlayer(1, msg);
    this.sendToPlayer(2, msg);
  }

  broadcastToControllers(msg: ServerToControllerMsg): void {
    this.sendToController(1, msg);
    this.sendToController(2, msg);
  }

  /** Check if both player laptops are connected */
  bothPlayersConnected(): boolean {
    const s1 = this.slots.get(1)!;
    const s2 = this.slots.get(2)!;
    return !!(s1.player && s2.player && isOpen(s1.player.ws) && isOpen(s2.player.ws));
  }

  /** Check if both controllers are connected */
  bothControllersConnected(): boolean {
    const s1 = this.slots.get(1)!;
    const s2 = this.slots.get(2)!;
    return !!(s1.controller && s2.controller);
  }

  hasController(slot: PlayerSlot): boolean {
    return !!this.slots.get(slot)?.controller;
  }

  private genToken(): PlayerToken {
    return crypto.randomBytes(8).toString('hex');
  }
}

function isOpen(ws: WebSocket): boolean {
  return ws.readyState === 1;
}
