/**
 * Authoritative server-side game engine.
 * Runs physics, collision, combat at 60Hz. Sends snapshots to player laptops.
 */

import { Vec3, Quat } from '../shared/math.js';
import type { Vec3Tuple, QuatTuple } from '../shared/math.js';
import { segmentSegmentDistSq, sweptBladeBodyCheck } from '../shared/collision.js';
import { CLASS_CONFIGS, SABER_COLORS } from '../shared/classes.js';
import type {
  PlayerSlot, GameState, ClassName, SaberColor, HapticEffect,
  FighterSnapshot, GameEvent, SnapshotMsg, OrientationMsg, ButtonMsg,
} from '../shared/protocol.js';
import {
  SWING_SPEED_THRESHOLD, BASE_KNOCKBACK, KNOCKBACK_SPEED_SCALE,
  MAX_KNOCKBACK, KNOCKBACK_FRICTION, HIT_COOLDOWN_MS,
  CLASH_HITSTOP_MS, BLOCK_STUN_MS, BLOCK_ANGLE_TOLERANCE, GUARD_TRANSITION_MS,
  HIT_HITSTOP_MS, CLASH_PUSHBACK, BLOCK_PUSHBACK, GYRO_STALE_MS,
  BLADE_LENGTH, BLADE_RADIUS, HILT_LENGTH,
  BODY_CAPSULE_RADIUS, BODY_CAPSULE_HEIGHT,
  PLATFORM_RADIUS, WATER_LEVEL, FALL_GRAVITY, FALL_START_SPEED,
  FIGHTER_START_DISTANCE, IDEAL_FIGHT_DISTANCE, MIN_FIGHT_DISTANCE, AUTO_ADVANCE_SPEED,
  ROUNDS_TO_WIN,
  COUNTDOWN_SECONDS, ROUND_END_DELAY_MS,
  SLOWMO_DURATION_MS, SLOWMO_FACTOR, SLERP_FACTOR,
} from '../shared/constants.js';

// ─── Server-side fighter state ──────────────────────────────────────

/** Guard pose: blade rolled 90° about the phone's screen normal so it lies across the body */
const GUARD_OFFSET_Q = Quat.fromAxisAngle(0, 0, 1, Math.PI / 2);

class ServerFighter {
  slot: PlayerSlot;
  position = new Vec3();
  velocity = new Vec3();
  saberQ = Quat.identity();
  targetQ = Quat.identity();
  smoothQ = Quat.identity();
  worldSaberQ = Quat.identity();
  bladeTip = new Vec3();
  bladeBase = new Vec3();
  prevTip = new Vec3();
  prevBase = new Vec3();
  tipSpeed = 0;
  /** Smoothed blade-tip speed from position deltas (fallback when there's no gyro, e.g. bot) */
  private positionalSpeed = 0;
  /** Latest phone gyro rate in deg/s as DeviceMotion [alpha=Z, beta=X, gamma=Y], and when it arrived */
  rotRate: [number, number, number] = [0, 0, 0];
  rotRateAt = 0;
  blocking = false;
  /** 0 = normal grip, 1 = fully in guard pose; eased toward `blocking` each tick */
  guardBlend = 0;
  stunned = false;
  stunnedUntil = 0;
  hitImmuneUntil = 0;
  abilityActive = false;
  abilityEnd = 0;
  cooldownEnd = 0;
  className: ClassName = 'guardian';
  saberColor: SaberColor = 'blue';
  bladeScale = 1;
  onPlatform = true;
  fallen = false;
  ready = false;

  constructor(slot: PlayerSlot) {
    this.slot = slot;
    this.resetPosition();
  }

  resetPosition(): void {
    const sign = this.slot === 1 ? -1 : 1;
    this.position.set(0, 0, sign * FIGHTER_START_DISTANCE);
    this.velocity.set(0, 0, 0);
    this.onPlatform = true;
    this.fallen = false;
    this.stunned = false;
    this.hitImmuneUntil = 0;
    this.blocking = false;
    this.guardBlend = 0;
    this.abilityActive = false;
    this.bladeScale = 1;
    this.prevTip.copy(this.bladeTip);
    this.prevBase.copy(this.bladeBase);
  }

