/**
 * Client-side renderer. No game logic — just renders state from server snapshots.
 * Each player sees first-person from their fighter's eyes.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { PlayerSlot, SnapshotMsg, FighterSnapshot, GameEvent, ClassName } from '@shared/protocol.js';
import { BODY_CAPSULE_HEIGHT, BODY_CAPSULE_RADIUS, HEAD_RADIUS } from '@shared/constants.js';
import { createArena, SKY_HORIZON_COLOR } from './Arena.js';
import { Fighter, damp } from './Fighter.js';
import { Saber } from './Saber.js';
import { VFX } from './VFX.js';
import * as Audio from './Audio.js';
import { SABER_COLORS, CLASS_CONFIGS } from '@shared/classes.js';

const FP_SABER_REST = new THREE.Vector3(0.3, -0.4, -0.3);
/** Raised and pulled toward the center so the cross-body guard fills the view */
const FP_SABER_GUARD = new THREE.Vector3(0.15, -0.22, -0.45);
const BASE_FOV = 70;
/** Smoothing rates (1/s) for snapshot-driven camera and first-person saber */
const CAMERA_SMOOTH = 20;
const FP_SABER_SMOOTH = 45;
/** Swing sound hysteresis: start above SWING_ON, re-arm once back below SWING_OFF */
const SWING_ON = 4.5;
const SWING_OFF = 2.5;
const SWOOSH_COOLDOWN_MS = 140;
/** Main menu orbit around the platform center */
const MENU_ORBIT_RADIUS = 16;
const MENU_ORBIT_HEIGHT = 6;
const MENU_ORBIT_SPEED = 0.12; // rad/s
const MENU_FOV = 55;
const POWER_BOLT_BOTTOM = 22.5;
const POWER_BOLT_HEIGHT = 21;

