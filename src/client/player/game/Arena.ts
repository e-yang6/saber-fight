import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLATFORM_RADIUS, PLATFORM_HEIGHT, WATER_LEVEL } from '@shared/constants.js';

export const SKY_HORIZON_COLOR = 0xbfe2ff;
const SKY_TOP_COLOR = 0x2f86dd;

/**
 * Floating platform high over San Francisco Bay on a clear day.
 * Player 1 faces +Z (Golden Gate Bridge and Marin behind the opponent);
 * Player 2 faces -Z (the city skyline behind the opponent).
 */
export function createArena(scene: THREE.Scene): { platform: THREE.Mesh; water: THREE.Mesh } {
  const rand = mulberry32(1937);

  // ─── Platform ──────────────────────────────────────────────────────
  const platformGeo = new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS, PLATFORM_HEIGHT, 64);
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x8c929c, roughness: 0.7, metalness: 0.2 });
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

  // Rocky underside so the platform reads as a floating island
  const rockGeo = new THREE.ConeGeometry(PLATFORM_RADIUS * 0.98, 5, 14, 3);
  jitter(rockGeo, 0.6, rand, (v) => v.y < -2.4); // keep the base flush with the platform (flipped below)
  const rock = new THREE.Mesh(rockGeo, flat(0x7d6b58));
  rock.rotation.x = Math.PI;
  rock.position.y = -PLATFORM_HEIGHT - 2.5;
  scene.add(rock);

  // ─── Bay ───────────────────────────────────────────────────────────
  const waterGeo = new THREE.PlaneGeometry(2400, 2400, 120, 120);
  jitter(waterGeo, 0.5, rand, () => false, 'z');
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2e7bb0, roughness: 0.35, metalness: 0.1, flatShading: true,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  water.receiveShadow = true;
  scene.add(water);

  // ─── Lighting (clear midday) ───────────────────────────────────────
  const sunLight = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sunLight.position.set(20, 40, 12);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 100;
  sunLight.shadow.camera.left = -12;
  sunLight.shadow.camera.right = 12;
  sunLight.shadow.camera.top = 12;
  sunLight.shadow.camera.bottom = -12;
  scene.add(sunLight);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2e6f9a, 1.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  // ─── Sky gradient ──────────────────────────────────────────────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(SKY_TOP_COLOR) },
      bottomColor: { value: new THREE.Color(SKY_HORIZON_COLOR) },
      exponent: { value: 0.6 },
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
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), exponent)), 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat));

  // ─── San Francisco ─────────────────────────────────────────────────
  addCity(scene, rand);
  addMarin(scene, rand);
  addAlcatraz(scene);
  addClouds(scene, rand);
  loadGoldenGate(scene);

  return { platform, water };
}

// ─── Landmarks ───────────────────────────────────────────────────────

const BUILDING_COLORS = [0xf2efe6, 0xe8dcc8, 0xd9e2e8, 0xf0d9c9, 0xcfd6c4, 0xbfc7cf, 0xf5e6b8];

interface Hill { x: number; z: number; radius: number; height: number }

/** Height of a cone hill's surface at (x, z), or 0 outside it */
function hillSurface(h: Hill, x: number, z: number): number {
  const d = Math.hypot(x - h.x, z - h.z);
  return d >= h.radius ? 0 : h.height * (1 - d / h.radius);
}

function addCity(scene: THREE.Scene, rand: () => number): void {
  const hills: Hill[] = [
    { x: -95, z: -175, radius: 55, height: 34 }, // Twin Peaks / Sutro
    { x: -35, z: -160, radius: 45, height: 16 },
    { x: 25, z: -150, radius: 40, height: 12 }, // Nob Hill
    { x: 70, z: -145, radius: 30, height: 14 }, // Telegraph Hill
    { x: 120, z: -170, radius: 50, height: 10 },
    { x: -150, z: -150, radius: 45, height: 12 },
  ];
  for (const h of hills) {
    const geo = new THREE.ConeGeometry(h.radius, h.height, 9, 3);
    jitter(geo, 1.2, rand, (v) => v.y > h.height / 2 - 0.01);
    const mesh = new THREE.Mesh(geo, flat(rand() > 0.5 ? 0x9fae6a : 0xb9ad7d));
    mesh.position.set(h.x, WATER_LEVEL + h.height / 2 - 0.5, h.z);
    mesh.rotation.y = rand() * Math.PI;
    scene.add(mesh);
  }
  // Low flat shoreline tying the hills together
  const shore = new THREE.Mesh(new THREE.BoxGeometry(360, 2, 80), flat(0xc8bb8e));
  shore.position.set(0, WATER_LEVEL + 0.5, -170);
  scene.add(shore);

  // Houses climbing the hills (one instanced draw call)
  const houseCount = 420;
  const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), flat(0xffffff), houseCount);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < houseCount && tries < houseCount * 4; tries++) {
    const x = -175 + rand() * 350;
    const z = -205 + rand() * 75;
    const ground = Math.max(1.5, ...hills.map((h) => hillSurface(h, x, z)));
    const downtown = x > 0 && x < 60 && z > -165;
    const w = 3 + rand() * 4;
    const d = 3 + rand() * 4;
    const height = downtown ? 8 + rand() * 22 : 2.5 + rand() * 4;
    m.compose(
      new THREE.Vector3(x, WATER_LEVEL + ground + height / 2 - 0.5, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 0.4),
      new THREE.Vector3(w, height, d),
    );
    houses.setMatrixAt(placed, m);
    houses.setColorAt(placed, color.set(BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]));
    placed++;
  }
  houses.count = placed;
  scene.add(houses);

  // Transamerica Pyramid
  const pyramid = new THREE.Mesh(new THREE.ConeGeometry(5, 48, 4), flat(0xf4f1ea));
  pyramid.position.set(38, WATER_LEVEL + 1.5 + 24, -142);
  pyramid.rotation.y = Math.PI / 4;
  scene.add(pyramid);

  // Salesforce Tower: tapered shaft with a rounded crown
  const sfTower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.6, 60, 8), flat(0xd8dde2));
  sfTower.position.set(22, WATER_LEVEL + 1.5 + 30, -158);
  scene.add(sfTower);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), flat(0xd8dde2));
  crown.position.set(22, WATER_LEVEL + 1.5 + 60, -158);
  scene.add(crown);

  // Coit Tower on Telegraph Hill
  const coit = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 10, 8), flat(0xf2ead8));
  coit.position.set(70, WATER_LEVEL + 14 + 4, -145);
  scene.add(coit);

  // Sutro Tower on Twin Peaks: three red/white legs meeting at the top
  const sutroMat = flat(0xd9442e);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 5), sutroMat);
    leg.position.set(-95 + Math.cos(a) * 3, WATER_LEVEL + 34 + 14, -175 + Math.sin(a) * 3);
    leg.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1);
    scene.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 0.8), flat(0xf2f2f2));
  bar.position.set(-95, WATER_LEVEL + 34 + 26, -175);
  scene.add(bar);
}

