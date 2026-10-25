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
  controller: PlayerConnection | null; // phone
  controllerId: PlayerId | null;
}

export class GameSession {
  private slots: Map<PlayerSlot, SlotInfo> = new Map();

  constructor() {
    this.slots.set(1, { token: this.genToken(), player: null, controller: null, controllerId: null });
    this.slots.set(2, { token: this.genToken(), player: null, controller: null, controllerId: null });
  }

  // ─── Laptop (player) connections ──────────────────────────────────

  /** Laptop connects — assign to first open slot. Returns slot + token or null. */
  playerJoin(ws: WebSocket): { slot: PlayerSlot; token: PlayerToken } | null {
    for (const [slot, info] of this.slots) {
      if (!info.player) {
        info.player = { ws };
        return { slot, token: info.token };
      }
    }
    return null;
  }

  playerDisconnect(ws: WebSocket): void {
    for (const [slot, info] of this.slots) {
      if (info.player?.ws === ws) {
        info.player = null;
        // Don't free the slot immediately — allow reconnect
        // For now, free it (players can rejoin)
        info.token = this.genToken(); // new token on reconnect
        break;
      }
    }
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
    return !!(s1.player && s2.player);
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
