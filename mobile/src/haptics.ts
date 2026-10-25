import * as Haptics from 'expo-haptics';
import type { HapticEffect } from '../../src/shared/protocol';

/**
 * Layered Taptic patterns: several impacts a few tens of ms apart read as one rich hit
 * (a sharp "clang" for blade-on-blade, a heavy thud with a tail for body hits).
 */

type Pulse = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'success' | 'warning' | 'error';
type Pattern = [delayMs: number, pulse: Pulse][];

const IMPACT: Partial<Record<Pulse, Haptics.ImpactFeedbackStyle>> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
  soft: Haptics.ImpactFeedbackStyle.Soft,
};
const NOTIFY: Partial<Record<Pulse, Haptics.NotificationFeedbackType>> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

function pulse(p: Pulse): void {
  const impact = IMPACT[p];
  if (impact) {
    Haptics.impactAsync(impact).catch(() => {});
    return;
  }
  const notify = NOTIFY[p];
  if (notify) Haptics.notificationAsync(notify).catch(() => {});
}

function play(pattern: Pattern): void {
  for (const [delay, p] of pattern) {
    if (delay === 0) pulse(p);
    else setTimeout(() => pulse(p), delay);
  }
}

/** Blade on blade: hard metallic clang that rings out */
const CLASH: Pattern = [[0, 'rigid'], [22, 'heavy'], [60, 'rigid'], [115, 'medium'], [185, 'light'], [260, 'light']];
/** Parried: solid stop, then a soft give */
const BLOCK: Pattern = [[0, 'rigid'], [28, 'heavy'], [95, 'soft']];
const POWERUP: Pattern = [[0, 'success'], [160, 'light'], [220, 'medium'], [290, 'heavy']];

function hitLanded(power: number, smash: boolean): Pattern {
  if (smash) {
    return [[0, 'heavy'], [28, 'rigid'], [60, 'heavy'], [100, 'heavy'], [150, 'medium'], [215, 'light'], [290, 'light']];
  }
  const p: Pattern = [[0, power > 0.35 ? 'heavy' : 'medium']];
  if (power > 0.3) p.push([45, 'medium']);
  if (power > 0.6) p.push([95, 'heavy'], [150, 'light']);
  return p;
}

function gotHit(power: number, smash: boolean): Pattern {
  const p: Pattern = [[0, 'error'], [70, 'heavy']];
  if (power > 0.4 || smash) p.push([130, 'heavy'], [200, 'medium']);
  if (smash) p.push([260, 'heavy'], [330, 'heavy'], [410, 'medium'], [500, 'light']);
  return p;
}

export function playHaptic(effect: HapticEffect, power = 0.5, smash = false): void {
  switch (effect) {
    case 'clash': play(CLASH); break;
    case 'block': play(BLOCK); break;
    case 'powerup': play(POWERUP); break;
    case 'hit_landed': play(hitLanded(power, smash)); break;
    case 'got_hit': play(gotHit(power, smash)); break;
  }
}

/** Tactile tick for on-screen buttons */
export function tap(heavy = false): void {
  pulse(heavy ? 'medium' : 'light');
}

export function testAllHaptics(): void {
  const seq: [HapticEffect, number, boolean][] = [
    ['clash', 0.5, false], ['block', 0.5, false], ['hit_landed', 0.3, false],
    ['hit_landed', 1, true], ['got_hit', 0.5, false], ['got_hit', 1, true], ['powerup', 0, false],
  ];
  seq.forEach(([e, p, s], i) => setTimeout(() => playHaptic(e, p, s), i * 900));
}
