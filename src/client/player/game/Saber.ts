import * as THREE from 'three';
import { BLADE_LENGTH, BLADE_RADIUS, HILT_LENGTH } from '@shared/constants.js';

const _tipLocal = new THREE.Vector3();
const _baseLocal = new THREE.Vector3();
const MAX_TRAIL_POINTS = 8;
const MAX_TRAIL_AGE = 0.12; // snappy fade

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

    // Compute world positions using pre-allocated reusable vectors (0 GC)
    _tipLocal.set(0, HILT_LENGTH + this.bladeLength, 0);
    _baseLocal.set(0, HILT_LENGTH, 0);
    this.group.localToWorld(_tipLocal);
    this.group.localToWorld(_baseLocal);
    this.bladeTip.copy(_tipLocal);
    this.bladeBase.copy(_baseLocal);

    // Tip speed
    this.tipSpeed = _tipLocal.distanceTo(this.prevTip) / Math.max(dt, 0.001);
    this.prevTip.copy(_tipLocal);

    // Record trail point and update
    this.trail.push(_tipLocal, _baseLocal);
    this.trail.update(dt);
  }
}

/**
 * Ultra-performant, low-quality, light faint motion ribbon behind the sword.
 * Fixed 8-point ring buffer, pre-allocated static index buffer, zero garbage collection.
 */
class SaberTrail {
  readonly mesh: THREE.Mesh;
  private points: { tip: THREE.Vector3; base: THREE.Vector3; age: number }[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private baseColor: THREE.Color;
  private posArr: Float32Array;
  private colorArr: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;

  constructor(color: string) {
    this.baseColor = new THREE.Color(color);
    this.geometry = new THREE.BufferGeometry();

    const maxVerts = MAX_TRAIL_POINTS * 2;
    this.posArr = new Float32Array(maxVerts * 3);
    this.colorArr = new Float32Array(maxVerts * 3);

    this.posAttr = new THREE.BufferAttribute(this.posArr, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colorArr, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colorAttr);

    // Pre-allocate static index buffer for triangle strip once (0 GC per frame)
    const indices = new Uint16Array((MAX_TRAIL_POINTS - 1) * 6);
    for (let i = 0; i < MAX_TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      const idx = i * 6;
      indices[idx] = a;
      indices[idx + 1] = a + 1;
      indices[idx + 2] = a + 2;
      indices[idx + 3] = a + 1;
      indices[idx + 4] = a + 3;
      indices[idx + 5] = a + 2;
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    // Light, faint, additive ribbon material
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.20,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    // Pre-allocate ring buffer entries
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      this.points.push({
        tip: new THREE.Vector3(),
        base: new THREE.Vector3(),
        age: 999,
      });
    }
  }

  setColor(hex: string): void {
    this.baseColor.set(hex);
  }

  push(tip: THREE.Vector3, base: THREE.Vector3): void {
    const first = this.points[0];
    // Only register a point if blade actually moved to avoid degenerate polygons
    if (first.age < 999 && tip.distanceToSquared(first.tip) < 0.0004) {
      return;
    }
    // Shift elements in pre-allocated ring buffer
    const last = this.points.pop()!;
    last.tip.copy(tip);
    last.base.copy(base);
    last.age = 0;
    this.points.unshift(last);
  }

  update(dt: number = 1 / 60): void {
    let validCount = 0;
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      const p = this.points[i];
      p.age += dt;
      if (p.age <= MAX_TRAIL_AGE) {
        validCount++;
      }
    }

    if (validCount < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const r = this.baseColor.r;
    const g = this.baseColor.g;
    const b = this.baseColor.b;

    for (let i = 0; i < validCount; i++) {
      const p = this.points[i];
      const vertA = i * 2;
      const vertB = vertA + 1;

      // Position stream
      this.posArr[vertA * 3] = p.tip.x;
      this.posArr[vertA * 3 + 1] = p.tip.y;
      this.posArr[vertA * 3 + 2] = p.tip.z;

      this.posArr[vertB * 3] = p.base.x;
      this.posArr[vertB * 3 + 1] = p.base.y;
      this.posArr[vertB * 3 + 2] = p.base.z;

      // Soft exponential alpha gradient from blade to tail
      const fade = Math.max(0, 1 - (i / (validCount - 1)));
      const alpha = fade * fade;

      this.colorArr[vertA * 3] = r * alpha;
      this.colorArr[vertA * 3 + 1] = g * alpha;
      this.colorArr[vertA * 3 + 2] = b * alpha;

      this.colorArr[vertB * 3] = r * alpha * 0.7;
      this.colorArr[vertB * 3 + 1] = g * alpha * 0.7;
      this.colorArr[vertB * 3 + 2] = b * alpha * 0.7;
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (validCount - 1) * 6);
  }
}
