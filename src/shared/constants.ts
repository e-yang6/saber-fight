// ─── Game tuning constants ──────────────────────────────────────────

export const ORIENTATION_SEND_RATE = 60; // Hz
export const RECONNECT_TIMEOUT = 30_000; // ms before slot is freed
export const SLERP_FACTOR = 0.95; // orientation smoothing (higher = snappier)

// ─── Combat ─────────────────────────────────────────────────────────

export const SWING_SPEED_THRESHOLD = 1.5; // m/s blade tip speed to count as a hit
export const BASE_KNOCKBACK = 1.2; // meters slid per clean hit
export const KNOCKBACK_SPEED_SCALE = 0.15; // extra meters per m/s above threshold
export const MAX_KNOCKBACK = 2.5; // meters, before class/ability multipliers
export const KNOCKBACK_FRICTION = 5; // 1/s velocity decay; slide distance = velocity / friction
export const HIT_COOLDOWN_MS = 350; // one hit per swing, not one per tick of overlap
export const CLASH_HITSTOP_MS = 120;
export const HIT_HITSTOP_MS = 90; // freeze-frame on a clean hit; sells the impact
export const CLASH_PUSHBACK = 0.5; // meters each fighter slides apart on a blade clash
export const BLOCK_PUSHBACK = 0.7; // meters a parried attacker is shoved back
export const BLOCK_STUN_MS = 700;
/**
 * A block holds when the guard is roughly perpendicular to the incoming swing:
 * |dot(guardDir, swingDir)| must be below this. Flat guard stops chops, upright guard stops side swings.
 */
export const BLOCK_ANGLE_TOLERANCE = 0.6;
export const GYRO_STALE_MS = 150; // ignore phone rotation rate older than this
export const GUARD_TRANSITION_MS = 100; // time for the blade to turn into / out of the guard pose

// ─── Arena ──────────────────────────────────────────────────────────

export const PLATFORM_RADIUS = 8.0;
export const PLATFORM_HEIGHT = 0.3;
export const FIGHTER_START_DISTANCE = 0.9; // distance from center for each fighter (1.8m apart)
export const IDEAL_FIGHT_DISTANCE = 1.8; // target distance between fighters (auto-advance)
export const MIN_FIGHT_DISTANCE = 1.0; // don't let fighters overlap
export const AUTO_ADVANCE_SPEED = 2.0; // m/s fighters close the gap
export const WATER_LEVEL = -8.0; // bay surface below the platform; touching it loses the round
/** Off the edge: heavier-than-real gravity plus an initial drop so the ring-out lands in ~0.7s */
export const FALL_GRAVITY = 25;
export const FALL_START_SPEED = 3;

// ─── Match ──────────────────────────────────────────────────────────

export const ROUNDS_TO_WIN = 2; // best of 3
export const COUNTDOWN_SECONDS = 3;
export const ROUND_END_DELAY_MS = 2500;
export const SLOWMO_DURATION_MS = 400;
export const SLOWMO_FACTOR = 0.25;

// ─── Saber dimensions ──────────────────────────────────────────────

export const BLADE_LENGTH = 1.2; // meters
export const BLADE_RADIUS = 0.02;
export const HILT_LENGTH = 0.25;

// ─── Fighter body collision capsules ────────────────────────────────

export const BODY_CAPSULE_RADIUS = 0.25;
export const BODY_CAPSULE_HEIGHT = 1.0;
export const HEAD_RADIUS = 0.18;

// ─── Feature flags ──────────────────────────────────────────────────

export const FEATURES = {
  HEAD_TRACKING: true,
  PARALLAX_CAMERA: true,
  SPLIT_SCREEN: true,
};
