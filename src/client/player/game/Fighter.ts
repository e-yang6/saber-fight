/**
 * Visual-only fighter. Applies server snapshots to update the Three.js model.
 * No game logic — just rendering.
 */

import * as THREE from 'three';
import type { PlayerSlot, FighterSnapshot } from '@shared/protocol.js';
import { SABER_COLORS } from '@shared/classes.js';
import { Saber } from './Saber.js';

interface NaiLongPalette { body: number; belly: number; accent: number }

/** One colour scheme per player so the two Nai Longs are easy to tell apart */
const NAI_LONG_PALETTES: Record<PlayerSlot, NaiLongPalette> = {
  1: { body: 0xffd23f, belly: 0xfff2c2, accent: 0xf0a92a }, // classic yellow
  2: { body: 0x7cc8ff, belly: 0xe2f3ff, accent: 0x4a93d9 }, // sky blue
};

/** Body-local hand position: just in front of the belly, close to the server's hilt point */
const HAND_POS = new THREE.Vector3(0.14, 0.86, 0.4);

export class Fighter {
  readonly group = new THREE.Group();
  readonly saber: Saber;
  readonly slot: PlayerSlot;

  private armGroup = new THREE.Group();
  private targetPos = new THREE.Vector3();
  private targetSaberQ = new THREE.Quaternion();
  private bodyYaw = 0;

  /** Lives in the scene, not in `group`, so it still shows when the own body is hidden in FP */
  barrierMesh: THREE.Group | null = null;
  private barrierTime = 0;

  constructor(slot: PlayerSlot) {
    this.slot = slot;
    this.buildNaiLong(NAI_LONG_PALETTES[slot]);

    // Saber pivots at the hand, near where the server places the hilt for collision
    this.armGroup.position.copy(HAND_POS);
    this.group.add(this.armGroup);
    this.saber = new Saber();
    this.armGroup.add(this.saber.group);
  }

  /**
   * Nai Long: a chubby round dragon with a cream belly, big shiny eyes, a wide open smile,
   * rosy cheeks, stubby limbs and a little tail. Built from primitives; faces +Z.
   * Wider than the collision capsule (radius BODY_CAPSULE_RADIUS) for the chubby look.
   */
  private buildNaiLong(p: NaiLongPalette): void {
    const skin = new THREE.MeshStandardMaterial({ color: p.body, roughness: 0.55 });
    const belly = new THREE.MeshStandardMaterial({ color: p.belly, roughness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.2 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x8a1f24, roughness: 0.5 });
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xff7a8a, roughness: 0.5 });
    const cheekMat = new THREE.MeshStandardMaterial({
      color: 0xff8fa3, roughness: 0.8, transparent: true, opacity: 0.85,
    });
    const sphere = new THREE.SphereGeometry(1, 24, 16);

    const blob = (
      mat: THREE.Material, pos: [number, number, number], scale: [number, number, number],
      parent: THREE.Object3D = this.group,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(sphere, mat);
      m.position.set(...pos);
      m.scale.set(...scale);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // One soft pear-shaped body: wide bottom, big round head on top
    blob(skin, [0, 0.62, 0], [0.42, 0.56, 0.4]);
    blob(skin, [0, 1.24, 0.02], [0.36, 0.34, 0.34]);
    blob(belly, [0, 0.6, 0.2], [0.3, 0.4, 0.23]);
    blob(belly, [0, 1.13, 0.22], [0.2, 0.12, 0.14]); // muzzle

    // Big glossy eyes with highlights
    for (const side of [-1, 1]) {
      const eye = blob(black, [side * 0.13, 1.33, 0.29], [0.07, 0.09, 0.05]);
      eye.castShadow = false;
      blob(white, [side * 0.13 + 0.02, 1.37, 0.33], [0.022, 0.026, 0.01]).castShadow = false;
      blob(white, [side * 0.13 - 0.02, 1.3, 0.335], [0.01, 0.012, 0.006]).castShadow = false;
      blob(cheekMat, [side * 0.24, 1.2, 0.25], [0.06, 0.035, 0.03]).castShadow = false;
    }

    // Wide open smile with a tongue
    blob(mouthMat, [0, 1.11, 0.33], [0.11, 0.05, 0.03]).castShadow = false;
    blob(tongueMat, [0, 1.095, 0.345], [0.06, 0.025, 0.02]).castShadow = false;

    // Stubby feet and a short tail
    for (const side of [-1, 1]) {
      blob(accent, [side * 0.17, 0.06, 0.1], [0.13, 0.07, 0.17]);
    }
    const tail = blob(skin, [0, 0.28, -0.42], [0.12, 0.1, 0.2]);
    tail.rotation.x = 0.5;

    // Sword arm: stubby limb from the shoulder to the hand holding the hilt
    const shoulder = new THREE.Vector3(0.3, 1.0, 0.08);
    const limb = (from: THREE.Vector3, to: THREE.Vector3) => {
      const len = from.distanceTo(to);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, len, 4, 10), skin);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      m.castShadow = true;
      this.group.add(m);
    };
    limb(shoulder, HAND_POS);
    blob(skin, [HAND_POS.x, HAND_POS.y, HAND_POS.z], [0.085, 0.085, 0.085]);

    // Off arm resting on the belly
    limb(new THREE.Vector3(-0.3, 1.0, 0.08), new THREE.Vector3(-0.2, 0.78, 0.33));
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

    this.saber.setColor(SABER_COLORS[snap.saberColor]);
    this.saber.setBladeScale(snap.bladeScale);
    this.saber.setBlocking(snap.blocking);
    this.saber.setOvercharged(snap.abilityActive && snap.className === 'striker');

    if (this.barrierMesh) {
      this.barrierMesh.visible = snap.abilityActive && snap.className === 'mystic';
    }
  }

  update(dt: number): void {
    this.group.position.lerp(this.targetPos, 0.5);
    this.group.rotation.y = this.bodyYaw;
    this.armGroup.quaternion.slerp(this.targetSaberQ, 0.7);
    this.saber.update(dt);

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
