import * as THREE from 'three';
import { BLADE_LENGTH, BLADE_RADIUS, HILT_LENGTH } from '@shared/constants.js';

/**
 * Saber model: hilt + bright blade core + additive glow cylinder + motion trail.
 */
export class Saber {
  readonly group = new THREE.Group();
  readonly bladeCore: THREE.Mesh;
  readonly bladeGlow: THREE.Mesh;
  readonly hilt: THREE.Mesh;
  readonly trail: SaberTrail;

  private bladeLength = BLADE_LENGTH;
  private coreMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;

  /** World-space blade tip for collision, updated each frame */
  bladeTip = new THREE.Vector3();
  /** World-space blade base (guard end) */
  bladeBase = new THREE.Vector3();
  /** Blade tip velocity in m/s */
  tipSpeed = 0;
  private prevTip = new THREE.Vector3();

  constructor(color: string = '#4488ff') {
    // Hilt
    const hiltGeo = new THREE.CylinderGeometry(0.025, 0.03, HILT_LENGTH, 8);
    const hiltMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.3, metalness: 0.8 });
    this.hilt = new THREE.Mesh(hiltGeo, hiltMat);
    this.hilt.position.y = HILT_LENGTH / 2;
    this.group.add(this.hilt);

    // Blade core (bright white-ish center)
    const coreGeo = new THREE.CylinderGeometry(BLADE_RADIUS * 0.5, BLADE_RADIUS * 0.5, BLADE_LENGTH, 8);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.bladeCore = new THREE.Mesh(coreGeo, this.coreMat);
    this.bladeCore.position.y = HILT_LENGTH + BLADE_LENGTH / 2;
    this.group.add(this.bladeCore);

    // Blade glow (additive, colored)
    const glowGeo = new THREE.CylinderGeometry(BLADE_RADIUS * 2, BLADE_RADIUS * 2, BLADE_LENGTH, 8);
    this.glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.bladeGlow = new THREE.Mesh(glowGeo, this.glowMat);
    this.bladeGlow.position.y = HILT_LENGTH + BLADE_LENGTH / 2;
    this.group.add(this.bladeGlow);

    // Trail
    this.trail = new SaberTrail(color);
    // Trail is added to the scene by the Game, not parented to saber
  }

  private baseColor = '#4488ff';
  private _blocking = false;
  private _overcharged = false;
  private pulseTime = 0;

  setOvercharged(on: boolean): void {
    this._overcharged = on;
  }

  get overcharged(): boolean {
    return this._overcharged;
  }

  setColor(hex: string): void {
    this.baseColor = hex;
    if (!this._blocking) {
      this.glowMat.color.set(hex);
    }
    this.trail.setColor(hex);
  }

  setBlocking(blocking: boolean): void {
    if (blocking === this._blocking) return;
    this._blocking = blocking;
    if (blocking) {
      this.glowMat.color.set(0xffffff);
      this.glowMat.opacity = 0.9;
      this.coreMat.color.set(0xffffff);
      this.bladeGlow.scale.x = 1.8;
      this.bladeGlow.scale.z = 1.8;
    } else {
      this.glowMat.color.set(this.baseColor);
      this.glowMat.opacity = 0.6;
      this.coreMat.color.set(0xffffff);
      this.bladeGlow.scale.x = 1;
      this.bladeGlow.scale.z = 1;
    }
  }

  setBladeScale(scale: number): void {
    this.bladeLength = BLADE_LENGTH * scale;
    this.bladeCore.scale.y = scale;
    this.bladeCore.position.y = HILT_LENGTH + this.bladeLength / 2;
    this.bladeGlow.scale.y = scale;
    this.bladeGlow.position.y = HILT_LENGTH + this.bladeLength / 2;
  }

  update(dt: number): void {
    if (this._overcharged && !this._blocking) {
      this.pulseTime += dt;
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * 25);
      this.bladeGlow.scale.x = this.bladeGlow.scale.z = 2.4 + pulse * 1.2;
      this.glowMat.opacity = 0.75 + pulse * 0.25;
    } else if (!this._blocking && this.bladeGlow.scale.x !== 1) {
      this.bladeGlow.scale.x = this.bladeGlow.scale.z = 1;
      this.glowMat.opacity = 0.6;
    }

    // Compute world positions
    const tipLocal = new THREE.Vector3(0, HILT_LENGTH + this.bladeLength, 0);
    const baseLocal = new THREE.Vector3(0, HILT_LENGTH, 0);
    this.group.localToWorld(tipLocal);
    this.group.localToWorld(baseLocal);
    this.bladeTip.copy(tipLocal);
    this.bladeBase.copy(baseLocal);

    // Tip speed
    this.tipSpeed = tipLocal.distanceTo(this.prevTip) / Math.max(dt, 0.001);
    this.prevTip.copy(tipLocal);

    // Update trail
    this.trail.push(tipLocal.clone(), baseLocal.clone());
    this.trail.update();
  }
}

/**
 * Motion trail rendered as a fading ribbon behind the blade.
 */
class SaberTrail {
  readonly mesh: THREE.Mesh;
  private positions: { tip: THREE.Vector3; base: THREE.Vector3; age: number }[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private maxPoints = 20;
  private maxAge = 0.15; // seconds

  constructor(color: string) {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);

    // Pre-allocate buffer
    const maxVerts = this.maxPoints * 2;
    const posArray = new Float32Array(maxVerts * 3);
    const alphaArray = new Float32Array(maxVerts);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(alphaArray, 1));
  }

  setColor(hex: string): void {
    this.material.color.set(hex);
  }

  push(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.positions.unshift({ tip, base, age: 0 });
    if (this.positions.length > this.maxPoints) {
      this.positions.pop();
    }
  }

  update(): void {
    const dt = 1 / 60;
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;

    let vertIdx = 0;
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      p.age += dt;

      posArr[vertIdx * 3] = p.tip.x;
      posArr[vertIdx * 3 + 1] = p.tip.y;
      posArr[vertIdx * 3 + 2] = p.tip.z;
      vertIdx++;

      posArr[vertIdx * 3] = p.base.x;
      posArr[vertIdx * 3 + 1] = p.base.y;
      posArr[vertIdx * 3 + 2] = p.base.z;
      vertIdx++;
    }

    posAttr.needsUpdate = true;

    // Build index for triangle strip
    const indices: number[] = [];
    for (let i = 0; i < this.positions.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2);
      indices.push(a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(indices);

    // Fade based on age
    this.material.opacity = this.positions.length > 2 ? 0.4 : 0;

    // Remove old entries
    while (this.positions.length > 0 && this.positions[this.positions.length - 1].age > this.maxAge) {
      this.positions.pop();
    }
  }
}
