/**
 * All messages between server, player laptops, and phone controllers.
 * Transport-agnostic plain JSON.
 *
 * Architecture:
 *   Phone (controller) ──→ Server (authoritative game) ──→ Laptop (render client)
 *   Phone ←── Server (haptics) ←── Server (state)        Laptop ←── Server (snapshots)
 *
 * Connection flow:
 *   1. Laptop connects as role=player → gets slot + token
 *   2. Laptop shows QR code with token
 *   3. Phone scans QR, connects as role=controller, sends token → linked to slot
 *   4. Server runs game, sends snapshots to laptops, haptics to phones
 */

import type { Vec3Tuple, QuatTuple } from './math.js';

// ─── Identity ────────────────────────────────────────────────────────

export type PlayerId = string; // UUID stored in localStorage for reconnect
export type PlayerSlot = 1 | 2;
export type PlayerToken = string; // links a phone to a player's laptop

// ─── Classes ─────────────────────────────────────────────────────────

export type ClassName = 'guardian' | 'striker' | 'mystic' | 'phantom';
export type SaberColor = 'blue' | 'red' | 'green' | 'purple' | 'orange' | 'white';
export type GameState = 'lobby' | 'classSelect' | 'countdown' | 'fighting' | 'roundEnd' | 'matchEnd';
export type HapticEffect = 'clash' | 'hit_landed' | 'got_hit' | 'block' | 'powerup';

// ═══════════════════════════════════════════════════════════════════════
// Phone Controller → Server
// ═══════════════════════════════════════════════════════════════════════

export interface ControllerJoinMsg {
  type: 'controllerJoin';
  playerId: PlayerId;
  token: PlayerToken;
}

export interface OrientationMsg {
  type: 'orientation';
  q: QuatTuple;
  rotRate: [number, number, number];
  t: number;
}

export interface ButtonMsg {
  type: 'button';
  button: 'block' | 'power';
  state: 'down' | 'up';
}

export interface ControllerClassSelectMsg {
  type: 'classSelect';
  className: ClassName;
  saberColor: SaberColor;
}

export interface ControllerReadyMsg {
  type: 'ready';
}

export interface CalibrateMsg {
  type: 'calibrate';
  yawOffset: QuatTuple;
}

export type ControllerMsg =
  | ControllerJoinMsg
  | OrientationMsg
  | ButtonMsg
  | ControllerClassSelectMsg
  | ControllerReadyMsg
  | CalibrateMsg;

// ═══════════════════════════════════════════════════════════════════════
// Server → Phone Controller
// ═══════════════════════════════════════════════════════════════════════

export interface ControllerAssignedMsg {
  type: 'controllerAssigned';
  slot: PlayerSlot;
}

export interface GameFullMsg {
  type: 'gameFull';
}

export interface InvalidTokenMsg {
  type: 'invalidToken';
}

export interface HapticMsg {
  type: 'haptic';
  effect: HapticEffect;
}

export interface GameStateMsg {
  type: 'gameState';
  state: GameState;
}

export interface CooldownMsg {
  type: 'cooldown';
  remaining: number;
  total: number;
}

export interface RoundResultMsg {
  type: 'roundResult';
  winner: PlayerSlot;
  scores: [number, number];
}

export interface MatchResultMsg {
  type: 'matchResult';
  winner: PlayerSlot;
}

export type ServerToControllerMsg =
  | ControllerAssignedMsg
  | GameFullMsg
  | InvalidTokenMsg
  | HapticMsg
  | GameStateMsg
  | CooldownMsg
  | RoundResultMsg
  | MatchResultMsg;

// ═══════════════════════════════════════════════════════════════════════
// Player Laptop → Server
// ═══════════════════════════════════════════════════════════════════════

export interface PlayerReadyMsg {
  type: 'ready';
}

export interface PlayerRematchMsg {
  type: 'rematch';
}

/** Debug mode: laptop sends fake controller input for its own slot */
export interface FakeInputMsg {
  type: 'fakeInput';
  msg: OrientationMsg | ButtonMsg;
}

/** Webcam head tracking → character dodge movement */
export interface HeadDodgeMsg {
  type: 'headDodge';
  dx: number;
  dz: number;
}

/** Start a solo test match with a bot opponent */
export interface StartSoloMsg {
  type: 'startSolo';
}

export type PlayerToServerMsg =
  | PlayerReadyMsg
  | PlayerRematchMsg
  | FakeInputMsg
  | HeadDodgeMsg
  | StartSoloMsg;

// ═══════════════════════════════════════════════════════════════════════
// Server → Player Laptop
// ═══════════════════════════════════════════════════════════════════════

export interface PlayerAssignedMsg {
  type: 'playerAssigned';
  slot: PlayerSlot;
  token: PlayerToken;
  lanOrigin?: string;
}

export interface WaitingForOpponentMsg {
  type: 'waitingForOpponent';
}

export interface ControllerConnectedMsg {
  type: 'controllerConnected';
  slot: PlayerSlot;
  connected: boolean;
}

/** Sent every tick during gameplay — the full game state for rendering */
export interface SnapshotMsg {
  type: 'snapshot';
  state: GameState;
  round: number;
  scores: [number, number];
  countdown?: number;
  fighters: [FighterSnapshot, FighterSnapshot];
  events: GameEvent[];
}

export interface FighterSnapshot {
  position: Vec3Tuple;
  saberQ: QuatTuple;
  bladeTip: Vec3Tuple;
  bladeBase: Vec3Tuple;
  tipSpeed: number;
  blocking: boolean;
  stunned: boolean;
  abilityActive: boolean;
  /** Seconds until the power can be used again (0 = ready) */
  cooldownRemaining: number;
  className: ClassName;
  saberColor: SaberColor;
  bladeScale: number;
  onPlatform: boolean;
  fallen: boolean;
}

export type GameEvent =
  | { kind: 'clash'; point: Vec3Tuple }
  | {
    kind: 'hit'; attacker: PlayerSlot; defender: PlayerSlot; point: Vec3Tuple; speed: number;
    /** 0..1 swing power that scaled the knockback; smash = an all-out swing */
    power: number; smash: boolean;
  }
  | { kind: 'block'; blocker: PlayerSlot; point: Vec3Tuple }
  | { kind: 'fall'; slot: PlayerSlot }
  | { kind: 'shockwave'; slot: PlayerSlot; position: Vec3Tuple }
  | { kind: 'blink'; slot: PlayerSlot; from: Vec3Tuple; to: Vec3Tuple; color: string }
  | { kind: 'overcharge'; slot: PlayerSlot }
  | { kind: 'barrier'; slot: PlayerSlot };

export type ServerToPlayerMsg =
  | PlayerAssignedMsg
  | WaitingForOpponentMsg
  | ControllerConnectedMsg
  | GameStateMsg
  | SnapshotMsg
  | RoundResultMsg
  | MatchResultMsg;
