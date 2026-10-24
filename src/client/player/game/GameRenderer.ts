/**
 * Client-side renderer. No game logic — just renders state from server snapshots.
 * Each player sees first-person from their fighter's eyes.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { PlayerSlot, SnapshotMsg, FighterSnapshot, GameEvent } from '@shared/protocol.js';
import { BODY_CAPSULE_HEIGHT, BODY_CAPSULE_RADIUS, HEAD_RADIUS } from '@shared/constants.js';
import { createArena } from './Arena.js';
import { Fighter } from './Fighter.js';
import { Saber } from './Saber.js';
import { VFX } from './VFX.js';
import * as Audio from './Audio.js';
import { SABER_COLORS } from '@shared/classes.js';

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

  constructor(canvas: HTMLCanvasElement, mySlot: PlayerSlot) {
    this.mySlot = mySlot;

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
    opponent.createBarrier();

    // Own body — we don't render it (first person), but we need saber trail
    const self = new Fighter(mySlot);
    self.group.visible = false; // hide own body
    this.fighters.set(mySlot, self);
    this.scene.add(self.group);

    // First-person saber: rendered relative to camera
    this.fpSaber = new Saber('#4488ff');
    this.fpSaberGroup.add(this.fpSaber.group);
    // Position the saber in front of the camera, like an FPS weapon
    this.fpSaberGroup.position.set(0.3, -0.4, -0.3);
    this.camera.add(this.fpSaberGroup);
    this.scene.add(this.camera);
    this.scene.add(this.fpSaber.trail.mesh);

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

    // Update opponent visual
    const opp = this.fighters.get(oppSlot)!;
    opp.applySnapshot(oppFighterData);

    // Update own fighter state (for saber trail, even though body is hidden)
    const self = this.fighters.get(this.mySlot)!;
    self.applySnapshot(myFighterData);

    // Update first-person saber
    this.fpSaber.setColor(SABER_COLORS[myFighterData.saberColor]);
    this.fpSaber.setBladeScale(myFighterData.bladeScale);
    // Apply saber orientation from snapshot to the FP saber
    const sq = myFighterData.saberQ;
    this.fpSaberGroup.quaternion.set(sq[0], sq[1], sq[2], sq[3]);

    // ─── Camera: first-person from own fighter's eyes ─────────────
    const myPos = myFighterData.position;
    const eyeHeight = BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS * 2 + HEAD_RADIUS * 0.5;
    const oppPos = oppFighterData.position;

    // Base camera at eye level, looking toward opponent
    const baseEye = new THREE.Vector3(myPos[0], myPos[1] + eyeHeight, myPos[2]);

    // Apply head tracking parallax offset
    baseEye.add(this.headOffset);

    this.camera.position.copy(baseEye);
    this.camera.lookAt(oppPos[0], oppPos[1] + 1.2, oppPos[2]);

    // Off-axis projection for parallax (Johnny Lee style)
    if (this.headOffset.lengthSq() > 0.0001) {
      this.applyOffAxisProjection();
    } else {
      // Reset to symmetric projection
      this.camera.updateProjectionMatrix();
    }

    // Update saber hum
    Audio.updateHum(this.mySlot, myFighterData.tipSpeed);
    Audio.updateHum(oppSlot, oppFighterData.tipSpeed);

    if (myFighterData.tipSpeed > 3) Audio.playSwoosh(myFighterData.tipSpeed);
    if (oppFighterData.tipSpeed > 3) Audio.playSwoosh(oppFighterData.tipSpeed);

    // Handle game events (VFX + audio)
    for (const event of snap.events) {
      this.handleEvent(event);
    }
  }

  private handleEvent(event: GameEvent): void {
    switch (event.kind) {
      case 'clash': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnClashSparks(p, 25);
        this.vfx.triggerScreenShake(0.8);
        Audio.playClash();
        break;
      }
      case 'hit': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnHitFlash(p);
        this.vfx.triggerScreenShake(0.5 + event.speed * 0.1);
        Audio.playHit();
        break;
      }
      case 'block': {
        const p = new THREE.Vector3(...event.point);
        this.vfx.spawnClashSparks(p, 10);
        this.vfx.triggerScreenShake(0.3);
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
        Audio.playPowerup();
        break;
      }
      case 'blink': {
        const from = new THREE.Vector3(...event.from);
        const to = new THREE.Vector3(...event.to);
        this.vfx.spawnBlinkTrail(from, to, event.color);
        Audio.playPowerup();
        break;
      }
      case 'overcharge':
      case 'barrier':
        Audio.playPowerup();
        break;
    }
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

    // Update FP saber trail
    this.fpSaber.update(dt);

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
