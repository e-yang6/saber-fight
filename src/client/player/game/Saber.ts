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
  private _stunned = false;
  private pulseTime = 0;

  setOvercharged(on: boolean): void {
    this._overcharged = on;
  }

  /** Parried: the blade sputters until the stun wears off */
  setStunned(on: boolean): void {
    this._stunned = on;
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
    this.pulseTime += dt;
    if (this._stunned) {
      const on = Math.sin(this.pulseTime * 70) > -0.3;
      this.bladeCore.visible = on;
      this.bladeGlow.visible = on;
    } else if (!this.bladeCore.visible) {
      this.bladeCore.visible = true;
      this.bladeGlow.visible = true;
    }

    if (this._overcharged && !this._blocking) {
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
    this.trail.update(tipLocal, baseLocal, this.tipSpeed, dt);
  }
}

/**
 * Motion trail rendered as a fading ribbon behind the blade.
 */
class SaberTrail {
  readonly mesh: THREE.Mesh;
  private positions: { tip: THREE.Vector3; base: THREE.Vector3; age: number; strength: number }[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private color = new THREE.Color();
  /** Enough samples to cover maxAge even at 144 Hz */
  private maxPoints = 40;
  private maxAge = 0.18; // seconds

  constructor(color: string) {
    this.color.set(color);
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    const maxVerts = this.maxPoints * 2;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  }

  setColor(hex: string): void {
    this.color.set(hex);
  }

  /**
   * Additive blending: vertex colour fading to black == fading out. A still blade (low speed)
   * leaves no ribbon, so it doesn't pile up into a glowing smear.
   */
  update(tip: THREE.Vector3, base: THREE.Vector3, speed: number, dt: number): void {
    for (const p of this.positions) p.age += dt;
    while (this.positions.length > 0 && this.positions[this.positions.length - 1].age > this.maxAge) {
      this.positions.pop();
    }
    const strength = Math.min(1, Math.max(0, (speed - 1.5) / 6));
    this.positions.unshift({ tip: tip.clone(), base: base.clone(), age: 0, strength });
    if (this.positions.length > this.maxPoints) this.positions.pop();

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      const life = 1 - p.age / this.maxAge;
      const k = life * life * p.strength;
      const t = i * 6;
      pos[t] = p.tip.x; pos[t + 1] = p.tip.y; pos[t + 2] = p.tip.z;
      pos[t + 3] = p.base.x; pos[t + 4] = p.base.y; pos[t + 5] = p.base.z;
      // Tip edge bright, hilt edge dimmer
      col[t] = this.color.r * k; col[t + 1] = this.color.g * k; col[t + 2] = this.color.b * k;
      col[t + 3] = this.color.r * k * 0.25; col[t + 4] = this.color.g * k * 0.25; col[t + 5] = this.color.b * k * 0.25;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    const indices: number[] = [];
    for (let i = 0; i < this.positions.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(indices);
  }
}
