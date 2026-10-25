import * as THREE from 'three';
import { WATER_LEVEL } from '@shared/constants.js';

/** Comic hit marker: 2.2 m plane × this; pops to ~1.35× it (≈1.8 m), so it doesn't swallow the fighter */
const HIT_MARKER_SCALE = 0.6;
const HIT_MARKER_OPACITY = 0.55;
const HIT_MARKER_RING_OPACITY = 0.35;

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface ConfettiPiece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  wobbleSpeed: number;
  wobblePhase: number;
}

interface TearParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface TearRipple {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

interface ComicHitMarker {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  baseScale: number;
}


/** Generates a high-contrast comic starburst canvas texture with impact crosshair */
function createComicStarburstTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const cx = 256;
  const cy = 256;

  function drawStarburst(points: number, outerR: number, innerR: number, angleOffset = 0) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points + angleOffset;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // 1. Radial Comic Impact Speed Lines
  ctx.save();
  ctx.strokeStyle = '#FFAA00';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const angle = (i * Math.PI * 2) / 14 + 0.12;
    const r1 = 200;
    const r2 = 246 + (i % 2 === 0 ? 8 : -6);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Bold Black Comic Outline for Main Starburst
  ctx.save();
  drawStarburst(16, 215, 125, 0);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.restore();

  // 3. Outer Vivid Comic Red-Orange Starburst
  ctx.save();
  drawStarburst(16, 202, 118, 0);
  const grad1 = ctx.createRadialGradient(cx, cy, 30, cx, cy, 210);
  grad1.addColorStop(0, '#FF8800');
  grad1.addColorStop(0.7, '#FF3300');
  grad1.addColorStop(1, '#D91100');
  ctx.fillStyle = grad1;
  ctx.fill();
  ctx.restore();

  // 4. Middle Brilliant Yellow Starburst
  ctx.save();
  drawStarburst(14, 165, 85, 0.22);
  ctx.fillStyle = '#000000';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  const grad2 = ctx.createRadialGradient(cx, cy, 20, cx, cy, 170);
  grad2.addColorStop(0, '#FFF500');
  grad2.addColorStop(0.8, '#FFCC00');
  grad2.addColorStop(1, '#FFA500');
  ctx.fillStyle = grad2;
  ctx.fill();
  ctx.restore();