  /** Compute blade world positions from saber quaternion + facing toward opponent */
  updateBlade(opponentPos: Vec3): void {
    this.prevTip.copy(this.bladeTip);
    this.prevBase.copy(this.bladeBase);

    // Compute facing direction toward opponent (Y=0 plane)
    const toOpp = Vec3.sub(opponentPos, this.position);
    toOpp.y = 0;
    const dist = Math.sqrt(toOpp.x * toOpp.x + toOpp.z * toOpp.z);
    if (dist > 0.01) {
      toOpp.x /= dist;
      toOpp.z /= dist;
    }

    // Facing quaternion: rotate device -Z forward to point at opponent
    const facingAngle = Math.atan2(-toOpp.x, -toOpp.z);
    const facingQ = Quat.fromYaw(facingAngle);

    // World saber quaternion = facing * phone orientation
    this.worldSaberQ = Quat.multiply(facingQ, this.smoothQ);

    // Guard pose (Wii Sports style): the blade turns across the body, still following the
    // phone so the player can angle the guard. Collision uses this pose too.
    if (this.guardBlend > 0) {
      const g = this.guardBlend;
      const eased = g * g * (3 - 2 * g);
      const guardWorld = Quat.multiply(this.worldSaberQ, GUARD_OFFSET_Q);
      this.worldSaberQ = Quat.slerp(this.worldSaberQ, guardWorld, eased);
    }

    // Shoulder position relative to body
    const shoulderY = BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS;

    // Hilt in front of fighter (toward opponent), offset down from shoulder
    const hiltPos = new Vec3(
      this.position.x + toOpp.x * 0.3,
      this.position.y + shoulderY - 0.4,
      this.position.z + toOpp.z * 0.3,
    );

    // Blade direction from world saber quaternion
    const bladeDir = this.worldSaberQ.rotateVec3(new Vec3(0, 1, 0));

    this.bladeBase.copy(hiltPos).addScaled(bladeDir, HILT_LENGTH);
    this.bladeTip.copy(this.bladeBase).addScaled(bladeDir, BLADE_LENGTH * this.bladeScale);
  }

  /**
   * Tip speed for swing/hit detection. Network bursts make per-tick blade deltas jumpy
   * (fast, zero, fast...), so prefer the phone's gyro: rotation about the device's X and Z
   * axes swings the tip; rotation about Y (the blade axis) only twists it.
   */
  updateTipSpeed(dt: number, now: number): void {
    const raw = this.bladeTip.distanceTo(this.prevTip) / Math.max(dt, 0.001);
    this.positionalSpeed += (raw - this.positionalSpeed) * 0.5;
    let gyroSpeed = 0;
    if (now - this.rotRateAt < GYRO_STALE_MS) {
      const radPerSec = Math.hypot(this.rotRate[0], this.rotRate[1]) * (Math.PI / 180);
      gyroSpeed = radPerSec * (HILT_LENGTH + BLADE_LENGTH * this.bladeScale);
    }
    this.tipSpeed = Math.max(this.positionalSpeed, gyroSpeed);
  }

  getBodyCapsule(): { a: Vec3; b: Vec3; radius: number } {
    const a = new Vec3(this.position.x, this.position.y + BODY_CAPSULE_RADIUS, this.position.z);
    const b = new Vec3(this.position.x, this.position.y + BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS, this.position.z);
    return { a, b, radius: BODY_CAPSULE_RADIUS };
  }

  toSnapshot(): FighterSnapshot {
    return {
      position: this.position.toArray(),
      saberQ: this.worldSaberQ.toArray(),
      bladeTip: this.bladeTip.toArray(),
      bladeBase: this.bladeBase.toArray(),
      tipSpeed: this.tipSpeed,
      blocking: this.blocking,
      stunned: this.stunned,
      abilityActive: this.abilityActive,
      cooldownRemaining: Math.max(0, (this.cooldownEnd - performance.now()) / 1000),
      className: this.className,
      saberColor: this.saberColor,
      bladeScale: this.bladeScale,
      onPlatform: this.onPlatform,
      fallen: this.fallen,
    };
  }
}

