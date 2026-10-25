/**
 * Visual-only fighter. Applies server snapshots to update the Three.js model.
 * No game logic — just rendering.
 */

import * as THREE from 'three';
import type { PlayerSlot, FighterSnapshot } from '@shared/protocol.js';
import { SABER_COLORS } from '@shared/classes.js';
import { Saber } from './Saber.js';

interface NaiLongPalette { body: number; belly: number }

/** One colour scheme per player so the two Nai Longs are easy to tell apart */
const NAI_LONG_PALETTES: Record<PlayerSlot, NaiLongPalette> = {
  // Extra saturated: ACES tone mapping + bright daylight wash these out toward cream
  1: { body: 0xffb800, belly: 0xfff0b0 }, // classic yellow
  2: { body: 0x2f9cff, belly: 0xbfe4ff }, // sky blue
};

/** Body-local point where the floating saber hovers: in front of the belly, near the server's hilt point */
const HAND_POS = new THREE.Vector3(0.14, 0.86, 0.4);

/** Exponential smoothing rates (1/s). Higher = snappier; independent of frame rate. */
const POS_SMOOTH = 25;
const SABER_SMOOTH = 35;

/** Frame-rate independent lerp factor */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export class Fighter {
  readonly group = new THREE.Group();
  readonly saber: Saber;
  readonly slot: PlayerSlot;

  /** Everything except the saber; squashed/tilted for hit reactions */
  private body = new THREE.Group();
  private armGroup = new THREE.Group();
  private targetPos = new THREE.Vector3();
  private targetSaberQ = new THREE.Quaternion();
  private bodyYaw = 0;
  private hasSnapshot = false;

  private flashMats: THREE.MeshStandardMaterial[] = [];
  /** Seconds since the last hit reaction; Infinity when idle */
  private reactT = Infinity;
  private reactStrength = 0;

  /** Lives in the scene, not in `group`, so it still shows when the own body is hidden in FP */
  barrierMesh: THREE.Group | null = null;
  private barrierTime = 0;
  private hoverTime = Math.random() * 10;

  constructor(slot: PlayerSlot) {
    this.slot = slot;
    this.group.add(this.body);
    this.buildNaiLong(NAI_LONG_PALETTES[slot]);

    // Floating saber pivots near where the server places the hilt for collision
    this.armGroup.position.copy(HAND_POS);
    this.group.add(this.armGroup);
    this.saber = new Saber();
    this.armGroup.add(this.saber.group);
  }

  /**
   * Nai Long: a chubby bean-shaped dragon whose big domed head flows straight into the body,
   * with a small open mouth and tongue, big green eyes, stubby clawed feet and a cream belly.
   * No arms: the saber floats in front of the belly.
   * Built from primitives; faces +Z.
   * Wider than the collision capsule (radius BODY_CAPSULE_RADIUS) for the chubby look.
   */
  private buildNaiLong(p: NaiLongPalette): void {
    const skin = new THREE.MeshStandardMaterial({ color: p.body, roughness: 0.5 });
    const belly = new THREE.MeshStandardMaterial({ color: p.belly, roughness: 0.6 });
    this.flashMats.push(skin, belly);
    const claw = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a0c10, roughness: 0.7 });
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xff6f91, roughness: 0.45 });
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const iris = new THREE.MeshStandardMaterial({ color: 0x3ba64a, roughness: 0.3 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.2 });
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sphere = new THREE.SphereGeometry(1, 24, 16);

    const blob = (
      mat: THREE.Material, pos: [number, number, number], scale: [number, number, number],
      parent: THREE.Object3D = this.body,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(sphere, mat);
      m.position.set(...pos);
      m.scale.set(...scale);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    /** Three little brown toe claws, pointing along local +Z */
    const claws = (at: THREE.Vector3, size: number) => {
      for (const dx of [-1, 0, 1]) {
        blob(claw, [at.x + dx * size * 1.6, at.y, at.z], [size * 0.7, size * 0.7, size * 1.2]).castShadow = false;
      }
    };

    // Bean body: the big domed head flows straight into a pear-shaped torso
    blob(skin, [0, 0.72, 0], [0.42, 0.7, 0.32]);
    blob(skin, [0, 1.2, 0.02], [0.43, 0.36, 0.36]);
    blob(belly, [0, 0.6, 0.12], [0.32, 0.45, 0.22]);

    // Small open mouth with the tongue just peeking out
    blob(dark, [0, 1.06, 0.33], [0.11, 0.06, 0.04]).castShadow = false;
    const tongue = blob(tongueMat, [0.01, 1.03, 0.36], [0.045, 0.045, 0.02]);
    tongue.rotation.x = -0.3;
    tongue.castShadow = false;

    // Eyes on the front of the dome, turned slightly outward
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.2, 1.28, 0.3);
      eye.rotation.y = side * 0.45;
      this.body.add(eye);
      blob(eyeWhite, [0, 0, 0], [0.11, 0.12, 0.07], eye).castShadow = false;
      blob(iris, [0, -0.005, 0.045], [0.068, 0.076, 0.032], eye).castShadow = false;
      blob(pupil, [0, -0.005, 0.068], [0.036, 0.044, 0.014], eye).castShadow = false;
      blob(shine, [0.022, 0.03, 0.082], [0.016, 0.018, 0.006], eye).castShadow = false;
    }

    // Short stumpy legs with toe claws
    for (const side of [-1, 1]) {
      blob(skin, [side * 0.2, 0.12, 0.06], [0.14, 0.13, 0.15]);
      claws(new THREE.Vector3(side * 0.2, 0.07, 0.2), 0.025);
    }

    // Little tail
    const tail = blob(skin, [0, 0.3, -0.33], [0.12, 0.1, 0.18]);
    tail.rotation.x = 0.5;
  }

  /** Apply server snapshot. Pass opponent position so body faces them. */
  applySnapshot(snap: FighterSnapshot, opponentPos?: [number, number, number]): void {
    this.targetPos.set(snap.position[0], snap.position[1], snap.position[2]);

    // Dynamically face opponent
    if (opponentPos) {
      const dx = opponentPos[0] - snap.position[0];
      const dz = opponentPos[2] - snap.position[2];
      this.bodyYaw = Math.atan2(dx, dz);
    }

    // Convert world-space saber Q to body-local space
    const worldQ = new THREE.Quaternion(snap.saberQ[0], snap.saberQ[1], snap.saberQ[2], snap.saberQ[3]);
    const invBodyQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), -this.bodyYaw
    );
    this.targetSaberQ.copy(invBodyQ.multiply(worldQ));

    if (!this.hasSnapshot) {
      this.hasSnapshot = true;
      this.group.position.copy(this.targetPos);
      this.armGroup.quaternion.copy(this.targetSaberQ);
    }

    this.saber.setColor(SABER_COLORS[snap.saberColor]);
    this.saber.setBladeScale(snap.bladeScale);
    this.saber.setBlocking(snap.blocking);
    this.saber.setOvercharged(snap.abilityActive && snap.className === 'striker');
    this.saber.setStunned(snap.stunned);

    if (this.barrierMesh) {
      this.barrierMesh.visible = snap.abilityActive && snap.className === 'mystic';
    }
  }

  /** Visual recoil: white flash + squash + lean back. `strength` 0..1. */
  react(strength: number): void {
    this.reactT = 0;
    this.reactStrength = Math.min(1, Math.max(0.3, strength));
  }

  update(dt: number): void {
    // Big jumps (respawn, new round) snap instead of gliding across the arena
    if (this.group.position.distanceToSquared(this.targetPos) > 4) {
      this.group.position.copy(this.targetPos);
    } else {
      this.group.position.lerp(this.targetPos, damp(POS_SMOOTH, dt));
    }
    this.group.rotation.y = this.bodyYaw;
    this.armGroup.quaternion.slerp(this.targetSaberQ, damp(SABER_SMOOTH, dt));
    this.hoverTime += dt;
    this.armGroup.position.y = HAND_POS.y + Math.sin(this.hoverTime * 2.5) * 0.025;
    this.saber.update(dt);
    this.updateReaction(dt);

    if (this.barrierMesh?.visible) {
      this.barrierTime += dt;
      const pulse = 0.5 + 0.5 * Math.sin(this.barrierTime * 8);
      this.barrierMesh.position.set(this.group.position.x, this.group.position.y + 1, this.group.position.z);
      this.barrierMesh.rotation.y = this.barrierTime * 0.8;
      this.barrierMesh.scale.setScalar(1 + pulse * 0.05);
      const [fill, wire] = this.barrierMesh.children as THREE.Mesh[];
      (fill.material as THREE.MeshBasicMaterial).opacity = 0.18 + pulse * 0.12;
      (wire.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.4;
    } else {
      this.barrierTime = 0;
    }
  }

  private updateReaction(dt: number): void {
    if (this.reactT === Infinity) return;
    this.reactT += dt;
    const t = this.reactT;
    if (t > 0.6) {
      this.reactT = Infinity;
      this.body.scale.set(1, 1, 1);
      this.body.rotation.x = 0;
      for (const m of this.flashMats) m.emissive.setRGB(0, 0, 0);
      return;
    }
    const s = this.reactStrength;
    // Damped wobble: squash down/wide on impact, then spring back
    const wobble = 0.22 * s * Math.exp(-t * 9) * Math.cos(t * 32);
    this.body.scale.set(1 + wobble * 0.6, 1 - wobble, 1 + wobble * 0.6);
    this.body.rotation.x = -0.35 * s * Math.exp(-t * 7);
    const flash = Math.max(0, 1 - t / 0.12) * 0.9;
    for (const m of this.flashMats) m.emissive.setRGB(flash, flash, flash);
  }

  createBarrier(scene: THREE.Scene): THREE.Group {
    const shared = {
      color: 0xaa66ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    } as const;
    const fill = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 24, 24),
      new THREE.MeshBasicMaterial({ ...shared, opacity: 0.25 }),
    );
    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.22, 2),
      new THREE.MeshBasicMaterial({ ...shared, opacity: 0.8, wireframe: true }),
    );
    this.barrierMesh = new THREE.Group();
    this.barrierMesh.add(fill, wire);
    this.barrierMesh.visible = false;
    scene.add(this.barrierMesh);
    return this.barrierMesh;
  }
}
