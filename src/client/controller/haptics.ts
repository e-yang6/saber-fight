import type { HapticEffect } from '@shared/protocol.js';

/**
 * Layered haptics module:
 * 1. navigator.vibrate (Android)
 * 2. iOS 18+ hidden switch toggle trick
 * 3. Full-screen flash fallback
 */

let hasVibrate = false;
let hasIOSSwitch = false;
const flashEl = document.getElementById('flash-overlay')!;
const hapticLabel = document.getElementById('haptic-label') as HTMLLabelElement;

const PATTERNS: Record<HapticEffect, { vibrate: number[]; iosTicks: number; flashCount: number }> = {
  clash:      { vibrate: [30, 20, 30], iosTicks: 3, flashCount: 2 },
  hit_landed: { vibrate: [20],         iosTicks: 1, flashCount: 1 },
  got_hit:    { vibrate: [50, 30, 50, 30, 50], iosTicks: 5, flashCount: 3 },
  block:      { vibrate: [30, 20, 30], iosTicks: 2, flashCount: 1 },
  powerup:    { vibrate: [40, 30, 40], iosTicks: 3, flashCount: 2 },
};

export function initHaptics(): { vibrate: boolean; iosSwitch: boolean } {
  hasVibrate = typeof navigator.vibrate === 'function';

  // Detect iOS switch element support
  const switchEl = document.getElementById('haptic-switch') as HTMLInputElement;
  hasIOSSwitch = switchEl?.type === 'checkbox' && 'switch' in switchEl;

  const status = { vibrate: hasVibrate, iosSwitch: hasIOSSwitch };
  console.log('[haptics] available:', status);
  return status;
}

export function haptic(effect: HapticEffect): void {
  const pattern = PATTERNS[effect];
  if (!pattern) return;

  if (hasVibrate) {
    navigator.vibrate(pattern.vibrate);
    return;
  }

  if (hasIOSSwitch) {
    fireIOSTicks(pattern.iosTicks);
    return;
  }

  // Fallback: screen flash
  fireFlash(pattern.flashCount);
}

function fireIOSTicks(count: number): void {
  let i = 0;
  const tick = () => {
    if (i >= count) return;
    hapticLabel.click();
    i++;
    if (i < count) setTimeout(tick, 60);
  };
  tick();
}

function fireFlash(count: number): void {
  let i = 0;
  const flash = () => {
    if (i >= count) return;
    flashEl.classList.add('flash');
    setTimeout(() => {
      flashEl.classList.remove('flash');
      i++;
      if (i < count) setTimeout(flash, 80);
    }, 50);
  };
  flash();
}

export function testAllHaptics(): void {
  const effects: HapticEffect[] = ['clash', 'hit_landed', 'got_hit', 'block', 'powerup'];
  let i = 0;
  const next = () => {
    if (i >= effects.length) return;
    console.log(`[haptics] testing: ${effects[i]}`);
    haptic(effects[i]);
    i++;
    setTimeout(next, 600);
  };
  next();
}