// ─── Callback types ─────────────────────────────────────────────────

export interface GameCallbacks {
  sendSnapshot: (slot: PlayerSlot, msg: SnapshotMsg) => void;
  sendHaptic: (slot: PlayerSlot, effect: HapticEffect) => void;
  sendCooldown: (slot: PlayerSlot, remaining: number, total: number) => void;
  broadcastGameState: (state: GameState) => void;
  broadcastRoundResult: (winner: PlayerSlot, scores: [number, number]) => void;
  broadcastMatchResult: (winner: PlayerSlot) => void;
}

// ─── Game Server ────────────────────────────────────────────────────

export class GameServer {
  private fighters: Map<PlayerSlot, ServerFighter> = new Map();
  private state: GameState = 'lobby';
  private scores: [number, number] = [0, 0];
  private round = 0;
  private countdown = 0;
  private hitstopUntil = 0;
  private slowmoUntil = 0;
  private roundEndTimeout: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private events: GameEvent[] = [];
  private pendingEvents: GameEvent[] = [];
  private cb: GameCallbacks;
  private soloMode = false;
  private botTime = 0;

  constructor(cb: GameCallbacks) {
    this.cb = cb;
    this.fighters.set(1, new ServerFighter(1));
    this.fighters.set(2, new ServerFighter(2));
  }

