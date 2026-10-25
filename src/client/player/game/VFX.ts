import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class VFX {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private screenShake = 0;
  private sparkGeo: THREE.SphereGeometry;
  private sparkPool: THREE.Mesh[] = [];

  // Full-screen flash overlay
  private flashMesh: THREE.Mesh;
  private flashMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparkGeo = new THREE.SphereGeometry(0.04, 4, 4);

    for (let i = 0; i < 150; i++) {
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
  }

  /** Attach flash plane to camera so it always fills the screen */
  attachToCamera(camera: THREE.Camera): void {
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

  /** Hit flash — big white burst + red screen tint */
  spawnHitFlash(position: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.8, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0.2, maxLife: 0.2 });

    this.screenFlash(0xff4444, 0.3, 0.2);
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
    const waterY = -8;
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

  /** Shockwave ring (Guardian ability) — BIG expanding ring + flash + shake */
  spawnShockwave(position: THREE.Vector3): void {
    const geo = new THREE.RingGeometry(0.2, 0.8, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y = 0.5;
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);

    this.screenFlash(0x4488ff, 0.4, 0.3);
    this.triggerScreenShake(2.0);

    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed > 0.7) {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
        return;
      }
      const scale = 1 + elapsed * 16;
      mesh.scale.setScalar(scale);
      mat.opacity = 1.0 * (1 - elapsed / 0.7);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Overcharge burst — saber power-up particles */
  spawnOvercharge(position: THREE.Vector3, color: string): void {
    for (let i = 0; i < 25; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      mesh.position.copy(position);
      mesh.position.y += 1;
      mesh.visible = true;
      mesh.scale.setScalar(1.5);
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        2 + Math.random() * 4,
        (Math.random() - 0.5) * 4,
      );
      this.particles.push({ mesh, velocity: vel, life: 0.5 + Math.random() * 0.3, maxLife: 0.7 });
    }
    this.screenFlash(0xffaa00, 0.25, 0.2);
    this.triggerScreenShake(0.8);
  }

  /** Barrier activation — expanding sphere pulse */
  spawnBarrier(position: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.3, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8844ff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y += 1;
    this.scene.add(mesh);

    this.screenFlash(0x8844ff, 0.3, 0.25);
    this.triggerScreenShake(0.5);

    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed > 0.4) {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
        return;
      }
      mesh.scale.setScalar(1 + elapsed * 6);
      mat.opacity = 0.7 * (1 - elapsed / 0.4);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Blink trail (Phantom ability) */
  spawnBlinkTrail(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    for (let i = 0; i < 20; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      const t = i / 20;
      mesh.position.lerpVectors(from, to, t);
      mesh.position.y += 0.5 + Math.random() * 0.5;
      mesh.visible = true;
      mesh.scale.setScalar(1.5);
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3),
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.6,
      });
    }
    this.screenFlash(new THREE.Color(color).getHex(), 0.3, 0.15);
    this.triggerScreenShake(0.6);
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
  }

  private getPooledSpark(): THREE.Mesh | null {
    for (const mesh of this.sparkPool) {
      if (!mesh.visible) return mesh;
    }
    return null;
  }
}
