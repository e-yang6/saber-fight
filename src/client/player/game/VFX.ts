import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Visual effects: sparks, hit flashes, splash, shockwave.
 */
export class VFX {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private screenShake = 0;
  private shakeDecay = 0;
  private sparkGeo: THREE.SphereGeometry;
  private sparkPool: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparkGeo = new THREE.SphereGeometry(0.03, 4, 4);

    // Pre-allocate spark pool
    for (let i = 0; i < 100; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffaa44,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.sparkPool.push(mesh);
    }
  }

  /** Sparks at blade clash point */
  spawnClashSparks(position: THREE.Vector3, count = 20): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      mesh.position.copy(position);
      mesh.visible = true;
      (mesh.material as THREE.MeshBasicMaterial).color.set(
        Math.random() > 0.5 ? 0xffaa44 : 0xffffaa
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6,
        (Math.random() - 0.5) * 8,
      );
      this.particles.push({ mesh, velocity: vel, life: 0.3 + Math.random() * 0.2, maxLife: 0.4 });
    }
  }

  /** Hit flash on the struck character */
  spawnHitFlash(position: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0.15, maxLife: 0.15 });
  }

  /** Splash when a fighter falls into the water */
  spawnSplash(position: THREE.Vector3): void {
    const waterY = -8;
    for (let i = 0; i < 30; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      mesh.position.set(position.x, waterY, position.z);
      mesh.visible = true;
      mesh.scale.setScalar(2);
      (mesh.material as THREE.MeshBasicMaterial).color.set(0x4488cc);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        3 + Math.random() * 5,
        Math.sin(angle) * speed,
      );
      this.particles.push({ mesh, velocity: vel, life: 0.8, maxLife: 0.8 });
    }
  }

  /** Shockwave ring (Guardian ability) */
  spawnShockwave(position: THREE.Vector3): void {
    const geo = new THREE.RingGeometry(0.1, 0.3, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y = 0.5;
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);

    // Animate as a growing ring
    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed > 0.5) {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
        return;
      }
      const scale = 1 + elapsed * 10;
      mesh.scale.setScalar(scale);
      mat.opacity = 0.8 * (1 - elapsed / 0.5);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Blink trail (Phantom ability) */
  spawnBlinkTrail(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    for (let i = 0; i < 15; i++) {
      const mesh = this.getPooledSpark();
      if (!mesh) break;
      const t = i / 15;
      mesh.position.lerpVectors(from, to, t);
      mesh.position.y += 0.5 + Math.random() * 0.5;
      mesh.visible = true;
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2),
        life: 0.3 + Math.random() * 0.2,
        maxLife: 0.5,
      });
    }
  }

  triggerScreenShake(intensity: number): void {
    this.screenShake = intensity;
    this.shakeDecay = intensity;
  }

  getScreenShakeOffset(): THREE.Vector2 {
    if (this.screenShake < 0.001) return new THREE.Vector2();
    return new THREE.Vector2(
      (Math.random() - 0.5) * this.screenShake * 0.02,
      (Math.random() - 0.5) * this.screenShake * 0.02,
    );
  }

  update(dt: number): void {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        p.mesh.scale.setScalar(1);
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

    // Decay screen shake
    if (this.screenShake > 0) {
      this.screenShake *= Math.max(0, 1 - 8 * dt);
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
