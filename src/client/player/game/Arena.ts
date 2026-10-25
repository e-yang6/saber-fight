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

  // ─── Concentric Distance Indicator Rings ───────────────────────────
  // Yellow (centre safe zone), Orange (middle combat zone), Red (edge danger zone)
  const floorGroup = new THREE.Group();
  floorGroup.position.y = 0.015;

  const createFlatRing = (
    innerR: number, outerR: number, color: number, opacity: number, segments = 96,
  ): THREE.Mesh => {
    const geo = new THREE.RingGeometry(innerR, outerR, segments);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  };

  // 1. Yellow Zone (Center: r = 0 to 2.5m)
  // Subtle warm yellow fill
  const yellowFill = createFlatRing(0.08, 2.48, 0xFACC15, 0.22, 64);
  floorGroup.add(yellowFill);
  // Center bullseye & radial guide
  const centerBullseye = createFlatRing(0.01, 0.35, 0xFFF275, 0.45, 32);
  const yellowMidGuide = createFlatRing(1.22, 1.28, 0xFDE047, 0.35, 64);
  floorGroup.add(centerBullseye);
  floorGroup.add(yellowMidGuide);
  // Crisp dividing border between Yellow and Orange at r = 2.5m
  const yellowBorder = createFlatRing(2.46, 2.54, 0xFFE033, 0.9, 128);
  floorGroup.add(yellowBorder);

  // 2. Orange Zone (Middle: r = 2.5m to 5.5m)
  // Subtle electric orange fill
  const orangeFill = createFlatRing(2.56, 5.46, 0xF97316, 0.20, 96);
  floorGroup.add(orangeFill);
  // Mid-distance concentric guide
  const orangeMidGuide = createFlatRing(3.96, 4.04, 0xFB923C, 0.35, 96);
  floorGroup.add(orangeMidGuide);
  // Crisp dividing border between Orange and Red at r = 5.5m
  const orangeBorder = createFlatRing(5.45, 5.55, 0xFB923C, 0.9, 128);
  floorGroup.add(orangeBorder);

  // 3. Red Zone (Edge Hazard: r = 5.5m to 8.0m PLATFORM_RADIUS)
  // Subtle warning crimson red fill
  const redFill = createFlatRing(5.57, 7.94, 0xEF4444, 0.24, 128);
  floorGroup.add(redFill);
  // Outer danger guide
  const redMidGuide = createFlatRing(6.72, 6.78, 0xF87171, 0.35, 128);
  floorGroup.add(redMidGuide);
  // Platform perimeter danger ring
  const redPerimeter = createFlatRing(7.86, 7.98, 0xFF2233, 0.95, 128);
  floorGroup.add(redPerimeter);

  scene.add(floorGroup);

  // Platform edge glow torus (warning red at the cliff drop)
  const edgeTorusGeo = new THREE.TorusGeometry(PLATFORM_RADIUS, 0.05, 8, 128);
  const edgeTorusMat = new THREE.MeshBasicMaterial({ color: 0xFF2233, transparent: true, opacity: 0.85 });
  const edgeTorus = new THREE.Mesh(edgeTorusGeo, edgeTorusMat);
  edgeTorus.rotation.x = Math.PI / 2;
  edgeTorus.position.y = 0.015;
  scene.add(edgeTorus);

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
