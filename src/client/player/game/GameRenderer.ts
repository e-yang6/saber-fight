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
import { createArena } from './Arena.js';
import { Fighter } from './Fighter.js';
import { Saber } from './Saber.js';
import { VFX } from './VFX.js';
import * as Audio from './Audio.js';
import { SABER_COLORS, CLASS_CONFIGS } from '@shared/classes.js';

const FP_SABER_REST = new THREE.Vector3(0.3, -0.4, -0.3);
/** Raised and pulled toward the center so the cross-body guard fills the view */
const FP_SABER_GUARD = new THREE.Vector3(0.15, -0.22, -0.45);
const BASE_FOV = 70;

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
  private lastMyPos = new THREE.Vector3();
  private lastOppPos = new THREE.Vector3();

  private mySaberWorldQ = new THREE.Quaternion();
  private myBlocking = false;
  private fpGuardBlend = 0;
  private fovKick = 0;
  private bladeSparkAccum = 0;
  private calloutEl = document.getElementById('ability-callout');
  private calloutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: HTMLCanvasElement, mySlot: PlayerSlot) {
    this.mySlot = mySlot;

    const initSign = mySlot === 1 ? -1 : 1;
    this.lastMyPos.set(0, 0, initSign * 4);
    this.lastOppPos.set(0, 0, -initSign * 4);

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
    this.scene.fog = new THREE.FogExp2(0x112233, 0.015);

    // ─── Camera (first-person) ───────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);

    // ─── Bloom ──────────────────────────────────────────────────────
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5, 0.4, 0.2,
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
    this.myBlocking = myFighterData.blocking;
    const sq = myFighterData.saberQ;
    this.mySaberWorldQ.set(sq[0], sq[1], sq[2], sq[3]);

    // Save latest positions
    const myPos = myFighterData.position;
    const oppPos = oppFighterData.position;
    this.lastMyPos.set(myPos[0], myPos[1], myPos[2]);
    this.lastOppPos.set(oppPos[0], oppPos[1], oppPos[2]);

    // Track countdown state for intro animation
    const inCountdown = snap.state === 'countdown';
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

    // Update camera pose
    this.updateCamera(performance.now());

    // Sound: only during active gameplay (prevents spam after round end)
    const active = snap.state === 'fighting' || snap.state === 'countdown';
    if (active) {
      Audio.updateHum(this.mySlot, myFighterData.tipSpeed);
      Audio.updateHum(oppSlot, oppFighterData.tipSpeed);
      if (myFighterData.tipSpeed > 3) Audio.playSwoosh(myFighterData.tipSpeed);
      if (oppFighterData.tipSpeed > 3) Audio.playSwoosh(oppFighterData.tipSpeed);
    } else {
      Audio.updateHum(this.mySlot, 0);
      Audio.updateHum(oppSlot, 0);
    }

    // Handle game events (VFX + audio)
    for (const event of snap.events) {
      this.handleEvent(event);
    }
  }

  private handleEvent(event: GameEvent): void {
    switch (event.kind) {
      case 'clash': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnClashSparks(p, 35);
        this.vfx.triggerScreenShake(1.2);
        this.vfx.screenFlash(0xffaa44, 0.2, 0.1);
        Audio.playClash();
        break;
      }
      case 'hit': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnHitFlash(p);
        this.vfx.triggerScreenShake(1.0 + event.speed * 0.15);
        Audio.playHit();
        break;
      }
      case 'block': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnBlockFlash(p);
        this.vfx.spawnClashSparks(p, 15);
        this.vfx.triggerScreenShake(0.6);
        Audio.playBlock();
        break;
      }
      case 'fall': {
        const f = this.fighters.get(event.slot);
        if (f) {
          this.vfx.spawnSplash(f.group.position);
          Audio.playSplash();
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

  /** Update camera position and orientation: 360-degree crane intro or first-person */
  private updateCamera(now: number): void {
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
      this.camera.lookAt(oppHead.x, oppHead.y, oppHead.z);

      this.camera.fov = BASE_FOV + this.fovKick;

      if (this.headOffset.lengthSq() > 0.0001) {
        this.applyOffAxisProjection();
      } else {
        this.camera.updateProjectionMatrix();
      }
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

    this.fovKick *= Math.max(0, 1 - 5 * dt);
    if (this.fovKick < 0.05) this.fovKick = 0;

    // Smooth camera updates (intro orbit or first-person)
    this.updateCamera(now);

    // FP saber: world-space orientation → camera-local, after the camera has moved this frame
    this.fpSaberGroup.quaternion.copy(this.camera.quaternion).invert().multiply(this.mySaberWorldQ);
    this.fpGuardBlend += (this.myBlocking ? 1 : -1) * dt / 0.1;
    this.fpGuardBlend = Math.min(1, Math.max(0, this.fpGuardBlend));
    this.fpSaberGroup.position.lerpVectors(FP_SABER_REST, FP_SABER_GUARD, this.fpGuardBlend);
    this.fpSaber.update(dt);

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

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}
