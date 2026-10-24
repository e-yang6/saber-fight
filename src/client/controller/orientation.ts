/**
 * DeviceOrientation → quaternion conversion.
 * Phone held like a saber hilt: top edge (+Y) = blade direction.
 *
 * Uses the standard ZXY Euler→quaternion formula from Three.js DeviceOrientationControls,
 * accounting for screen orientation. Avoids gimbal lock by working in quaternions.
 */

const DEG2RAD = Math.PI / 180;

// Reusable output
const _q: [number, number, number, number] = [0, 0, 0, 1];

// Screen orientation offset (portrait = 0)
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
  // ZXY intrinsic Tait-Bryan angles → quaternion
  const a = alpha * DEG2RAD; // Z
  const b = beta * DEG2RAD;  // X'
  const g = gamma * DEG2RAD; // Y''

  const ca = Math.cos(a / 2);
  const sa = Math.sin(a / 2);
  const cb = Math.cos(b / 2);
  const sb = Math.sin(b / 2);
  const cg = Math.cos(g / 2);
  const sg = Math.sin(g / 2);

  // ZXY order
  let x = sb * cg * ca - cb * sg * sa;
  let y = cb * sg * ca + sb * cg * sa;
  let z = cb * cg * sa + sb * sg * ca;
  let w = cb * cg * ca - sb * sg * sa;

  // Apply world-to-screen rotation (-90° around X to go from device to world coords)
  // Equivalent to pre-multiplying by q(-π/2, X)
  const sq2 = Math.SQRT1_2;
  const wx = w * (-sq2) + x * sq2;
  const xx = x * sq2 + w * sq2;
  const yx = y * sq2 + z * (-sq2);
  const zx = z * sq2 + y * sq2;

  // Apply screen orientation as a rotation around Z
  if (screenOrientation !== 0) {
    const so = -screenOrientation * DEG2RAD / 2;
    const cs = Math.cos(so);
    const ss = Math.sin(so);
    _q[0] = xx * cs + yx * ss;
    _q[1] = yx * cs - xx * ss;
    _q[2] = zx * cs + wx * ss;
    _q[3] = wx * cs - zx * ss;
  } else {
    _q[0] = xx;
    _q[1] = yx;
    _q[2] = zx;
    _q[3] = wx;
  }

  return [_q[0], _q[1], _q[2], _q[3]];
}

/**
 * Compute yaw-only calibration offset.
 * Call when the user points their phone at the screen.
 * Returns a yaw offset quaternion that maps current yaw → forward.
 */
export function computeYawOffset(
  alpha: number
): [number, number, number, number] {
  // Yaw-only: rotation around Y axis by -alpha
  const halfA = -alpha * DEG2RAD / 2;
  return [0, Math.sin(halfA), 0, Math.cos(halfA)];
}

/**
 * Apply yaw offset to an orientation quaternion.
 * q_result = q_offset * q_raw
 */
export function applyYawOffset(
  q: [number, number, number, number],
  offset: [number, number, number, number]
): [number, number, number, number] {
  // Hamilton product: offset * q
  const [ox, oy, oz, ow] = offset;
  const [qx, qy, qz, qw] = q;
  return [
    ow * qx + ox * qw + oy * qz - oz * qy,
    ow * qy - ox * qz + oy * qw + oz * qx,
    ow * qz + ox * qy - oy * qx + oz * qw,
    ow * qw - ox * qx - oy * qy - oz * qz,
  ];
}