export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private fighters: Map<PlayerSlot, Fighter> = new Map();
  private vfx: VFX;
  private mySlot: PlayerSlot;
  private animationId = 0;
  private lastTime = 0;

  // For first-person: the player's own saber rendered in front of the camera
  private fpSaber: Saber;
  private fpSaberGroup = new THREE.Group();

  // Head tracking offset for parallax
  private headOffset = new THREE.Vector3();

  // Countdown intro camera animation state
  private isCountdown = false;
  private countdownStartTime = 0;
  private countdownDuration = 3000;
  private lastCountdownVal = 3;
  /** Smoothed per frame toward the snapshot targets below */
  private lastMyPos = new THREE.Vector3();
  private lastOppPos = new THREE.Vector3();
  private targetMyPos = new THREE.Vector3();
  private targetOppPos = new THREE.Vector3();
  private targetSaberWorldQ = new THREE.Quaternion();
  private hasSnapshot = false;
  private menuMode = true;

  // End-game victory / defeat showcase state
  private matchEndMode: 'none' | 'victory' | 'defeat' = 'none';
  private matchEndStartTime = 0;
  private matchEndLight: THREE.SpotLight | null = null;

  private swinging = new Map<PlayerSlot, boolean>();

  private lastSwooshAt = new Map<PlayerSlot, number>();
  /** Camera recoil in meters along the view axis (positive = pushed back) */
  private camKick = 0;
  /** Opponent knocked off: keep looking straight ahead (frozen heading) instead of tracking their fall */
  private oppOffPlatform = false;
  private frozenLookDir = new THREE.Vector3(0, 0, 1);

  private mySaberWorldQ = new THREE.Quaternion();
  private myBlocking = false;
  private fpGuardBlend = 0;
  private fovKick = 0;
  private bladeSparkAccum = 0;
  private calloutEl = document.getElementById('ability-callout');
  private calloutTimer: ReturnType<typeof setTimeout> | null = null;
  private smashEl = document.getElementById('smash');
  private comboEl = document.getElementById('combo');
  private comboCountEl = document.getElementById('combo-count');
  private combo = 0;
  private powerEl = document.getElementById('power');
  private powerLevelEl = document.getElementById('power-level');

  constructor(canvas: HTMLCanvasElement, mySlot: PlayerSlot) {
    this.mySlot = mySlot;

    const initSign = mySlot === 1 ? -1 : 1;
    this.lastMyPos.set(0, 0, initSign * 4);
    this.lastOppPos.set(0, 0, -initSign * 4);
    this.targetMyPos.copy(this.lastMyPos);
    this.targetOppPos.copy(this.lastOppPos);

    // ─── Renderer ────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // ─── Scene ───────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON_COLOR);
    this.scene.fog = new THREE.FogExp2(SKY_HORIZON_COLOR, 0.0025);

    // ─── Camera (first-person) ───────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);

    // ─── Bloom ──────────────────────────────────────────────────────
    // High threshold: in daylight only the saber cores/glows should bloom, not the sky
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.2, 0.4, 0.85,
    ));

    // ─── Arena ──────────────────────────────────────────────────────
    createArena(this.scene);

    // ─── VFX ────────────────────────────────────────────────────────
    this.vfx = new VFX(this.scene);

    // ─── Fighters (opponent is fully visible; own body is hidden in FP) ─
    const opponentSlot: PlayerSlot = mySlot === 1 ? 2 : 1;
    const opponent = new Fighter(opponentSlot);
    this.fighters.set(opponentSlot, opponent);
    this.scene.add(opponent.group);
    this.scene.add(opponent.saber.trail.mesh);
    opponent.createBarrier(this.scene);

    // Own body — hidden in FP, visible during countdown intro
    const self = new Fighter(mySlot);
    self.group.visible = false;
    this.fighters.set(mySlot, self);
    this.scene.add(self.group);
    this.scene.add(self.saber.trail.mesh);
    self.createBarrier(this.scene);

    // First-person saber: rendered relative to camera
    this.fpSaber = new Saber('#4488ff');
    this.fpSaberGroup.add(this.fpSaber.group);
    // Position the saber in front of the camera, like an FPS weapon
    this.fpSaberGroup.position.copy(FP_SABER_REST);
    this.camera.add(this.fpSaberGroup);
    this.scene.add(this.camera);
    this.scene.add(this.fpSaber.trail.mesh);

    // Attach VFX flash plane to camera
    this.vfx.attachToCamera(this.camera);

    // ─── Resize ─────────────────────────────────────────────────────
    window.addEventListener('resize', () => this.onResize());

    Audio.initAudio();
    Audio.startHum(1);
    Audio.startHum(2);
  }

  start(): void {
    this.lastTime = performance.now();
    this.loop();
  }

  /** Set head tracking offset for parallax */
  setHeadOffset(offset: THREE.Vector3): void {
    this.headOffset.copy(offset);
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /** Apply a server snapshot — update all visual state */
  applySnapshot(snap: SnapshotMsg): void {
    const myFighterData = snap.fighters[this.mySlot - 1];
    const oppSlot: PlayerSlot = this.mySlot === 1 ? 2 : 1;
    const oppFighterData = snap.fighters[oppSlot - 1];

    // Update opponent visual (pass my position so opponent body faces me)
    const opp = this.fighters.get(oppSlot)!;
    opp.applySnapshot(oppFighterData, myFighterData.position);

    // Update own fighter state (for saber trail, even though body is hidden)
    const self = this.fighters.get(this.mySlot)!;
    self.applySnapshot(myFighterData, oppFighterData.position);

    // Update first-person saber
    this.fpSaber.setColor(SABER_COLORS[myFighterData.saberColor]);
    this.fpSaber.setBladeScale(myFighterData.bladeScale);
    this.fpSaber.setBlocking(myFighterData.blocking);
    this.fpSaber.setOvercharged(myFighterData.abilityActive && myFighterData.className === 'striker');
    this.fpSaber.setStunned(myFighterData.stunned);
    this.myBlocking = myFighterData.blocking;
    this.updatePowerMeter(myFighterData, snap.state === 'countdown' || snap.state === 'fighting' || snap.state === 'roundEnd');
    const sq = myFighterData.saberQ;
    this.targetSaberWorldQ.set(sq[0], sq[1], sq[2], sq[3]);

    // Snapshot targets; the render loop eases toward them
    const myPos = myFighterData.position;
    const oppPos = oppFighterData.position;
    this.targetMyPos.set(myPos[0], myPos[1], myPos[2]);
    this.targetOppPos.set(oppPos[0], oppPos[1], oppPos[2]);
    const oppOff = !oppFighterData.onPlatform || oppFighterData.fallen;
    if (oppOff && !this.oppOffPlatform) {
      this.frozenLookDir.set(oppPos[0] - myPos[0], 0, oppPos[2] - myPos[2]);
      if (this.frozenLookDir.lengthSq() < 1e-6) this.frozenLookDir.set(0, 0, this.mySlot === 1 ? 1 : -1);
      this.frozenLookDir.normalize();
    }
    this.oppOffPlatform = oppOff;
    if (!this.hasSnapshot) {
      this.hasSnapshot = true;
      this.lastMyPos.copy(this.targetMyPos);
      this.lastOppPos.copy(this.targetOppPos);
      this.mySaberWorldQ.copy(this.targetSaberWorldQ);
    }

    // Track countdown state for intro animation
    const inCountdown = snap.state === 'countdown';
    // Fresh match: don't carry the combo over from the last one
    if (inCountdown && snap.round === 1 && this.combo > 0) this.setCombo(0);
    if (inCountdown) {
      if (!this.isCountdown) {
        this.isCountdown = true;
        this.countdownStartTime = performance.now();
        this.lastCountdownVal = snap.countdown ?? 3;
      } else if (snap.countdown !== undefined && snap.countdown !== this.lastCountdownVal) {
        this.lastCountdownVal = snap.countdown;
        // Align smoothly with server countdown tick (3 -> 0s, 2 -> 1s, 1 -> 2s)
        const expectedElapsed = Math.max(0, (3 - snap.countdown) * 1000);
        this.countdownStartTime = performance.now() - expectedElapsed;
      }
    } else {
      this.isCountdown = false;
      this.countdownStartTime = 0;
    }

    // The showcase starts during the deciding roundEnd (after the sky beam), so only a new round/lobby clears it
    if (snap.state !== 'matchEnd' && snap.state !== 'roundEnd' && this.matchEndMode !== 'none') {
      this.clearMatchEnd();
    }

    // Sound: only during active gameplay (prevents spam after round end)
    const active = snap.state === 'fighting' || snap.state === 'countdown';

    if (active) {
      Audio.updateHum(this.mySlot, myFighterData.tipSpeed);
      Audio.updateHum(oppSlot, oppFighterData.tipSpeed);
      this.detectSwing(this.mySlot, myFighterData.tipSpeed);
      this.detectSwing(oppSlot, oppFighterData.tipSpeed);
    } else {
      Audio.updateHum(this.mySlot, 0);
      Audio.updateHum(oppSlot, 0);
    }

    // Handle game events (VFX + audio)
    for (const event of snap.events) {
      this.handleEvent(event);
    }
  }

  private updatePowerMeter(me: FighterSnapshot, inMatch: boolean): void {
    if (!this.powerEl || !this.powerLevelEl) return;
    this.powerEl.classList.toggle('show', inMatch);
    if (!inMatch) return;
    const ability = CLASS_CONFIGS[me.className].ability;
    const ready = me.cooldownRemaining <= 0;
    const progress = ready ? 1 : 1 - me.cooldownRemaining / ability.cooldown;
    this.powerEl.classList.toggle('ready', ready);
    // The bolt spans y 1.5–22.5 in its 24-unit viewBox; the clip rect rises from the bottom
    const h = progress * POWER_BOLT_HEIGHT;
    this.powerLevelEl.setAttribute('y', (POWER_BOLT_BOTTOM - h).toFixed(2));
    this.powerLevelEl.setAttribute('height', h.toFixed(2));
  }

  /** One swoosh per swing (rising edge with hysteresis), not one per snapshot */
  private detectSwing(slot: PlayerSlot, speed: number): void {
    const swinging = this.swinging.get(slot) ?? false;
    if (!swinging && speed > SWING_ON) {
      this.swinging.set(slot, true);
      const now = performance.now();
      if (now - (this.lastSwooshAt.get(slot) ?? 0) > SWOOSH_COOLDOWN_MS) {
        this.lastSwooshAt.set(slot, now);
        Audio.playSwoosh(speed);
      }
    } else if (swinging && speed < SWING_OFF) {
      this.swinging.set(slot, false);
    }
  }

  private handleEvent(event: GameEvent): void {
    switch (event.kind) {
      case 'clash': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnClashSparks(p, 50);
        this.vfx.triggerScreenShake(1.4);
        this.vfx.screenFlash(0xffaa44, 0.25, 0.1);
        this.camKick = Math.max(this.camKick, 0.12);
        this.fovKick = 4;
        Audio.playClash();
        break;
      }
      case 'hit': {
        const p = new THREE.Vector3(...event.point);
        // Everything scales with swing power so a big swing visibly lands harder
        const strength = event.power;
        const smash = event.smash;
        this.vfx.spawnHitFlash(p, smash ? 1.7 : 0.7 + strength * 0.6);
        this.fighters.get(event.defender)?.react(smash ? 1.3 : strength);
        this.setCombo(event.attacker === this.mySlot ? this.combo + 1 : 0);
        if (event.defender === this.mySlot) {
          // Got hit: rocked backward, view widens, red flash
          this.vfx.triggerScreenShake((1.0 + strength * 1.8) * (smash ? 1.5 : 1));
          this.vfx.screenFlash(0xff3030, smash ? 0.45 : 0.3, smash ? 0.25 : 0.15);
          this.camKick = Math.max(this.camKick, 0.2 + strength * 0.3 + (smash ? 0.2 : 0));
          this.fovKick = 6 + strength * 8 + (smash ? 6 : 0);
        } else {
          // Landed it: short punch-in zoom
          this.vfx.triggerScreenShake((0.5 + strength * 1.0) * (smash ? 1.6 : 1));
          this.fovKick = -(3 + strength * 6 + (smash ? 4 : 0));
          if (smash) this.vfx.screenFlash(0xfff0b0, 0.3, 0.12);
        }
        if (smash) this.showSmash();
        Audio.playHit(strength, smash);
        break;
      }
      case 'block': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnBlockFlash(p);
        this.vfx.spawnClashSparks(p, 30);
        if (event.blocker === this.mySlot) {
          this.vfx.triggerScreenShake(0.5);
        } else {
          // My swing got parried: knocked back and stunned
          this.vfx.triggerScreenShake(1.0);
          this.vfx.screenFlash(0xffffff, 0.2, 0.08);
          this.camKick = Math.max(this.camKick, 0.18);
          this.fovKick = 5;
        }
        Audio.playBlock();
        break;
      }
      case 'fall': {
        const f = this.fighters.get(event.slot);
        const winner = this.fighters.get(event.slot === 1 ? 2 : 1);
        if (f) {
          // Beam in the winner's saber colour (the splash comes with it)
          const color = winner
            ? (winner.saber.bladeGlow.material as THREE.MeshBasicMaterial).color.clone()
            : new THREE.Color(0xffe680);
          this.vfx.spawnSkyBeam(f.group.position, color);
          Audio.playSplash();
          Audio.playSkyBeam();
        }
        break;
      }
      case 'shockwave': {
        this.vfx.spawnShockwave(new THREE.Vector3(...event.position));
        Audio.playShockwave();
        this.fovKick = Math.max(this.fovKick, 10);
        this.showAbilityCallout(event.slot, 'guardian');
        break;
      }
      case 'blink': {
        const from = new THREE.Vector3(...event.from);
        const to = new THREE.Vector3(...event.to);
        this.vfx.spawnBlinkTrail(from, to, event.color);
        Audio.playBlink();
        if (event.slot === this.mySlot) this.fovKick = Math.max(this.fovKick, 18);
        this.showAbilityCallout(event.slot, 'phantom');
        break;
      }
      case 'overcharge': {
        const f = this.fighters.get(event.slot);
        if (f) {
          const color = '#' + (f.saber.bladeGlow.material as THREE.MeshBasicMaterial).color.getHexString();
          this.vfx.spawnOvercharge(f.group.position, color);
        }
        Audio.playOvercharge();
        if (event.slot === this.mySlot) this.fovKick = Math.max(this.fovKick, 6);
        this.showAbilityCallout(event.slot, 'striker');
        break;
      }
      case 'barrier': {
        const f = this.fighters.get(event.slot);
        if (f) {
          this.vfx.spawnBarrier(f.group.position);
        }
        Audio.playBarrier();
        this.showAbilityCallout(event.slot, 'mystic');
        break;
      }
    }
  }

  /** Bottom-middle combo meter: hidden at 0, pops on each hit, catches fire at 3+ */
  private setCombo(n: number): void {
    const grew = n > this.combo;
    this.combo = n;
    if (!this.comboEl || !this.comboCountEl) return;
    this.comboCountEl.textContent = String(n);
    this.comboEl.classList.toggle('show', n > 0);
    this.comboEl.classList.toggle('on-fire', n >= 3);
    if (grew) {
      this.comboEl.classList.remove('bump');
      void this.comboEl.offsetWidth;
      this.comboEl.classList.add('bump');
    }
  }

  /** Comic "SMASH!" pop for an all-out swing that connects */
  private showSmash(): void {
    if (!this.smashEl) return;
    this.smashEl.classList.remove('show');
    void this.smashEl.offsetWidth;
    this.smashEl.classList.add('show');
  }

  /** Brief text line naming who used which ability */
  private showAbilityCallout(slot: PlayerSlot, cls: ClassName): void {
    if (!this.calloutEl) return;
    const who = slot === this.mySlot ? 'You' : 'Opponent';
    this.calloutEl.textContent = `${who}: ${CLASS_CONFIGS[cls].ability.name}`;
    this.calloutEl.classList.remove('show');
    void this.calloutEl.offsetWidth;
    this.calloutEl.classList.add('show');
    if (this.calloutTimer) clearTimeout(this.calloutTimer);
    this.calloutTimer = setTimeout(() => this.calloutEl?.classList.remove('show'), 1800);
  }

  /**
   * Off-axis (asymmetric frustum) projection for head-coupled perspective.
   * Shifts the frustum so the screen appears as a window that you look through.
   */
  private applyOffAxisProjection(): void {
    const near = this.camera.near;
    const fov = this.camera.fov * Math.PI / 180;
    const aspect = this.camera.aspect;

    const top = near * Math.tan(fov / 2);
    const bottom = -top;
    const right = top * aspect;
    const left = -right;

    // Lateral shift proportional to head offset
    const shiftX = this.headOffset.x * near * 0.5;
    const shiftY = this.headOffset.y * near * 0.5;

    this.camera.projectionMatrix.makePerspective(
      left + shiftX, right + shiftX,
      top + shiftY, bottom + shiftY,
      near, this.camera.far,
    );
  }

  /** Main menu: slow orbit around the platform with both fighters on show */
  setMenuMode(on: boolean): void {
    this.menuMode = on;
  }

  /** Update camera position and orientation: menu orbit, 360-degree crane intro or first-person */
  private updateCamera(now: number): void {
    if (this.matchEndMode !== 'none') {
      const self = this.fighters.get(this.mySlot);
      if (self) self.group.visible = true;
      this.fpSaberGroup.visible = false;

      // Fixed dramatic front-facing camera focused on platform center
      const elapsed = (now - this.matchEndStartTime) / 1000;
      const subtleDrift = Math.sin(elapsed * 0.7) * 0.04;

      this.camera.position.set(subtleDrift, 1.25, 3.1);
      this.camera.lookAt(0, 0.95, 0);

      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
      return;
    }

    if (this.menuMode) {
      const theta = (now / 1000) * MENU_ORBIT_SPEED;
      this.camera.position.set(
        MENU_ORBIT_RADIUS * Math.sin(theta),
        MENU_ORBIT_HEIGHT,
        MENU_ORBIT_RADIUS * Math.cos(theta),
      );
      // Narrow windows stack the menu card at the bottom, so lift the platform above it
      this.camera.lookAt(0, this.camera.aspect < 1.25 ? -3.5 : 1.2, 0);
      for (const f of this.fighters.values()) f.group.visible = true;
      this.fpSaberGroup.visible = false;
      this.camera.fov = MENU_FOV;
      this.camera.updateProjectionMatrix();
      return;
    }

    const eyeHeight = BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS * 2 + HEAD_RADIUS * 0.5;
    const baseEye = new THREE.Vector3(this.lastMyPos.x, this.lastMyPos.y + eyeHeight, this.lastMyPos.z);
    const oppHead = new THREE.Vector3(this.lastOppPos.x, this.lastOppPos.y + 1.2, this.lastOppPos.z);

    const self = this.fighters.get(this.mySlot);

    if (this.isCountdown && this.countdownStartTime > 0) {
      const elapsed = (now - this.countdownStartTime) / 1000;
      const progress = Math.min(Math.max(elapsed / (this.countdownDuration / 1000), 0), 1.0);

      // Facing vector from player toward opponent (ground plane)
      const toOpp = new THREE.Vector3().subVectors(oppHead, baseEye);
      toOpp.y = 0;
      if (toOpp.lengthSq() > 0.0001) toOpp.normalize();
      else toOpp.set(0, 0, 1);
      const facingAngle = Math.atan2(toOpp.x, toOpp.z);

      // S-curve smoothstep easing
      const easeProgress = progress * progress * (3 - 2 * progress);

      // 360-degree crane orbit: sweeps around the player, finishing directly behind looking forward
      const theta = facingAngle + Math.PI + (1.0 - easeProgress) * (Math.PI * 2);

      // Radius: begins at 4.6m (framing the full fighter & platform), converges smoothly to 0 at eyes
      const radiusEase = Math.pow(progress, 1.8);
      const radius = THREE.MathUtils.lerp(4.6, 0.0, radiusEase);

      // Height: starts elevated at crane level (eyeHeight + 2.4m), swoops down to exact eye level
      const height = THREE.MathUtils.lerp(eyeHeight + 2.4, eyeHeight, easeProgress);

      const camX = this.lastMyPos.x + radius * Math.sin(theta);
      const camY = this.lastMyPos.y + height;
      const camZ = this.lastMyPos.z + radius * Math.cos(theta);

      // Blend head tracking parallax offset as camera arrives into the head
      if (progress > 0.85) {
        const headBlend = (progress - 0.85) / 0.15;
        this.camera.position.set(
          camX + this.headOffset.x * headBlend,
          camY + this.headOffset.y * headBlend,
          camZ + this.headOffset.z * headBlend,
        );
      } else {
        this.camera.position.set(camX, camY, camZ);
      }

      // Look-at target: starts at arena center between combatants, converges onto opponent's chest
      const arenaCenter = new THREE.Vector3().lerpVectors(this.lastMyPos, this.lastOppPos, 0.35);
      arenaCenter.y += 1.2;
      const lookTarget = new THREE.Vector3().lerpVectors(arenaCenter, oppHead, easeProgress);
      this.camera.lookAt(lookTarget);

      // Avatar & First-person saber visibility:
      // Show full body & world saber during orbit; switch to first-person viewmodel at eye arrival
      const isFirstPerson = progress >= 0.96;
      if (self) self.group.visible = !isFirstPerson;
      this.fpSaberGroup.visible = isFirstPerson;

      // Subtle dynamic FOV sweep (75 to 70)
      this.camera.fov = THREE.MathUtils.lerp(75, 70, easeProgress);
      this.camera.updateProjectionMatrix();
    } else {
      // Standard First-Person Mode
      if (self) self.group.visible = false;
      this.fpSaberGroup.visible = true;

      baseEye.add(this.headOffset);
      this.camera.position.copy(baseEye);
      if (this.oppOffPlatform) {
        this.camera.lookAt(baseEye.clone().addScaledVector(this.frozenLookDir, 10));
      } else {
        this.camera.lookAt(oppHead.x, oppHead.y, oppHead.z);
      }

      this.camera.fov = BASE_FOV + this.fovKick;

      if (this.headOffset.lengthSq() > 0.0001) {
        this.applyOffAxisProjection();
      } else {
        this.camera.updateProjectionMatrix();
      }
    }
  }

  /** Trigger end-game victory celebration or defeat weeping showcase */
  setMatchEnd(isWinner: boolean, scores?: [number, number]): void {
    if (this.matchEndMode !== 'none') return;
    this.matchEndMode = isWinner ? 'victory' : 'defeat';
    this.matchEndStartTime = performance.now();
    this.menuMode = false;

    const self = this.fighters.get(this.mySlot);
    const oppSlot: PlayerSlot = this.mySlot === 1 ? 2 : 1;
    const opp = this.fighters.get(oppSlot);

    if (opp) {
      opp.group.visible = false;
    }

    if (self) {
      self.group.visible = true;
      if (isWinner) {
        self.setCelebration();
        this.vfx.startVictoryCelebration();
        Audio.playVictoryFanfare();
      } else {
        self.setWeeping();
        this.vfx.startTears(() => self.getEyeWorldPositions());
        Audio.playDefeatSound();
      }
    }

    // Add cinematic overhead spotlight for dramatic scene focus
    if (!this.matchEndLight) {
      this.matchEndLight = new THREE.SpotLight(
        isWinner ? 0xffea88 : 0x5588aa,
        isWinner ? 5.0 : 2.8,
        15,
        Math.PI / 4,
        0.5,
      );
      this.matchEndLight.position.set(0, 6, 1.5);
      this.matchEndLight.target.position.set(0, 0, 0);
      this.scene.add(this.matchEndLight);
      this.scene.add(this.matchEndLight.target);
    }
  }

  /** Clear match end mode and restore standard combat camera/pose */
  clearMatchEnd(): void {
    if (this.matchEndMode === 'none') return;
    this.matchEndMode = 'none';

    const self = this.fighters.get(this.mySlot);
    const oppSlot: PlayerSlot = this.mySlot === 1 ? 2 : 1;
    const opp = this.fighters.get(oppSlot);

    if (self) self.resetPose();
    if (opp) opp.group.visible = true;

    this.vfx.clearEndGameVFX();

    if (this.matchEndLight) {
      this.scene.remove(this.matchEndLight.target);
      this.scene.remove(this.matchEndLight);
      this.matchEndLight.dispose();
      this.matchEndLight = null;
    }
  }

  private loop = (): void => {
    this.animationId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 1 / 30);
    this.lastTime = now;

    // Update VFX
    this.vfx.update(dt);

    // Update fighters (visual interpolation)
    for (const f of this.fighters.values()) {
      f.update(dt);
    }

    // Ease camera anchors and own saber toward the latest snapshot; snap on teleports/new rounds
    this.easeToward(this.lastMyPos, this.targetMyPos, dt);
    this.easeToward(this.lastOppPos, this.targetOppPos, dt);
    this.mySaberWorldQ.slerp(this.targetSaberWorldQ, damp(FP_SABER_SMOOTH, dt));

    this.fovKick *= Math.exp(-6 * dt);
    if (Math.abs(this.fovKick) < 0.05) this.fovKick = 0;
    this.camKick *= Math.exp(-9 * dt);

    // Smooth camera updates (intro orbit or first-person)
    this.updateCamera(now);
    if (this.camKick > 0.002 && !this.isCountdown && !this.menuMode) this.camera.translateZ(this.camKick);

    // FP saber: world-space orientation → camera-local, after the camera has moved this frame
    if (this.matchEndMode === 'none') {
      this.fpSaberGroup.quaternion.copy(this.camera.quaternion).invert().multiply(this.mySaberWorldQ);
      this.fpGuardBlend += (this.myBlocking ? 1 : -1) * dt / 0.1;
      this.fpGuardBlend = Math.min(1, Math.max(0, this.fpGuardBlend));
      this.fpSaberGroup.position.lerpVectors(FP_SABER_REST, FP_SABER_GUARD, this.fpGuardBlend);
      this.fpSaber.update(dt);
    }


    // Overcharged blades crackle continuously
    this.bladeSparkAccum += dt;
    if (this.bladeSparkAccum > 1 / 30) {
      this.bladeSparkAccum = 0;
      const opp = this.fighters.get(this.mySlot === 1 ? 2 : 1)!;
      if (opp.saber.overcharged) {
        this.vfx.spawnBladeSparks(opp.saber.bladeBase, opp.saber.bladeTip, '#' + (opp.saber.bladeGlow.material as THREE.MeshBasicMaterial).color.getHexString());
      }
      if (this.fpSaber.overcharged && this.fpSaberGroup.visible) {
        this.vfx.spawnBladeSparks(this.fpSaber.bladeBase, this.fpSaber.bladeTip, '#' + (this.fpSaber.bladeGlow.material as THREE.MeshBasicMaterial).color.getHexString());
      }
    }

    // Screen shake
    const shake = this.vfx.getScreenShakeOffset();
    if (shake.lengthSq() > 0) {
      this.camera.position.x += shake.x;
      this.camera.position.y += shake.y;
    }

    this.composer.render();
  };

  private easeToward(current: THREE.Vector3, target: THREE.Vector3, dt: number): void {
    if (current.distanceToSquared(target) > 4) current.copy(target);
    else current.lerp(target, damp(CAMERA_SMOOTH, dt));
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}