function addMarin(scene: THREE.Scene, rand: () => number): void {
  const hills: Hill[] = [
    { x: 120, z: 175, radius: 70, height: 40 },
    { x: 30, z: 215, radius: 80, height: 48 },
    { x: -80, z: 200, radius: 70, height: 36 },
    { x: -170, z: 170, radius: 60, height: 28 },
    { x: 200, z: 140, radius: 55, height: 26 },
  ];
  for (const h of hills) {
    const geo = new THREE.ConeGeometry(h.radius, h.height, 8, 3);
    jitter(geo, 2.5, rand, (v) => v.y > h.height / 2 - 0.01);
    const mesh = new THREE.Mesh(geo, flat(rand() > 0.4 ? 0x6f9a4a : 0xa59a5e));
    mesh.position.set(h.x, WATER_LEVEL + h.height / 2 - 1, h.z);
    mesh.rotation.y = rand() * Math.PI;
    scene.add(mesh);
  }
}

function addAlcatraz(scene: THREE.Scene): void {
  const x = 85;
  const z = 45;
  const island = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 6, 7), flat(0x8f8270));
  island.position.set(x, WATER_LEVEL + 1.5, z);
  scene.add(island);
  const prison = new THREE.Mesh(new THREE.BoxGeometry(10, 3.5, 4), flat(0xe6e0d2));
  prison.position.set(x, WATER_LEVEL + 6.2, z);
  scene.add(prison);
  const lighthouse = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 7, 6), flat(0xf4f4f4));
  lighthouse.position.set(x - 6, WATER_LEVEL + 8, z + 2);
  scene.add(lighthouse);
}

function addClouds(scene: THREE.Scene, rand: () => number): void {
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.25,
  });
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const r = 180 + rand() * 300;
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(8 + rand() * 8, 0), cloudMat);
      puff.position.set((p - puffs / 2) * 10 + rand() * 4, rand() * 4, rand() * 6);
      cloud.add(puff);
    }
    cloud.scale.set(1, 0.45, 0.7);
    cloud.position.set(Math.cos(a) * r, 60 + rand() * 50, Math.sin(a) * r);
    cloud.rotation.y = rand() * Math.PI;
    scene.add(cloud);
  }
}

/**
 * "Golden Gate bridge" by Steren Giannini (CC-BY 3.0), via Poly Pizza.
 * Its baked-in water slab is hidden so it stands in our bay.
 */
function loadGoldenGate(scene: THREE.Scene): void {
  const SCALE = 24;
  const MODEL_WATER_TOP = -0.74;
  const MODEL_CENTER_Z = 0.77;
  new GLTFLoader().load('/models/golden-gate.glb', (gltf) => {
    const bridge = gltf.scene;
    bridge.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.name === 'mat4') mesh.visible = false;
    });
    bridge.scale.setScalar(SCALE);
    // Model's long axis is +Z; rotate so the span runs along world X
    bridge.rotation.y = Math.PI / 2;
    bridge.position.set(-MODEL_CENTER_Z * SCALE, WATER_LEVEL - MODEL_WATER_TOP * SCALE, 135);
    scene.add(bridge);
  }, undefined, (err) => console.warn('[arena] Golden Gate model failed to load:', err));
}

// ─── Helpers ─────────────────────────────────────────────────────────

function flat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
}

/** Randomly displace vertices for a faceted low-poly look; `keep` pins vertices (e.g. a flat top) */
function jitter(
  geo: THREE.BufferGeometry, amount: number, rand: () => number,
  keep: (v: THREE.Vector3) => boolean, axis: 'all' | 'z' = 'all',
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const offsets = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (keep(v)) continue;
    // Same offset for vertices sharing a position, so seams don't tear open
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let o = offsets.get(key);
    if (!o) {
      o = axis === 'z'
        ? new THREE.Vector3(0, 0, (rand() - 0.5) * amount)
        : new THREE.Vector3((rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount);
      offsets.set(key, o);
    }
    pos.setXYZ(i, v.x + o.x, v.y + o.y, v.z + o.z);
  }
  geo.computeVertexNormals();
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
