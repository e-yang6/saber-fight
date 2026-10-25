/**
 * Same math as the web controller (src/client/controller/orientation.ts) so the server
 * sees identical quaternions. Expo's DeviceMotion rotation uses the same Z-X'-Y'' Euler
 * order as the browser's deviceorientation (only the angle ranges differ), so the
 * conversion carries over once radians are turned into degrees. The app is portrait-locked,
 * so there is no screen-orientation term.
 */

export type Quat = [number, number, number, number];

const DEG2RAD = Math.PI / 180;

/** alpha/beta/gamma in degrees → [x, y, z, w] */
export function orientationToQuaternion(alpha: number, beta: number, gamma: number): Quat {
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

  // Post-multiply by rotation(-π/2 around X): device → world
  const sq2 = Math.SQRT1_2;
  return [sq2 * (x - w), sq2 * (y - z), sq2 * (y + z), sq2 * (w + x)];
}

/** Yaw-only offset that maps the current heading to "forward" (point the phone at the screen) */
export function computeYawOffset(alpha: number): Quat {
  const halfA = -alpha * DEG2RAD / 2;
  return [0, Math.sin(halfA), 0, Math.cos(halfA)];
}

/** offset * q */
export function applyYawOffset(q: Quat, offset: Quat): Quat {
  const [ox, oy, oz, ow] = offset;
  const [qx, qy, qz, qw] = q;
  return [
    ow * qx + ox * qw + oy * qz - oz * qy,
    ow * qy - ox * qz + oy * qw + oz * qx,
    ow * qz + ox * qy - oy * qx + oz * qw,
    ow * qw - ox * qx - oy * qy - oz * qz,
  ];
}
