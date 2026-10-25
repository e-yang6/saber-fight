/**
 * DeviceOrientation → quaternion conversion.
 * Matches Three.js DeviceOrientationControls exactly:
 *   1. YXZ Euler from (beta, alpha, -gamma)
 *   2. Post-multiply by -90° X rotation (device→world)
 *   3. Post-multiply by screen orientation around Z
 */

const DEG2RAD = Math.PI / 180;

let screenOrientation = 0;

export function initOrientation(): void {
  updateScreenOrientation();
  window.addEventListener('orientationchange', updateScreenOrientation);
  screen.orientation?.addEventListener('change', updateScreenOrientation);
}

function updateScreenOrientation(): void {
  screenOrientation = (screen.orientation?.angle ?? window.orientation ?? 0) as number;
}

/**
 * Convert device orientation (alpha, beta, gamma in degrees) to a quaternion.
 * Returns [x, y, z, w].
 */
export function orientationToQuaternion(
  alpha: number,
  beta: number,
  gamma: number
): [number, number, number, number] {
  // YXZ Euler: Y=alpha, X=beta, Z=-gamma (Three.js convention)
  const a = alpha * DEG2RAD;
  const b = beta * DEG2RAD;
  const g = -gamma * DEG2RAD;

  const c1 = Math.cos(a / 2), s1 = Math.sin(a / 2);
  const c2 = Math.cos(b / 2), s2 = Math.sin(b / 2);
  const c3 = Math.cos(g / 2), s3 = Math.sin(g / 2);

  // YXZ quaternion
  const x = s2 * c1 * c3 + c2 * s1 * s3;
  const y = c2 * s1 * c3 - s2 * c1 * s3;
  const z = c2 * c1 * s3 - s2 * s1 * c3;
  const w = c2 * c1 * c3 + s2 * s1 * s3;

  // Post-multiply by q1 = rotation(-π/2 around X) = (-√2/2, 0, 0, √2/2)
  const sq2 = Math.SQRT1_2;
  let rx = sq2 * (x - w);
  let ry = sq2 * (y - z);
  let rz = sq2 * (y + z);
  let rw = sq2 * (w + x);

  // Post-multiply by screen orientation: rotation(-screenOrientation around Z)
  if (screenOrientation !== 0) {
    const so = -screenOrientation * DEG2RAD / 2;
    const cs = Math.cos(so);
    const ss = Math.sin(so);
    const fx = rx * cs + ry * ss;
    const fy = ry * cs - rx * ss;
    const fz = rz * cs + rw * ss;
    const fw = rw * cs - rz * ss;
    return [fx, fy, fz, fw];
  }

  return [rx, ry, rz, rw];
}

/**
 * Compute yaw-only calibration offset.
 * Call when the user points their phone at the screen.
 * Returns a yaw offset quaternion that maps current yaw → forward.
 */
export function computeYawOffset(
  alpha: number
): [number, number, number, number] {
  const halfA = -alpha * DEG2RAD / 2;
  return [0, Math.sin(halfA), 0, Math.cos(halfA)];
}

/**
 * Apply yaw offset to an orientation quaternion.
 * q_result = q_offset * q_raw (pre-multiply)
 */
export function applyYawOffset(
  q: [number, number, number, number],
  offset: [number, number, number, number]
): [number, number, number, number] {
  const [ox, oy, oz, ow] = offset;
  const [qx, qy, qz, qw] = q;
  return [
    ow * qx + ox * qw + oy * qz - oz * qy,
    ow * qy - ox * qz + oy * qw + oz * qx,
    ow * qz + ox * qy - oy * qx + oz * qw,
    ow * qw - ox * qx - oy * qy - oz * qz,
  ];
}
