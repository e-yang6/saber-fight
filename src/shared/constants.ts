// ─── Game tuning constants ──────────────────────────────────────────

export const ORIENTATION_SEND_RATE = 60; // Hz
export const RECONNECT_TIMEOUT = 30_000; // ms before slot is freed
export const SLERP_FACTOR = 0.6; // orientation smoothing (higher = snappier)

// ─── Combat ─────────────────────────────────────────────────────────

export const SWING_SPEED_THRESHOLD = 3.0; // m/s blade tip speed to count as a hit
export const BASE_KNOCKBACK = 1.5; // base knockback distance
export const KNOCKBACK_SPEED_SCALE = 0.4; // extra knockback per m/s above threshold
export const CLASH_HITSTOP_MS = 80;
export const BLOCK_STUN_MS = 700;
export const BLOCK_ANGLE_TOLERANCE = 0.7; // dot product threshold for block angle

// ─── Arena ──────────────────────────────────────────────────────────

export const PLATFORM_RADIUS = 6.0;
export const PLATFORM_HEIGHT = 0.3;
export const FIGHTER_START_DISTANCE = 3.0; // distance from center for each fighter
export const FALL_THRESHOLD = -2.0; // Y position below which player has fallen off

// ─── Match ──────────────────────────────────────────────────────────

export const ROUNDS_TO_WIN = 2; // best of 3
export const COUNTDOWN_SECONDS = 3;
export const ROUND_END_DELAY_MS = 2500;
export const SLOWMO_DURATION_MS = 1000;
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