  start(): void {
    this.lastTick = performance.now();
    this.tickInterval = setInterval(() => this.tick(), 1000 / 60);
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.roundEndTimeout) clearTimeout(this.roundEndTimeout);
  }

  getState(): GameState {
    return this.state;
  }

  // ─── Input handling ────────────────────────────────────────────────

  handleOrientation(slot: PlayerSlot, msg: OrientationMsg): void {
    const f = this.fighters.get(slot)!;
    f.targetQ.set(msg.q[0], msg.q[1], msg.q[2], msg.q[3]);
    if (msg.rotRate) {
      f.rotRate = msg.rotRate;
      f.rotRateAt = performance.now();
    }
  }

  handleButton(slot: PlayerSlot, msg: ButtonMsg): void {
    const f = this.fighters.get(slot)!;
    if (msg.button === 'block') {
      f.blocking = msg.state === 'down';
    } else if (msg.button === 'power' && msg.state === 'down') {
      this.activateAbility(slot);
    }
  }

  handleClassSelect(slot: PlayerSlot, className: ClassName, saberColor: SaberColor): void {
    const f = this.fighters.get(slot)!;
    f.className = className;
    f.saberColor = saberColor;
  }

  handleReady(slot: PlayerSlot): void {
    const f = this.fighters.get(slot)!;
    f.ready = true;

    // Check if both ready
    const f1 = this.fighters.get(1)!;
    const f2 = this.fighters.get(2)!;
    if (f1.ready && f2.ready && this.state === 'classSelect') {
      this.startCountdown();
    }
  }

  handleRematch(): void {
    if (this.state === 'matchEnd') {
      this.scores = [0, 0];
      this.round = 0;
      const f1 = this.fighters.get(1)!;
      const f2 = this.fighters.get(2)!;
      f1.ready = false;
      f2.ready = false;
      if (this.soloMode) {
        f2.ready = true;
      }
      this.setState('classSelect');
    }
  }

  /** Start solo mode — bot controls player 2 */
  startSolo(): void {
    this.soloMode = true;
    const bot = this.fighters.get(2)!;
    bot.className = 'striker';
    bot.saberColor = 'red';
    bot.ready = true;
    this.setState('classSelect');
  }

  /** Move fighter position (for head tracking dodge from laptop) */
  moveFighter(slot: PlayerSlot, dx: number, dz: number): void {
    if (this.state !== 'fighting') return;
    const f = this.fighters.get(slot)!;
    const speed = CLASS_CONFIGS[f.className].stats.moveSpeed;
    f.position.x += dx * speed;
    f.position.z += dz * speed;
    // Clamp to platform
    const dist = Math.sqrt(f.position.x ** 2 + f.position.z ** 2);
    if (dist > PLATFORM_RADIUS * 0.9 && f.onPlatform) {
      const s = (PLATFORM_RADIUS * 0.9) / dist;
      f.position.x *= s;
      f.position.z *= s;
    }
  }

  // ─── State transitions ────────────────────────────────────────────

  startClassSelect(): void {
    this.setState('classSelect');
  }

  /** Abandon the current session (a laptop left) and wait for players again */
  resetToLobby(): void {
    if (this.roundEndTimeout) clearTimeout(this.roundEndTimeout);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.roundEndTimeout = null;
    this.countdownTimer = null;
    this.soloMode = false;
    this.scores = [0, 0];
    this.round = 0;
    for (const f of this.fighters.values()) {
      f.ready = false;
      f.blocking = false;
      f.resetPosition();
    }
    this.setState('lobby');
  }

  private setState(state: GameState): void {
    this.state = state;
    this.cb.broadcastGameState(state);
  }

  private startCountdown(): void {
    this.round++;
    this.countdown = COUNTDOWN_SECONDS;
    this.setState('countdown');

    const f1 = this.fighters.get(1)!;
    const f2 = this.fighters.get(2)!;
    f1.resetPosition();
    f2.resetPosition();

    const tick = () => {
      this.countdown--;
      if (this.countdown > 0) {
        this.countdownTimer = setTimeout(tick, 1000);
      } else {
        this.countdownTimer = null;
        this.setState('fighting');
      }
    };
    this.countdownTimer = setTimeout(tick, 1000);
  }

  // ─── Game tick ────────────────────────────────────────────────────

  private tick(): void {
    const now = performance.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    dt = Math.min(dt, 1 / 30);

    // Time scaling for hitstop/slowmo
    let timeScale = 1;
    if (now < this.hitstopUntil) timeScale = 0;
    else if (now < this.slowmoUntil) timeScale = SLOWMO_FACTOR;
    const scaledDt = dt * timeScale;

    // Events raised between ticks (abilities fire from input handlers) go out with this snapshot
    this.events = this.pendingEvents;
    this.pendingEvents = [];

    const f1 = this.fighters.get(1)!;
    const f2 = this.fighters.get(2)!;

    // Smooth saber orientations
    f1.smoothQ.slerp(f1.targetQ, SLERP_FACTOR);
    f2.smoothQ.slerp(f2.targetQ, SLERP_FACTOR);

    const guardStep = (dt * 1000) / GUARD_TRANSITION_MS;
    for (const f of [f1, f2]) {
      f.guardBlend = Math.min(1, Math.max(0, f.guardBlend + (f.blocking ? guardStep : -guardStep)));
    }

    // Bot AI for solo mode
    if (this.soloMode && this.state === 'fighting') {
      this.updateBot(f2, f1, dt);
    }

    // Update blade positions (pass opponent pos for facing direction)
    f1.updateBlade(f2.position);
    f2.updateBlade(f1.position);

    // Compute tip speed
    f1.updateTipSpeed(dt, now);
    f2.updateTipSpeed(dt, now);

    // Combat (only during fighting)
    if (this.state === 'fighting' && now >= this.hitstopUntil) {
      this.checkCombat(f1, f2, now);
    }

    // Physics
    this.updatePhysics(f1, scaledDt, now);
    this.updatePhysics(f2, scaledDt, now);

    // Wii Sports-style auto-advance: keep fighters at ideal distance
    if (this.state === 'fighting' && f1.onPlatform && f2.onPlatform) {
      this.autoMaintainDistance(f1, f2, scaledDt);
    }

    // Check falls
    if (this.state === 'fighting') {
      this.checkFall(f1, now);
      this.checkFall(f2, now);
    }

    // Cooldowns
    for (const f of [f1, f2]) {
      const cfg = CLASS_CONFIGS[f.className];
      const remaining = Math.max(0, (f.cooldownEnd - now) / 1000);
      this.cb.sendCooldown(f.slot, remaining, cfg.ability.cooldown);
    }

    // Ability expiry
    for (const f of [f1, f2]) {
      if (f.abilityActive && now > f.abilityEnd) {
        f.abilityActive = false;
        f.bladeScale = 1;
      }
    }

    // Stun recovery
    for (const f of [f1, f2]) {
      if (f.stunned && now > f.stunnedUntil) f.stunned = false;
    }

    // Send snapshots to both players
    const snapshot: SnapshotMsg = {
      type: 'snapshot',
      state: this.state,
      round: this.round,
      scores: this.scores,
      countdown: this.state === 'countdown' ? this.countdown : undefined,
      fighters: [f1.toSnapshot(), f2.toSnapshot()],
      events: this.events,
    };
    this.cb.sendSnapshot(1, snapshot);
    this.cb.sendSnapshot(2, snapshot);
  }

  // ─── Combat ────────────────────────────────────────────────────────

  private checkCombat(f1: ServerFighter, f2: ServerFighter, now: number): void {
    // Blade vs blade (clash)
    const bladeCheck = segmentSegmentDistSq(
      f1.bladeBase, f1.bladeTip,
      f2.bladeBase, f2.bladeTip,
    );
    const clashDist = BLADE_RADIUS * 4;
    if (bladeCheck.distSq < clashDist * clashDist) {
      if (f1.tipSpeed > SWING_SPEED_THRESHOLD * 0.5 && f2.tipSpeed > SWING_SPEED_THRESHOLD * 0.5) {
        const mid = Vec3.lerp(bladeCheck.pointA, bladeCheck.pointB, 0.5);
        this.resolveClash(f1, f2, mid, now);
        return;
      }
    }

    // Blade vs body
    this.checkBladeVsBody(f1, f2, now);
    this.checkBladeVsBody(f2, f1, now);
  }

  private checkBladeVsBody(attacker: ServerFighter, defender: ServerFighter, now: number): void {
    if (attacker.stunned || attacker.tipSpeed < SWING_SPEED_THRESHOLD) return;
    if (now < defender.hitImmuneUntil) return;

    const body = defender.getBodyCapsule();
    const swept = sweptBladeBodyCheck(
      attacker.prevTip, attacker.prevBase,
      attacker.bladeTip, attacker.bladeBase,
      body.a, body.b, body.radius,
    );
    if (!swept.hit) return;

    // Mystic barrier auto-block
    if (defender.abilityActive && defender.className === 'mystic') {
      this.resolveBlock(defender, attacker, swept.point, now);
      return;
    }

    // Block check
    if (defender.blocking) {
      const bladeDir = Vec3.sub(defender.bladeTip, defender.bladeBase).normalize();
      const swingDir = Vec3.sub(attacker.bladeTip, attacker.prevTip).normalize();
      if (Math.abs(bladeDir.dot(swingDir)) < BLOCK_ANGLE_TOLERANCE) {
        this.resolveBlock(defender, attacker, swept.point, now);
        return;
      }
    }

    this.resolveHit(attacker, defender, swept.point, now);
  }

  private resolveClash(f1: ServerFighter, f2: ServerFighter, point: Vec3, now: number): void {
    this.hitstopUntil = now + CLASH_HITSTOP_MS;
    this.shove(f1, f2, CLASH_PUSHBACK);
    this.shove(f2, f1, CLASH_PUSHBACK);
    this.events.push({ kind: 'clash', point: point.toArray() });
    this.cb.sendHaptic(1, 'clash');
    this.cb.sendHaptic(2, 'clash');
  }

  private resolveHit(attacker: ServerFighter, defender: ServerFighter, point: Vec3, now: number): void {
    const speed = attacker.tipSpeed;
    const aCfg = CLASS_CONFIGS[attacker.className].stats;
    const dCfg = CLASS_CONFIGS[defender.className].stats;

    let knockback = Math.min(
      MAX_KNOCKBACK,
      BASE_KNOCKBACK + (speed - SWING_SPEED_THRESHOLD) * KNOCKBACK_SPEED_SCALE,
    );
    knockback *= aCfg.knockbackDealt * dCfg.knockbackReceived;
    if (attacker.abilityActive && attacker.className === 'striker') knockback *= 2;

    this.shove(defender, attacker, knockback);
    defender.hitImmuneUntil = now + HIT_COOLDOWN_MS;

    this.hitstopUntil = now + HIT_HITSTOP_MS;
    this.events.push({
      kind: 'hit', attacker: attacker.slot, defender: defender.slot,
      point: point.toArray(), speed,
    });
    this.cb.sendHaptic(attacker.slot, 'hit_landed');
    this.cb.sendHaptic(defender.slot, 'got_hit');
  }

  private resolveBlock(blocker: ServerFighter, attacker: ServerFighter, point: Vec3, now: number): void {
    attacker.stunned = true;
    attacker.stunnedUntil = now + BLOCK_STUN_MS;
    this.shove(attacker, blocker, BLOCK_PUSHBACK);
    this.hitstopUntil = now + CLASH_HITSTOP_MS / 2;
    this.events.push({ kind: 'block', blocker: blocker.slot, point: point.toArray() });
    this.cb.sendHaptic(blocker.slot, 'block');
    this.cb.sendHaptic(attacker.slot, 'clash');
  }

  /** Push `target` horizontally away from `from` by roughly `meters` of slide. */
  private shove(target: ServerFighter, from: ServerFighter, meters: number): void {
    const dir = Vec3.sub(target.position, from.position);
    dir.y = 0;
    dir.normalize();
    target.velocity.addScaled(dir, meters * KNOCKBACK_FRICTION);
  }

  // ─── Physics ───────────────────────────────────────────────────────

  private updatePhysics(f: ServerFighter, dt: number, _now: number): void {
    if (f.fallen) {
      // Bobbing in the bay, chest-deep, until the next round resets position
      f.velocity.set(0, 0, 0);
      f.position.y = WATER_LEVEL - 0.6;
      return;
    }
    if (f.velocity.lengthSq() > 0.001) {
      f.position.addScaled(f.velocity, dt);
      f.velocity.scale(Math.max(0, 1 - KNOCKBACK_FRICTION * dt));
    }
    if (f.onPlatform) {
      f.position.y = 0;
      f.velocity.y = 0;
    } else {
      f.velocity.y -= FALL_GRAVITY * dt;
      f.position.y += f.velocity.y * dt;
    }
  }

  /** Wii Sports-style: auto-close or push apart to maintain ideal fighting distance */
  private autoMaintainDistance(f1: ServerFighter, f2: ServerFighter, dt: number): void {
    const dx = f2.position.x - f1.position.x;
    const dz = f2.position.z - f1.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return;

    const nx = dx / dist;
    const nz = dz / dist;

    if (dist > IDEAL_FIGHT_DISTANCE) {
      // A fighter sliding from knockback gives up ground: only the other one closes the gap,
      // otherwise the pull-back would cancel half of every hit and nobody reaches the edge.
      const f1Sliding = f1.velocity.lengthSq() > 0.04;
      const f2Sliding = f2.velocity.lengthSq() > 0.04;
      const f1Share = f1Sliding === f2Sliding ? 0.5 : f1Sliding ? 0 : 1;
      const gap = dist - IDEAL_FIGHT_DISTANCE;
      const f1Advance = Math.min(AUTO_ADVANCE_SPEED * dt, gap * f1Share);
      const f2Advance = Math.min(AUTO_ADVANCE_SPEED * dt, gap * (1 - f1Share));
      f1.position.x += nx * f1Advance;
      f1.position.z += nz * f1Advance;
      f2.position.x -= nx * f2Advance;
      f2.position.z -= nz * f2Advance;
    } else if (dist < MIN_FIGHT_DISTANCE) {
      const push = Math.min(AUTO_ADVANCE_SPEED * dt, (MIN_FIGHT_DISTANCE - dist) * 0.5);
      f1.position.x -= nx * push;
      f1.position.z -= nz * push;
      f2.position.x += nx * push;
      f2.position.z += nz * push;
    }
  }

  private checkFall(f: ServerFighter, now: number): void {
    const dist = Math.sqrt(f.position.x ** 2 + f.position.z ** 2);
    if (dist > PLATFORM_RADIUS && f.onPlatform) {
      f.onPlatform = false;
      f.velocity.y = -FALL_START_SPEED;
      this.slowmoUntil = now + SLOWMO_DURATION_MS;
    }
    if (f.position.y < WATER_LEVEL && !f.fallen) {
      f.fallen = true;
      this.events.push({ kind: 'fall', slot: f.slot });
      const winner: PlayerSlot = f.slot === 1 ? 2 : 1;
      this.scores[winner - 1]++;
      this.setState('roundEnd');
      this.cb.broadcastRoundResult(winner, this.scores);

      this.roundEndTimeout = setTimeout(() => {
        if (this.scores[winner - 1] >= ROUNDS_TO_WIN) {
          this.setState('matchEnd');
          this.cb.broadcastMatchResult(winner);
        } else {
          this.startCountdown();
        }
      }, ROUND_END_DELAY_MS);
    }
  }

  // ─── Abilities ────────────────────────────────────────────────────

  private updateBot(bot: ServerFighter, human: ServerFighter, dt: number): void {
    this.botTime += dt;
    const t = this.botTime;

    // Saber movement: smooth sine-wave patterns with occasional fast swings
    const swingPhase = Math.sin(t * 1.2) * 0.4;
    const sidePhase = Math.sin(t * 0.7 + 1.5) * 0.3;
    const fastSwing = Math.sin(t * 4.5);
    const attacking = fastSwing > 0.85;
    const speed = attacking ? 3.0 : 1.0;

    const yaw = sidePhase * speed;
    const pitch = (swingPhase + (attacking ? -0.8 : 0)) * speed;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    bot.targetQ.set(cy * sp, sy * cp, -sy * sp, cy * cp);

    // Block periodically (every ~4s, hold for ~0.8s)
    const blockCycle = t % 4.0;
    bot.blocking = blockCycle > 3.0 && blockCycle < 3.8 && !attacking;

    // Use the ability now and then once it's off cooldown (~every 7s on average)
    if (performance.now() >= bot.cooldownEnd && Math.random() < dt / 7) {
      this.activateAbility(bot.slot);
    }

    // Slight lateral drift, only well inside the platform (never clamp: knockback must ring it out)
    const drift = Math.sin(t * 0.5) * 0.3 * dt;
    const nextX = bot.position.x + drift;
    if (Math.sqrt(nextX ** 2 + bot.position.z ** 2) < PLATFORM_RADIUS * 0.8) {
      bot.position.x = nextX;
    }
  }

  private activateAbility(slot: PlayerSlot): void {
    const f = this.fighters.get(slot)!;
    const now = performance.now();
    const cfg = CLASS_CONFIGS[f.className];
    if (this.state !== 'fighting' || now < f.cooldownEnd) return;

    f.cooldownEnd = now + cfg.ability.cooldown * 1000;
    this.cb.sendHaptic(slot, 'powerup');

    const opp = this.fighters.get(slot === 1 ? 2 : 1)!;

    switch (f.className) {
      case 'guardian': {
        const dir = Vec3.sub(opp.position, f.position);
        dir.y = 0;
        dir.normalize();
        opp.velocity.addScaled(dir, MAX_KNOCKBACK * KNOCKBACK_FRICTION);
        this.pendingEvents.push({ kind: 'shockwave', slot, position: f.position.toArray() });
        break;
      }
      case 'striker': {
        f.abilityActive = true;
        f.abilityEnd = now + cfg.ability.duration * 1000;
        f.bladeScale = 1.4;
        this.pendingEvents.push({ kind: 'overcharge', slot });
        break;
      }
      case 'mystic': {
        f.abilityActive = true;
        f.abilityEnd = now + cfg.ability.duration * 1000;
        this.pendingEvents.push({ kind: 'barrier', slot });
        break;
      }
      case 'phantom': {
        const bladeDir = Vec3.sub(f.bladeTip, f.bladeBase).normalize();
        bladeDir.y = 0;
        bladeDir.normalize();
        const from = f.position.toArray() as Vec3Tuple;
        f.position.addScaled(bladeDir, 2.5);
        this.pendingEvents.push({
          kind: 'blink', slot, from, to: f.position.toArray(),
          color: SABER_COLORS[f.saberColor],
        });
        break;
      }
    }
  }
}
