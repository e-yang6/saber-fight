import * as THREE from 'three';
import { PLATFORM_RADIUS, PLATFORM_HEIGHT } from '@shared/constants.js';

/**
 * Floating circular platform over water at sunset, with atmospheric lighting.
 */
export function createArena(scene: THREE.Scene): { platform: THREE.Mesh; water: THREE.Mesh } {
  // ─── Platform ──────────────────────────────────────────────────────
  const platformGeo = new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS, PLATFORM_HEIGHT, 64);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x333344,
    roughness: 0.6,
    metalness: 0.3,
  });
  const platform = new THREE.Mesh(platformGeo, platformMat);
  platform.position.y = -PLATFORM_HEIGHT / 2;
  platform.receiveShadow = true;
  scene.add(platform);

  // Platform edge glow ring
  const ringGeo = new THREE.TorusGeometry(PLATFORM_RADIUS, 0.04, 8, 128);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.6 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);

  // ─── Water plane ──────────────────────────────────────────────────
  const waterGeo = new THREE.PlaneGeometry(200, 200);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x112244,
    roughness: 0.3,
    metalness: 0.8,
    transparent: true,
    opacity: 0.85,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -8;
  water.receiveShadow = true;
  scene.add(water);

  // ─── Lighting ──────────────────────────────────────────────────────
  // Warm sunset directional
  const sunLight = new THREE.DirectionalLight(0xffaa44, 1.5);
  sunLight.position.set(-10, 15, -5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 50;
  sunLight.shadow.camera.left = -10;
  sunLight.shadow.camera.right = 10;
  sunLight.shadow.camera.top = 10;
  sunLight.shadow.camera.bottom = -10;
  scene.add(sunLight);

  // Cool fill light from below/front
  const fillLight = new THREE.DirectionalLight(0x4466cc, 0.4);
  fillLight.position.set(5, -2, 10);
  scene.add(fillLight);

  // Ambient
  const ambient = new THREE.AmbientLight(0x222233, 0.5);
  scene.add(ambient);

  // Hemisphere for sky/ground color
  const hemi = new THREE.HemisphereLight(0xff8844, 0x223355, 0.3);
  scene.add(hemi);

  // ─── Sky gradient ──────────────────────────────────────────────────
  const skyGeo = new THREE.SphereGeometry(80, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x0a0a2e) },
      bottomColor: { value: new THREE.Color(0xff6622) },
      offset: { value: 20 },
      exponent: { value: 0.4 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  return { platform, water };
}
