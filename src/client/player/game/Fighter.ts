/**
 * Visual-only fighter. Applies server snapshots to update the Three.js model.
 * No game logic — just rendering.
 */

import * as THREE from 'three';
import type { PlayerSlot, FighterSnapshot } from '@shared/protocol.js';
import { SABER_COLORS } from '@shared/classes.js';
import { Saber } from './Saber.js';
import { BODY_CAPSULE_RADIUS, BODY_CAPSULE_HEIGHT, HEAD_RADIUS } from '@shared/constants.js';

export class Fighter {
  readonly group = new THREE.Group();
  readonly saber: Saber;
  readonly slot: PlayerSlot;

  private armGroup = new THREE.Group();
  private targetPos = new THREE.Vector3();
  private targetSaberQ = new THREE.Quaternion();
  private bodyYaw = 0;

  barrierMesh: THREE.Mesh | null = null;

  constructor(slot: PlayerSlot) {
    this.slot = slot;

    const skinColor = slot === 1 ? 0xffccaa : 0xccaa88;
    const shirtColor = slot === 1 ? 0x336699 : 0x993333;

    // Torso
    const torsoGeo = new THREE.CapsuleGeometry(BODY_CAPSULE_RADIUS, BODY_CAPSULE_HEIGHT, 4, 8);
    const torsoMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.7 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = BODY_CAPSULE_HEIGHT / 2 + BODY_CAPSULE_RADIUS;
    torso.castShadow = true;
    this.group.add(torso);

    // Head
    const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.6 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS * 2 + HEAD_RADIUS * 0.8;
    head.castShadow = true;
    this.group.add(head);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.03, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.06, 0.03, HEAD_RADIUS * 0.9);
    head.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.06, 0.03, HEAD_RADIUS * 0.9);
    head.add(rightEye);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.8 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.12, 0.3, 0);
    leftLeg.castShadow = true;
    this.group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.12, 0.3, 0);
    rightLeg.castShadow = true;
    this.group.add(rightLeg);

    // Arm + Saber (always on right side in body-local space)
    const armMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.6 });
    const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6);
    const upperArm = new THREE.Mesh(armGeo, armMat);
    upperArm.castShadow = true;
    this.armGroup.add(upperArm);
    const forearm = new THREE.Mesh(armGeo, armMat);
    forearm.position.y = -0.35;
    forearm.castShadow = true;
    this.armGroup.add(forearm);
    this.armGroup.position.set(
      BODY_CAPSULE_RADIUS + 0.05,
      BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS,
      0,
    );
    this.group.add(this.armGroup);

    this.saber = new Saber();
    this.armGroup.add(this.saber.group);
    this.saber.group.position.y = -0.7;

    // Off-hand arm (static)
    const offArm = new THREE.Group();
    const offUpper = new THREE.Mesh(armGeo, armMat);
    offUpper.castShadow = true;
    offArm.add(offUpper);
    const offFore = new THREE.Mesh(armGeo, armMat);
    offFore.position.y = -0.35;
    offFore.castShadow = true;
    offArm.add(offFore);
    offArm.position.set(
      -(BODY_CAPSULE_RADIUS + 0.05),
      BODY_CAPSULE_HEIGHT + BODY_CAPSULE_RADIUS,
      0,
    );
    offArm.rotation.x = 0.3;
    this.group.add(offArm);
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

    if (this.barrierMesh) {
      this.barrierMesh.visible = snap.abilityActive && snap.className === 'mystic';
    }
  }

  update(dt: number): void {
    this.group.position.lerp(this.targetPos, 0.5);
    this.group.rotation.y = this.bodyYaw;
    this.armGroup.quaternion.slerp(this.targetSaberQ, 0.7);
    this.saber.update(dt);
  }

  createBarrier(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(1.2, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8844ff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.barrierMesh = new THREE.Mesh(geo, mat);
    this.barrierMesh.visible = false;
    this.group.add(this.barrierMesh);
    this.barrierMesh.position.y = 1;
    return this.barrierMesh;
  }
}
