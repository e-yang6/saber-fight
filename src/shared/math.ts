/**
 * Lightweight vector/quaternion math for server-side use (no Three.js dependency).
 * The client converts these to/from Three.js types for rendering.
 */

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number]; // [x, y, z, w]

export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3): this {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x; this.y -= v.y; this.z -= v.z;
    return this;
  }

  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
    return this;
  }

  scale(s: number): this {
    this.x *= s; this.y *= s; this.z *= s;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const l = this.length();
    if (l > 1e-8) this.scale(1 / l);
    return this;
  }

  distanceTo(v: Vec3): number {
    return Math.sqrt(this.distanceToSq(v));
  }

  distanceToSq(v: Vec3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  lerp(v: Vec3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  clampLength(min: number, max: number): this {
    const l = this.length();
    if (l > max && l > 0) this.scale(max / l);
    else if (l < min && l > 0) this.scale(min / l);
    return this;
  }

  toArray(): Vec3Tuple {
    return [this.x, this.y, this.z];
  }

  static fromArray(a: Vec3Tuple): Vec3 {
    return new Vec3(a[0], a[1], a[2]);
  }

  static sub(a: Vec3, b: Vec3): Vec3 {
    return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  static add(a: Vec3, b: Vec3): Vec3 {
    return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  static lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return new Vec3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  }
}

export class Quat {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x; this.y = y; this.z = z; this.w = w;
    return this;
  }

  copy(q: Quat): this {
    this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w;
    return this;
  }

  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }

  /** Hamilton product: this = this * q */
  multiply(q: Quat): this {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = q.x, by = q.y, bz = q.z, bw = q.w;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }

  slerp(target: Quat, t: number): this {
    let dot = this.x * target.x + this.y * target.y + this.z * target.z + this.w * target.w;

    let tx = target.x, ty = target.y, tz = target.z, tw = target.w;
    if (dot < 0) {
      dot = -dot;
      tx = -tx; ty = -ty; tz = -tz; tw = -tw;
    }

    if (dot > 0.9995) {
      this.x += (tx - this.x) * t;
      this.y += (ty - this.y) * t;
      this.z += (tz - this.z) * t;
      this.w += (tw - this.w) * t;
      return this.normalize();
    }

    const theta = Math.acos(Math.min(dot, 1));
    const sinTheta = Math.sin(theta);
    const a = Math.sin((1 - t) * theta) / sinTheta;
    const b = Math.sin(t * theta) / sinTheta;

    this.x = a * this.x + b * tx;
    this.y = a * this.y + b * ty;
    this.z = a * this.z + b * tz;
    this.w = a * this.w + b * tw;
    return this;
  }

  normalize(): this {
    const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (l > 1e-8) {
      const il = 1 / l;
      this.x *= il; this.y *= il; this.z *= il; this.w *= il;
    }
    return this;
  }

  /** Rotate a vector by this quaternion: v' = q * v * q⁻¹ */
  rotateVec3(v: Vec3): Vec3 {
    const ix = this.w * v.x + this.y * v.z - this.z * v.y;
    const iy = this.w * v.y + this.z * v.x - this.x * v.z;
    const iz = this.w * v.z + this.x * v.y - this.y * v.x;
    const iw = -this.x * v.x - this.y * v.y - this.z * v.z;

    return new Vec3(
      ix * this.w + iw * -this.x + iy * -this.z - iz * -this.y,
      iy * this.w + iw * -this.y + iz * -this.x - ix * -this.z,
      iz * this.w + iw * -this.z + ix * -this.y - iy * -this.x,
    );
  }

  toArray(): QuatTuple {
    return [this.x, this.y, this.z, this.w];
  }

  static fromArray(a: QuatTuple): Quat {
    return new Quat(a[0], a[1], a[2], a[3]);
  }

  static identity(): Quat {
    return new Quat(0, 0, 0, 1);
  }

  /** Rotation around Y axis by angle radians */
  static fromYaw(angle: number): Quat {
    const half = angle / 2;
    return new Quat(0, Math.sin(half), 0, Math.cos(half));
  }

  /** Rotation around an arbitrary axis by angle radians */
  static fromAxisAngle(ax: number, ay: number, az: number, angle: number): Quat {
    const half = angle / 2;
    const s = Math.sin(half);
    return new Quat(ax * s, ay * s, az * s, Math.cos(half));
  }

  /** Pre-multiply: result = a * b */
  static multiply(a: Quat, b: Quat): Quat {
    return a.clone().multiply(b);
  }

  /** Slerp between two quaternions, returning a new Quat */
  static slerp(a: Quat, b: Quat, t: number): Quat {
    return a.clone().slerp(b, t);
  }
}
