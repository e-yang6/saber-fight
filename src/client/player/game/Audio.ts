/**
 * Procedural audio using Web Audio API.
 * No audio files — everything is synthesized.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode;

// Persistent saber hum oscillators per player
const hums: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map();

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function initAudio(): void {
  // Create on first user interaction
  document.addEventListener('click', () => getCtx(), { once: true });
  document.addEventListener('keydown', () => getCtx(), { once: true });
}

/** Start persistent saber hum for a player */
export function startHum(slot: number): void {
  const c = getCtx();
  if (hums.has(slot)) return;

  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 85 + slot * 10;

  const gain = c.createGain();
  gain.gain.value = 0.05;

  // Low-pass to make it a warm hum
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 200;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start();

  hums.set(slot, { osc, gain });
}

/** Update hum pitch based on swing speed */
export function updateHum(slot: number, tipSpeed: number): void {
  const hum = hums.get(slot);
  if (!hum) return;
  // Pitch up with speed
  const baseFreq = 85 + slot * 10;
  hum.osc.frequency.value = baseFreq + tipSpeed * 15;
  // Volume up slightly with speed
  hum.gain.gain.value = 0.05 + Math.min(tipSpeed * 0.01, 0.1);
}

/** Swoosh sound on fast swings */
export function playSwoosh(speed: number): void {
  const c = getCtx();
  const now = c.currentTime;

  // Filtered noise burst
  const bufferSize = c.sampleRate * 0.15;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const source = c.createBufferSource();
  source.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800 + speed * 200;
  filter.Q.value = 2;

  const gain = c.createGain();
  gain.gain.setValueAtTime(Math.min(speed * 0.05, 0.3), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(now);
  source.stop(now + 0.15);
}

/** Metallic clash sound */
export function playClash(): void {
  const c = getCtx();
  const now = c.currentTime;

  // Sharp metallic ping
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  // Noise component for metallic texture
  const bufferSize = c.sampleRate * 0.1;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.15, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  const hipass = c.createBiquadFilter();
  hipass.type = 'highpass';
  hipass.frequency.value = 3000;

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.3);

  noise.connect(hipass);
  hipass.connect(noiseGain);
  noiseGain.connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.1);
}

/** Thuddy hit sound */
export function playHit(): void {
  const c = getCtx();
  const now = c.currentTime;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.2);
}

/** Block sound — dull clank */
export function playBlock(): void {
  const c = getCtx();
  const now = c.currentTime;

  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.15);
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Shockwave (Guardian) — deep sub-bass boom with a rumbling noise tail */
export function playShockwave(): void {
  const c = getCtx();
  const now = c.currentTime;

  const boom = c.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(120, now);
  boom.frequency.exponentialRampToValueAtTime(30, now + 0.8);
  const boomGain = c.createGain();
  boomGain.gain.setValueAtTime(0.9, now);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
  boom.connect(boomGain);
  boomGain.connect(masterGain);
  boom.start(now);
  boom.stop(now + 0.9);

  const rumble = c.createBufferSource();
  rumble.buffer = noiseBuffer(c, 0.8);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1500, now);
  lp.frequency.exponentialRampToValueAtTime(80, now + 0.8);
  const rumbleGain = c.createGain();
  rumbleGain.gain.setValueAtTime(0.5, now);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  rumble.connect(lp);
  lp.connect(rumbleGain);
  rumbleGain.connect(masterGain);
  rumble.start(now);
  rumble.stop(now + 0.8);
}

/** Overcharge (Striker) — rising detuned sawtooth power-up with electric crackle */
export function playOvercharge(): void {
  const c = getCtx();
  const now = c.currentTime;

  const bp = c.createBiquadFilter();
  bp.type = 'lowpass';
  bp.frequency.setValueAtTime(400, now);
  bp.frequency.exponentialRampToValueAtTime(4000, now + 0.5);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.35, now + 0.4);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
  bp.connect(gain);
  gain.connect(masterGain);
  for (const detune of [-12, 0, 7]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.5);
    osc.detune.value = detune * 100;
    osc.connect(bp);
    osc.start(now);
    osc.stop(now + 0.9);
  }

  const crackle = c.createBufferSource();
  crackle.buffer = noiseBuffer(c, 0.6);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const crackleGain = c.createGain();
  crackleGain.gain.setValueAtTime(0.25, now + 0.3);
  crackleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
  crackle.connect(hp);
  hp.connect(crackleGain);
  crackleGain.connect(masterGain);
  crackle.start(now + 0.3);
  crackle.stop(now + 0.9);
}

/** Barrier (Mystic) — shimmering bell chord with tremolo */
export function playBarrier(): void {
  const c = getCtx();
  const now = c.currentTime;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.4, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

  const tremolo = c.createGain();
  tremolo.gain.value = 0.7;
  const lfo = c.createOscillator();
  lfo.frequency.value = 9;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.3;
  lfo.connect(lfoDepth);
  lfoDepth.connect(tremolo.gain);
  lfo.start(now);
  lfo.stop(now + 1.4);

  tremolo.connect(gain);
  gain.connect(masterGain);
  for (const freq of [523.25, 659.25, 783.99, 1046.5]) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.98, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.2);
    osc.connect(tremolo);
    osc.start(now);
    osc.stop(now + 1.4);
  }
}

/** Blink (Phantom) — fast downward zip plus an airy whoosh */
export function playBlink(): void {
  const c = getCtx();
  const now = c.currentTime;

  const zip = c.createOscillator();
  zip.type = 'square';
  zip.frequency.setValueAtTime(2400, now);
  zip.frequency.exponentialRampToValueAtTime(150, now + 0.18);
  const zipFilter = c.createBiquadFilter();
  zipFilter.type = 'lowpass';
  zipFilter.frequency.value = 3000;
  const zipGain = c.createGain();
  zipGain.gain.setValueAtTime(0.3, now);
  zipGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  zip.connect(zipFilter);
  zipFilter.connect(zipGain);
  zipGain.connect(masterGain);
  zip.start(now);
  zip.stop(now + 0.2);

  const air = c.createBufferSource();
  air.buffer = noiseBuffer(c, 0.35);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.5;
  bp.frequency.setValueAtTime(3000, now);
  bp.frequency.exponentialRampToValueAtTime(500, now + 0.35);
  const airGain = c.createGain();
  airGain.gain.setValueAtTime(0.35, now);
  airGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  air.connect(bp);
  bp.connect(airGain);
  airGain.connect(masterGain);
  air.start(now);
  air.stop(now + 0.35);
}

/** Splash sound for falling into water */
export function playSplash(): void {
  const c = getCtx();
  const now = c.currentTime;

  const bufferSize = c.sampleRate * 0.5;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.15));
  }

  const source = c.createBufferSource();
  source.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, now);
  filter.frequency.exponentialRampToValueAtTime(200, now + 0.5);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(now);
  source.stop(now + 0.5);
}