  // 5. Inner White High-Energy Spike Core
  ctx.save();
  drawStarburst(10, 110, 50, 0.1);
  ctx.fillStyle = '#000000';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // 6. Central Stylized Comic Impact Diamond Star
  ctx.save();
  ctx.fillStyle = '#FF2200';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 65);
  ctx.quadraticCurveTo(cx, cy, cx + 65, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + 65);
  ctx.quadraticCurveTo(cx, cy, cx - 65, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - 65);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.restore();

  // 7. Center Bright White Diamond Accent
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 30);
  ctx.quadraticCurveTo(cx, cy, cx + 30, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + 30);
  ctx.quadraticCurveTo(cx, cy, cx - 30, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - 30);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class VFX {
  private scene: THREE.Scene;
  private camera: THREE.Camera | null = null;
  private particles: Particle[] = [];
  private screenShake = 0;
  private sparkGeo: THREE.SphereGeometry;
  private sparkPool: THREE.Mesh[] = [];

  // Comic hit marker billboard pool (zero sparks on hit, single punchy impact effect)
  private hitMarkerPool: ComicHitMarker[] = [];
  private activeHitMarkers: ComicHitMarker[] = [];

  // Full-screen flash overlay
  private flashMesh: THREE.Mesh;
  private flashMat: THREE.MeshBasicMaterial;

  // End-game celebration & weeping effects
  private isCelebrating = false;
  private isWeeping = false;
  private getEyePositionsFn: (() => { left: THREE.Vector3; right: THREE.Vector3 }) | null = null;
  private confettiPieces: ConfettiPiece[] = [];
  private activeTears: TearParticle[] = [];
  private activeRipples: TearRipple[] = [];
  private celebrationMotes: Particle[] = [];
  private tearSpawnTimer = 0;
  private moteSpawnTimer = 0;


  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparkGeo = new THREE.SphereGeometry(0.04, 4, 4);

    for (let i = 0; i < 400; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffaa44,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.sparkPool.push(mesh);
    }

    // Screen flash (used for hits, blocks, abilities)
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      this.flashMat,
    );
    this.flashMesh.renderOrder = 999;
    this.flashMesh.frustumCulled = false;

    // Pre-allocate comic hit marker billboard meshes
    const hitTexture = createComicStarburstTexture();
    const hitGeo = new THREE.PlaneGeometry(2.2, 2.2);
    const ringGeo = new THREE.RingGeometry(0.3, 0.55, 32);

    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: hitTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(hitGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 50;
      scene.add(mesh);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffcc00,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.visible = false;
      ring.renderOrder = 49;
      scene.add(ring);

      this.hitMarkerPool.push({
        mesh, mat, ring, ringMat, life: 0, maxLife: 0.28, baseScale: HIT_MARKER_SCALE,
      });
    }
  }

  /** Attach flash plane and store camera reference so hit markers can face viewer */
  attachToCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.flashMesh.position.set(0, 0, -0.5);
    camera.add(this.flashMesh);
  }

  /** Full-screen color flash */
  screenFlash(color: number, intensity: number, duration = 0.15): void {
    this.flashMat.color.set(color);
    this.flashMat.opacity = intensity;
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 1000;
      if (t > duration) {
        this.flashMat.opacity = 0;
        return;
      }
      this.flashMat.opacity = intensity * (1 - t / duration);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Sparks at blade clash point */
  spawnClashSparks(position: THREE.Vector3, count = 30): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      mesh.position.copy(position);
      mesh.visible = true;
      mesh.scale.setScalar(1 + Math.random());
      (mesh.material as THREE.MeshBasicMaterial).color.set(
        Math.random() > 0.3 ? 0xffaa44 : 0xffffcc
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        Math.random() * 8,
        (Math.random() - 0.5) * 12,
      );
      this.particles.push({ mesh, velocity: vel, life: 0.4 + Math.random() * 0.3, maxLife: 0.6 });
    }
  }

  /** Big, vibrant comic starburst hit marker on top of where the fighter was struck (no sparks) */
  spawnHitFlash(position: THREE.Vector3): void {
    this.spawnComicHitMarker(position);
  }

  /** Spawn a single comic starburst hit marker on the contact point */
  spawnComicHitMarker(position: THREE.Vector3): void {
    // Find available pooled hit marker or recycle oldest active
    let marker: ComicHitMarker | undefined = this.hitMarkerPool.find(m => !m.mesh.visible);
    if (!marker && this.activeHitMarkers.length > 0) {
      marker = this.activeHitMarkers.shift();
    }
    if (!marker) return;

    marker.mesh.position.copy(position);
    marker.ring.position.copy(position);
    if (this.camera) {
      marker.mesh.quaternion.copy(this.camera.quaternion);
      marker.ring.quaternion.copy(this.camera.quaternion);
    }
    marker.mesh.scale.setScalar(0.4 * marker.baseScale);
    marker.ring.scale.setScalar(0.4 * marker.baseScale);
    marker.mat.opacity = HIT_MARKER_OPACITY;
    marker.ringMat.opacity = HIT_MARKER_RING_OPACITY;
    marker.mesh.visible = true;
    marker.ring.visible = true;
    marker.life = 0.28;
    marker.maxLife = 0.28;

    this.activeHitMarkers.push(marker);

    // Screen flash (clean red impact flash, no sparks)
    this.screenFlash(0xff3333, 0.25, 0.15);
  }

  /** Block shield flash — bright colored burst at block point */
  spawnBlockFlash(position: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.6, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0.25, maxLife: 0.25 });

    // Ring burst
    const ringGeo = new THREE.RingGeometry(0.1, 0.4, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(position);
    ring.lookAt(0, 0, 0);
    this.scene.add(ring);

    const startTime = performance.now();
    const animateRing = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed > 0.3) {
        this.scene.remove(ring);
        ringGeo.dispose();
        ringMat.dispose();
        return;
      }
      ring.scale.setScalar(1 + elapsed * 8);
      ringMat.opacity = 0.8 * (1 - elapsed / 0.3);
      requestAnimationFrame(animateRing);
    };
    requestAnimationFrame(animateRing);

    this.screenFlash(0x4488ff, 0.15, 0.15);
  }

  /** Splash when a fighter falls into the water */
  spawnSplash(position: THREE.Vector3): void {
    const waterY = WATER_LEVEL;
    for (let i = 0; i < 40; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      mesh.position.set(position.x, waterY, position.z);
      mesh.visible = true;
      mesh.scale.setScalar(2 + Math.random());
      (mesh.material as THREE.MeshBasicMaterial).color.set(0x4488cc);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        4 + Math.random() * 6,
        Math.sin(angle) * speed,
      );
      this.particles.push({ mesh, velocity: vel, life: 1.0, maxLife: 1.0 });
    }
  }

  /**
   * Ring-out finisher: a pillar of light slams down from the sky onto the water where the
   * loser landed, with an impact flash and shock rings. Tall enough to see while looking ahead.
   */
  spawnSkyBeam(position: THREE.Vector3, color: THREE.ColorRepresentation): void {
    const BEAM_HEIGHT = 140;
    const STRIKE = 0.1;
    const HOLD = 0.25;
    const FADE = 1.0;
    const base = new THREE.Vector3(position.x, WATER_LEVEL, position.z);

    // Unit-height cylinders with their origin at the top, so scaling Y grows them downward
    const makeColumn = (radius: number, mat: THREE.MeshBasicMaterial): THREE.Mesh => {
      const geo = new THREE.CylinderGeometry(radius, radius, 1, 16, 1, true);
      geo.translate(0, -0.5, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(base.x, base.y + BEAM_HEIGHT, base.z);
      mesh.scale.y = 0.001;
      mesh.renderOrder = 60;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    };
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
    const coreMat = new THREE.MeshBasicMaterial({ ...additive, color: 0xffffff, opacity: 1 });
    const glowMat = new THREE.MeshBasicMaterial({ ...additive, color, opacity: 0.55 });
    const core = makeColumn(0.35, coreMat);
    const glow = makeColumn(1.4, glowMat);

    const start = performance.now();
    let impacted = false;
    const animate = () => {
      const t = (performance.now() - start) / 1000;
      if (t < STRIKE) {
        const k = t / STRIKE;
        core.scale.y = glow.scale.y = BEAM_HEIGHT * k * k;
      } else {
        core.scale.y = glow.scale.y = BEAM_HEIGHT;
        if (!impacted) {
          impacted = true;
          this.expandAndFade(new THREE.SphereGeometry(1, 20, 14), 0xffffff, base, 0.35, 1, 5, 0.9);
          this.expandAndFade(new THREE.RingGeometry(0.85, 1, 48), new THREE.Color(color).getHex(), base, 0.9, 1, 16, 0.9, 0,
            (m) => { m.rotation.x = -Math.PI / 2; m.position.y += 0.05; });
          this.expandAndFade(new THREE.RingGeometry(0.9, 1, 48), 0xffffff, base, 0.6, 1, 9, 0.7, 0.08,
            (m) => { m.rotation.x = -Math.PI / 2; m.position.y += 0.06; });
          this.spawnSplash(base);
          this.triggerScreenShake(1.6);
        }
        const fadeT = Math.max(0, (t - STRIKE - HOLD) / FADE);
        if (fadeT >= 1) {
          for (const m of [core, glow]) {
            this.scene.remove(m);
            m.geometry.dispose();
          }
          coreMat.dispose();
          glowMat.dispose();
          return;
        }
        // Thin out and fade, with a little crackle while it's at full strength
        const flicker = fadeT === 0 ? 0.85 + Math.random() * 0.15 : 1;
        const thin = 1 - fadeT * 0.8;
        core.scale.x = core.scale.z = thin * flicker;
        glow.scale.x = glow.scale.z = thin * (1 + Math.sin(t * 40) * 0.08);
        coreMat.opacity = (1 - fadeT) * flicker;
        glowMat.opacity = 0.55 * (1 - fadeT);
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Additive mesh that scales up and fades out, then removes itself */
  private expandAndFade(
    geo: THREE.BufferGeometry, color: number, position: THREE.Vector3,
    duration: number, startScale: number, endScale: number, opacity = 1, delay = 0,
    setup?: (mesh: THREE.Mesh) => void,
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    setup?.(mesh);
    mesh.scale.setScalar(startScale);
    this.scene.add(mesh);

    const startTime = performance.now() + delay * 1000;
    const animate = () => {
      const t = (performance.now() - startTime) / 1000 / duration;
      if (t > 1) {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
        return;
      }
      if (t >= 0) {
        const eased = 1 - (1 - t) ** 3;
        mesh.scale.setScalar(startScale + (endScale - startScale) * eased);
        mat.opacity = opacity * (1 - t);
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private burst(
    position: THREE.Vector3, count: number, color: THREE.ColorRepresentation,
    velocity: () => THREE.Vector3, life: number, scale = 1.5,
  ): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      mesh.position.copy(position);
      mesh.visible = true;
      mesh.scale.setScalar(scale * (0.7 + Math.random() * 0.6));
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      const l = life * (0.7 + Math.random() * 0.6);
      this.particles.push({ mesh, velocity: velocity(), life: l, maxLife: l });
    }
  }

  /** Shockwave (Guardian) — three ground rings, a flash dome, and a radial dust blast */
  spawnShockwave(position: THREE.Vector3): void {
    const ground = new THREE.Vector3(position.x, 0.35, position.z);
    const flat = (m: THREE.Mesh) => { m.rotation.x = -Math.PI / 2; };
    for (let i = 0; i < 3; i++) {
      this.expandAndFade(new THREE.RingGeometry(0.7, 1.0, 64), 0x66aaff, ground, 0.9, 0.3, 9 - i * 2, 1, i * 0.08, flat);
    }
    this.expandAndFade(
      new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      0x88ccff, ground, 0.5, 0.2, 3.5, 0.6,
    );
    this.burst(new THREE.Vector3(position.x, 0.4, position.z), 70, 0x99ccff, () => {
      const a = Math.random() * Math.PI * 2;
      const s = 8 + Math.random() * 6;
      return new THREE.Vector3(Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s);
    }, 0.6, 2);
    this.screenFlash(0x4488ff, 0.55, 0.4);
    this.triggerScreenShake(3.5);
  }

  /** Overcharge (Striker) — lightning column, shock ring, and a fountain of sparks */
  spawnOvercharge(position: THREE.Vector3, color: string): void {
    const c = new THREE.Color(color).getHex();
    this.expandAndFade(
      new THREE.CylinderGeometry(0.4, 0.4, 6, 16, 1, true), c,
      new THREE.Vector3(position.x, 3, position.z), 0.5, 1, 2.5, 0.9,
    );
    this.expandAndFade(
      new THREE.RingGeometry(0.6, 0.9, 48), c, new THREE.Vector3(position.x, 1, position.z),
      0.5, 0.4, 4, 1, 0, (m) => { m.rotation.x = -Math.PI / 2; },
    );
    this.burst(new THREE.Vector3(position.x, 1, position.z), 60, color, () => new THREE.Vector3(
      (Math.random() - 0.5) * 6, 4 + Math.random() * 6, (Math.random() - 0.5) * 6,
    ), 0.8, 1.8);
    this.screenFlash(c, 0.45, 0.3);
    this.triggerScreenShake(1.8);
  }

  /** Crackling sparks along a blade (called every frame while overcharged) */
  spawnBladeSparks(base: THREE.Vector3, tip: THREE.Vector3, color: string, count = 2): void {
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      p.lerpVectors(base, tip, Math.random());
      this.burst(p, 1, Math.random() > 0.4 ? color : 0xffffff, () => new THREE.Vector3(
        (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3,
      ), 0.25, 0.8);
    }
  }

  /** Barrier (Mystic) — bubble slams outward then settles, with an orbiting sparkle burst */
  spawnBarrier(position: THREE.Vector3): void {
    const center = new THREE.Vector3(position.x, position.y + 1, position.z);
    this.expandAndFade(new THREE.SphereGeometry(1, 24, 16), 0xaa66ff, center, 0.45, 0.3, 2.2, 0.8);
    this.expandAndFade(new THREE.IcosahedronGeometry(1, 1), 0xddbbff, center, 0.6, 0.5, 1.8, 1, 0,
      (m) => { (m.material as THREE.MeshBasicMaterial).wireframe = true; });
    this.burst(center, 50, 0xcc99ff, () => {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      return dir.multiplyScalar(4 + Math.random() * 2);
    }, 0.6, 1.4);
    this.screenFlash(0x8844ff, 0.45, 0.35);
    this.triggerScreenShake(1.2);
  }

  /** Blink (Phantom) — fading afterimage at the start point and a dense streak to the end */
  spawnBlinkTrail(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    const c = new THREE.Color(color).getHex();
    this.expandAndFade(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 12), c,
      new THREE.Vector3(from.x, from.y + 0.85, from.z), 0.7, 1, 1.3, 0.8,
    );
    this.expandAndFade(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 12), 0xffffff,
      new THREE.Vector3(to.x, to.y + 0.85, to.z), 0.3, 1.4, 1, 0.7,
    );
    const p = new THREE.Vector3();
    for (let i = 0; i < 60; i++) {
      p.lerpVectors(from, to, i / 60);
      p.y += 0.2 + Math.random() * 1.4;
      this.burst(p, 1, i % 3 === 0 ? 0xffffff : color, () => new THREE.Vector3(
        (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2,
      ), 0.6, 1.6);
    }
    this.screenFlash(c, 0.4, 0.2);
    this.triggerScreenShake(1.2);
  }

  triggerScreenShake(intensity: number): void {
    this.screenShake = Math.max(this.screenShake, intensity);
  }

  getScreenShakeOffset(): THREE.Vector2 {
    if (this.screenShake < 0.001) return new THREE.Vector2();
    return new THREE.Vector2(
      (Math.random() - 0.5) * this.screenShake * 0.04,
      (Math.random() - 0.5) * this.screenShake * 0.04,
    );
  }

  update(dt: number): void {
    // ─── Update Comic Hit Markers ─────────────────────────────────────
    for (let i = this.activeHitMarkers.length - 1; i >= 0; i--) {
      const hm = this.activeHitMarkers[i];
      hm.life -= dt;
      if (hm.life <= 0) {
        hm.mesh.visible = false;
        hm.ring.visible = false;
        this.activeHitMarkers.splice(i, 1);
        continue;
      }
      const progress = 1 - hm.life / hm.maxLife; // 0 to 1

      // Keep billboard facing the camera
      if (this.camera) {
        hm.mesh.quaternion.copy(this.camera.quaternion);
        hm.ring.quaternion.copy(this.camera.quaternion);
      }

      // Elastic comic pop animation:
      // 0 -> 0.22: explosive pop-in with overshoot up to 1.35x
      // 0.22 -> 1.0: snappy settle to 1.05x
      let scale = 1;
      if (progress < 0.22) {
        const t = progress / 0.22;
        scale = (0.35 + 1.0 * Math.sin(t * Math.PI * 0.5)) * hm.baseScale;
      } else {
        const t = (progress - 0.22) / 0.78;
        scale = (1.35 - 0.3 * t) * hm.baseScale;
      }
      hm.mesh.scale.setScalar(scale);

      // Opacity: stay solid until 65%, then rapid fade out
      if (progress < 0.65) {
        hm.mat.opacity = HIT_MARKER_OPACITY;
      } else {
        hm.mat.opacity = HIT_MARKER_OPACITY * Math.max(0, 1 - (progress - 0.65) / 0.35);
      }

      // Expanding comic shock ring
      const ringScale = (0.4 + progress * 2.8) * hm.baseScale;
      hm.ring.scale.setScalar(ringScale);
      hm.ringMat.opacity = HIT_MARKER_RING_OPACITY * Math.max(0, 1 - progress);
    }

    // ─── Update Existing Particles ────────────────────────────────────
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (this.sparkPool.includes(p.mesh)) {
          p.mesh.visible = false;
          p.mesh.scale.setScalar(1);
        } else {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose();
        }
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const alpha = p.life / p.maxLife;
      if (p.mesh.material instanceof THREE.MeshBasicMaterial) {
        p.mesh.material.opacity = alpha;
        p.mesh.material.transparent = true;
      }
    }

    if (this.screenShake > 0) {
      this.screenShake *= Math.max(0, 1 - 6 * dt);
      if (this.screenShake < 0.01) this.screenShake = 0;
    }

    // ─── Update Confetti & Celebration Motes ──────────────────────────
    if (this.confettiPieces.length > 0) {
      for (const c of this.confettiPieces) {
        c.wobblePhase += c.wobbleSpeed * dt;
        c.vel.x = Math.sin(c.wobblePhase) * 0.45;
        c.vel.z = Math.cos(c.wobblePhase * 0.7) * 0.35;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.rotVel.x * dt;
        c.mesh.rotation.y += c.rotVel.y * dt;
        c.mesh.rotation.z += c.rotVel.z * dt;

        // Ground collision & continuous cycling during celebration
        if (c.mesh.position.y <= 0.02) {
          if (this.isCelebrating) {
            c.mesh.position.y = 3.6 + Math.random() * 1.8;
            c.mesh.position.x = (Math.random() - 0.5) * 4.5;
            c.mesh.position.z = (Math.random() - 0.5) * 3.0;
          } else {
            c.mesh.visible = false;
          }
        }
      }
    }

    if (this.isCelebrating) {
      this.moteSpawnTimer += dt;
      if (this.moteSpawnTimer > 0.06) {
        this.moteSpawnTimer = 0;
        this.spawnCelebrationMote();
      }
    }

    // ─── Update Tears & Ripples ──────────────────────────────────────
    if (this.isWeeping && this.getEyePositionsFn) {
      this.tearSpawnTimer += dt;
      if (this.tearSpawnTimer >= 0.14) {
        this.tearSpawnTimer = 0;
        const eyes = this.getEyePositionsFn();
        this.spawnTearDroplet(eyes.left);
        this.spawnTearDroplet(eyes.right);
      }
    }

    for (let i = this.activeTears.length - 1; i >= 0; i--) {
      const t = this.activeTears[i];
      t.life -= dt;
      t.vel.y -= 7.5 * dt;
      t.mesh.position.addScaledVector(t.vel, dt);

      if (t.mesh.position.y <= 0.02 || t.life <= 0) {
        if (t.mesh.position.y <= 0.02) {
          this.spawnTearRipple(t.mesh.position.x, t.mesh.position.z);
        }
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        this.activeTears.splice(i, 1);
      }
    }

    for (let i = this.activeRipples.length - 1; i >= 0; i--) {
      const r = this.activeRipples[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mat.dispose();
        this.activeRipples.splice(i, 1);
        continue;
      }
      const progress = 1 - r.life / r.maxLife;
      const s = 0.03 + progress * 0.16;
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = 0.6 * (1 - progress);
    }
  }

  // ─── End Game VFX Methods ─────────────────────────────────────────

  /** Trigger fluttering golden confetti bursts and rising spark celebration */
  startVictoryCelebration(): void {
    this.clearEndGameVFX();
    this.isCelebrating = true;

    const goldColors = [0xffd700, 0xffc107, 0xffa000, 0xffe082, 0xffffff, 0xf59e0b];
    const confettiGeo = new THREE.PlaneGeometry(0.09, 0.06);

    for (let i = 0; i < 90; i++) {
      const color = goldColors[Math.floor(Math.random() * goldColors.length)];
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.3,
        metalness: 0.8,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(confettiGeo, mat);

      mesh.position.set(
        (Math.random() - 0.5) * 4.5,
        1.5 + Math.random() * 3.5,
        (Math.random() - 0.5) * 3.5,
      );

      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      this.scene.add(mesh);
      this.confettiPieces.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          -(0.7 + Math.random() * 0.9),
          (Math.random() - 0.5) * 0.4,
        ),
        rotVel: new THREE.Vector3(
          (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 6,
        ),
        wobbleSpeed: 2 + Math.random() * 4,
        wobblePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private spawnCelebrationMote(): void {
    const spark = this.getPooledSpark();
    if (!spark) return;

    // Spawn rising radiant gold sparks around the platform
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.3 + Math.random() * 1.5;
    spark.position.set(
      Math.cos(angle) * radius,
      0.05 + Math.random() * 0.2,
      Math.sin(angle) * radius,
    );

    spark.visible = true;
    spark.scale.setScalar(0.7 + Math.random() * 0.8);
    (spark.material as THREE.MeshBasicMaterial).color.setHex(0xffdd44);
    (spark.material as THREE.MeshBasicMaterial).opacity = 0.9;

    this.particles.push({
      mesh: spark,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        1.0 + Math.random() * 1.5,
        (Math.random() - 0.5) * 0.4,
      ),
      life: 0.8 + Math.random() * 0.6,
      maxLife: 1.4,
    });
  }

  /** Trigger streaming weeping tears from character's eyes */
  startTears(getEyePos: () => { left: THREE.Vector3; right: THREE.Vector3 }): void {
    this.clearEndGameVFX();
    this.isWeeping = true;
    this.getEyePositionsFn = getEyePos;
  }

  private spawnTearDroplet(pos: THREE.Vector3): void {
    const tearGeo = new THREE.SphereGeometry(0.022, 6, 6);
    const tearMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(tearGeo, tearMat);
    mesh.position.copy(pos);

    this.scene.add(mesh);
    this.activeTears.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        0.02,
        0.18 + Math.random() * 0.08,
      ),
      life: 1.2,
      maxLife: 1.2,
    });
  }

  private spawnTearRipple(x: number, z: number): void {
    const geo = new THREE.RingGeometry(0.01, 0.025, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.015, z);

    this.scene.add(mesh);
    this.activeRipples.push({
      mesh,
      mat,
      life: 0.45,
      maxLife: 0.45,
    });
  }

  /** Clean up all end game celebration / defeat particles */
  clearEndGameVFX(): void {
    this.isCelebrating = false;
    this.isWeeping = false;
    this.getEyePositionsFn = null;

    for (const c of this.confettiPieces) {
      this.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
    }
    this.confettiPieces = [];

    for (const t of this.activeTears) {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    this.activeTears = [];

    for (const r of this.activeRipples) {
      this.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
    this.activeRipples = [];
  }

  private getPooledSpark(): THREE.Mesh | null {
    for (const mesh of this.sparkPool) {
      if (!mesh.visible) return mesh;
    }
    return null;
  }
}

