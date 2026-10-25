/**
 * Collision detection using shared math (no Three.js dependency).
 * Runs on the server for authoritative physics.
 */

import { Vec3 } from './math.js';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Closest points between two line segments. Returns squared distance
 * and the closest point on each segment.
 */
export function segmentSegmentDistSq(
  a0: Vec3, a1: Vec3,
  b0: Vec3, b1: Vec3,
): { distSq: number; pointA: Vec3; pointB: Vec3 } {
  const d1 = Vec3.sub(a1, a0);
  const d2 = Vec3.sub(b1, b0);
  const r = Vec3.sub(a0, b0);

  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);

  let s: number, t: number;

  if (a <= 1e-8 && e <= 1e-8) {
    s = t = 0;
  } else if (a <= 1e-8) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-8) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;

      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  const pointA = a0.clone().addScaled(d1, s);
  const pointB = b0.clone().addScaled(d2, t);
  const distSq = pointA.distanceToSq(pointB);

  return { distSq, pointA, pointB };
}

/**
 * Check if a line segment intersects a capsule (segment + radius).
 */
export function segmentCapsuleIntersect(
  segA: Vec3, segB: Vec3,
  capA: Vec3, capB: Vec3, capR: number,
): { hit: boolean; point: Vec3; depth: number } {
  const { distSq, pointA } = segmentSegmentDistSq(segA, segB, capA, capB);
  const dist = Math.sqrt(distSq);
  const hit = dist < capR;
  return { hit, point: pointA, depth: hit ? capR - dist : 0 };
}

/**
 * Swept collision: check if a moving blade passed through a body
 * between two frames using linear interpolation of endpoints.
 */
export function sweptBladeBodyCheck(
  prevTip: Vec3, prevBase: Vec3,
  currTip: Vec3, currBase: Vec3,
  bodyA: Vec3, bodyB: Vec3, bodyR: number,
  steps = 3,
): { hit: boolean; point: Vec3 } {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const tip = Vec3.lerp(prevTip, currTip, t);
    const base = Vec3.lerp(prevBase, currBase, t);

    const result = segmentCapsuleIntersect(tip, base, bodyA, bodyB, bodyR);
    if (result.hit) {
      return { hit: true, point: result.point };
    }
  }

  return { hit: false, point: new Vec3() };
}
