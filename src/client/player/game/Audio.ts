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

/** Power-up activation sound */
export function playPowerup(): void {
  const c = getCtx();
  const now = c.currentTime;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.3);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.4);
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
