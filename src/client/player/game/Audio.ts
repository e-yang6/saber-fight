/**
 * Game audio using the Web Audio API.
 * One-shot effects play samples from /sfx (see public/sfx/CREDITS.txt); each falls back
 * to its procedural synth version until its file has loaded or if loading fails.
 * The saber hum is always synthesized.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode;
let sampleBus: GainNode;

// Persistent saber hum oscillators per player
const hums: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map();

/** Samples are peak-normalized to -1 dBFS; this brings them level with the synth sounds */
const SAMPLE_BUS_GAIN = 1.5;

const SAMPLES = {
  swoosh: ['swoosh-1.wav', 'swoosh-2.wav', 'swoosh-3.wav', 'swoosh-4.wav', 'swoosh-5.wav', 'swoosh-6.wav'],
  clashBody: ['clash-body-1.wav', 'clash-body-2.wav'],
  clashCrack: ['clash-crack-1.wav', 'clash-crack-2.wav'],
  hit: ['hit-1.wav', 'hit-2.wav', 'hit-3.wav'],
  smashImpact: ['smash-impact.wav'],
  smashBoom: ['smash-boom.wav'],
  countdownTick: ['countdown-tick.wav'],
  countdownGo: ['countdown-go.wav'],
  announcerFight: ['announcer-fight.wav'],
  block: ['block-1.wav', 'block-2.wav'],
  shockwave: ['shockwave.wav'],
  overcharge: ['overcharge.wav'],
  barrier: ['barrier.wav'],
  blink: ['blink.wav'],
  skyBeamLaser: ['skybeam-laser.wav'],
  skyBeamCrunch: ['skybeam-crunch.wav'],
  splash: ['splash.wav'],
  victory: ['victory.mp3'],
  defeat: ['defeat.mp3'],
  blueSmashVoice: ['blue-smash-1.wav', 'blue-smash-2.wav', 'blue-smash-3.wav'],
  blueWinVoice: ['blue-win.wav'],
  blueLossVoice: ['blue-loss.wav'],
  yellowSmashVoice: ['yellow-smash-1.wav', 'yellow-smash-2.wav', 'yellow-smash-3.wav'],
  yellowWinVoice: ['yellow-win.wav'],
  yellowLossVoice: ['yellow-loss.wav'],
} as const;

/** Voice lines per player slot for landing a smash */
const SMASH_VOICE: Partial<Record<number, SampleKey>> = { 1: 'yellowSmashVoice', 2: 'blueSmashVoice' };
/** Voice lines per player slot for winning the whole match */
const WIN_VOICE: Partial<Record<number, SampleKey>> = { 1: 'yellowWinVoice', 2: 'blueWinVoice' };
/** Voice lines per player slot for losing the whole match */
const LOSS_VOICE: Partial<Record<number, SampleKey>> = { 1: 'yellowLossVoice', 2: 'blueLossVoice' };

type SampleKey = keyof typeof SAMPLES;

const buffers: Map<string, AudioBuffer> = new Map();
let jingle: AudioBufferSourceNode | null = null;
let voice: AudioBufferSourceNode | null = null;
let endVoices: AudioBufferSourceNode[] = [];

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);
    sampleBus = ctx.createGain();
    sampleBus.gain.value = SAMPLE_BUS_GAIN;
    sampleBus.connect(masterGain);
    loadSamples(ctx);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function loadSamples(c: AudioContext): void {
  for (const file of new Set(Object.values(SAMPLES).flat())) {
    fetch(`/sfx/${file}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${file}`);
        return res.arrayBuffer();
      })
      .then((data) => c.decodeAudioData(data))
      .then((buffer) => buffers.set(file, buffer))
      .catch((err) => console.warn('[audio] sample unavailable, using synth fallback:', err));
  }
}

/** Play a random loaded variant of `key`. Returns null if none are loaded yet. */
function sample(key: SampleKey, volume = 1, rate = 1, at = getCtx().currentTime): AudioBufferSourceNode | null {
  const loaded = SAMPLES[key].filter((f) => buffers.has(f));
  if (loaded.length === 0) return null;
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = buffers.get(loaded[Math.floor(Math.random() * loaded.length)])!;
  src.playbackRate.value = rate;
  const gain = c.createGain();
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(sampleBus);
  src.start(at);
  return src;
}

/** Small random pitch spread so repeated sounds don't feel identical */
function vary(spread = 0.06): number {
  return 1 + (Math.random() * 2 - 1) * spread;
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
  // Glide instead of stepping 60x/s, which zippers audibly
  const t = getCtx().currentTime;
  hum.osc.frequency.setTargetAtTime(baseFreq + Math.min(tipSpeed, 20) * 15, t, 0.03);
  hum.gain.gain.setTargetAtTime(0.05 + Math.min(tipSpeed * 0.01, 0.1), t, 0.03);
}

/** One swoosh per swing, louder and brighter when faster */
export function playSwoosh(speed: number): void {
  const k = Math.min(1, speed / 14);
  if (!sample('swoosh', 0.45 + k * 0.55, (0.9 + k * 0.25) * vary(0.04))) synthSwoosh(speed);
}

/** Blade-on-blade: metallic body plus a sharp crack */
export function playClash(): void {
  if (!sample('clashBody', 1, vary())) return synthClash();
  sample('clashCrack', 0.8, vary());
}

/** Saber connects with a body. `intensity` 0..1 scales it; a smash adds a cinematic impact and explosion. */
export function playHit(intensity = 0.5, smash = false): void {
  const k = 0.4 + Math.min(1, Math.max(0, intensity)) * 0.6;
  if (!sample('hit', k, vary())) return synthHit(intensity, smash);
  if (smash) {
    sample('smashImpact', 1);
    sample('smashBoom', 0.9);
  }
}

/** One beep per countdown number */
export function playCountdownTick(): void {
  if (!sample('countdownTick', 0.8)) tone(getCtx(), 'sine', 880, 880, 0.35, 0.25);
}

/** Round start: higher "go" beep plus the announcer's "Fight!" */
export function playFight(): void {
  if (!sample('countdownGo', 0.8)) tone(getCtx(), 'sine', 1320, 1320, 0.4, 0.6);
  sample('announcerFight', 1);
}

/** Random taunt from the attacker after a smash; skipped if a line is still playing so they never overlap */
export function playSmashVoice(attacker: number): void {
  const key = SMASH_VOICE[attacker];
  if (!key || voice) return;
  playVoice(key, 0.15);
}

function playVoice(key: SampleKey, delay: number): void {
  const src = sample(key, 1, 1, getCtx().currentTime + delay);
  voice = src;
  if (src) src.onended = () => { if (voice === src) voice = null; };
}

/** Successful parry */
export function playBlock(): void {
  if (!sample('block', 0.9, vary(0.04))) synthBlock();
}

/** Shockwave (Guardian) */
export function playShockwave(): void {
  if (!sample('shockwave', 1)) synthShockwave();
}

/** Overcharge (Striker) */
export function playOvercharge(): void {
  if (!sample('overcharge', 0.7)) synthOvercharge();
}

/** Barrier (Mystic) */
export function playBarrier(): void {
  if (!sample('barrier', 0.8)) synthBarrier();
}

/** Blink (Phantom) */
export function playBlink(): void {
  if (!sample('blink', 0.7)) synthBlink();
}

/** Ring-out sky beam: laser slamming down followed by an explosion crunch */
export function playSkyBeam(): void {
  if (!sample('skyBeamLaser', 0.8)) return synthSkyBeam();
  sample('skyBeamCrunch', 1, 1, getCtx().currentTime + 0.08);
}

/** Falling into the water */
export function playSplash(): void {
  if (!sample('splash', 0.9)) synthSplash();
}

export function playVictoryFanfare(): void {
  playJingle('victory', synthVictoryFanfare);
}

export function playDefeatSound(): void {
  playJingle('defeat', synthDefeatSound);
}

/** Winner's victory line, then the loser's reply once it finishes. Cuts off any smash line still playing. */
export function playMatchEndVoices(winner: number, loser: number): void {
  voice?.stop();
  voice = null;
  let at = getCtx().currentTime + 0.4;
  for (const key of [WIN_VOICE[winner], LOSS_VOICE[loser]]) {
    if (!key) continue;
    const src = sample(key, 1, 1, at);
    if (!src) continue;
    endVoices.push(src);
    at += src.buffer!.duration + 0.3;
  }
}

/** Cut off the end-of-match music and voice lines (e.g. on rematch) */
export function stopJingle(): void {
  jingle?.stop();
  jingle = null;
  voice?.stop();
  voice = null;
  for (const src of endVoices) src.stop();
  endVoices = [];
}

function playJingle(key: 'victory' | 'defeat', fallback: () => void): void {
  stopJingle();
  jingle = sample(key, 0.8);
  if (!jingle) fallback();
}

/** One-shot oscillator with an exponential decay envelope */
function tone(
  c: AudioContext, type: OscillatorType, f0: number, f1: number,
  peak: number, dur: number, at = c.currentTime,
): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(at);
  osc.stop(at + dur);
}

/** Filtered noise burst with an exponential decay envelope */
function noise(
  c: AudioContext, filterType: BiquadFilterType, freq: number, q: number,
  peak: number, dur: number, at = c.currentTime,
): BiquadFilterNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(at);
  src.stop(at + dur);
  return filter;
}

/** One "vwoom" per swing: noise swept through a bandpass, louder and brighter when faster */
function synthSwoosh(speed: number): void {
  const c = getCtx();
  const now = c.currentTime;
  const k = Math.min(1, speed / 14);
  const dur = 0.22;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(400 + k * 300, now);
  filter.frequency.exponentialRampToValueAtTime(1400 + k * 1600, now + dur * 0.45);
  filter.frequency.exponentialRampToValueAtTime(500, now + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.18 + k * 0.3, now + dur * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(now);
  src.stop(now + dur);

  // Pitch-bent saber whine on top
  tone(c, 'sawtooth', 140 + k * 80, 90, 0.06 + k * 0.06, dur);
}

/** Blade-on-blade: crack plus a ringing inharmonic metallic chord */
function synthClash(): void {
  const c = getCtx();
  noise(c, 'highpass', 2500, 0.7, 0.45, 0.08);
  for (const [f, a] of [[1230, 0.16], [1847, 0.12], [2961, 0.08], [620, 0.14]] as const) {
    tone(c, 'sine', f, f * 0.97, a, 0.55);
  }
  tone(c, 'square', 900, 180, 0.12, 0.18);
  tone(c, 'sine', 110, 45, 0.5, 0.2);
}

/** Saber connects with a body: sub punch + sizzle + crack. `intensity` 0..1 scales it all. */
function synthHit(intensity = 0.5, smash = false): void {
  const c = getCtx();
  const k = 0.4 + Math.min(1, Math.max(0, intensity)) * 0.6;
  tone(c, 'sine', 160, 38, 0.9 * k, 0.32);
  tone(c, 'triangle', 320, 80, 0.3 * k, 0.12);
  noise(c, 'lowpass', 1800, 0.8, 0.6 * k, 0.12);
  noise(c, 'bandpass', 4200, 1.5, 0.25 * k, 0.28);
  if (smash) {
    // Sub-bass boom and a sharp crack on top
    tone(c, 'sine', 70, 24, 1.0, 0.6);
    noise(c, 'highpass', 2500, 0.7, 0.5, 0.08);
    noise(c, 'lowpass', 400, 0.7, 0.7, 0.45);
  }
}

/** Successful parry: bright ring + deep clunk so it reads as "denied" */
function synthBlock(): void {
  const c = getCtx();
  tone(c, 'sine', 160, 70, 0.5, 0.18);
  noise(c, 'highpass', 3000, 0.7, 0.3, 0.06);
  for (const [f, a] of [[1568, 0.16], [2350, 0.1], [784, 0.12]] as const) {
    tone(c, 'triangle', f, f, a, 0.4);
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Shockwave (Guardian) — deep sub-bass boom with a rumbling noise tail */
function synthShockwave(): void {
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
function synthOvercharge(): void {
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
function synthBarrier(): void {
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
function synthBlink(): void {
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

/** Ring-out sky beam: a laser zap slamming down, thunder crack, deep boom and a shimmering tail */
function synthSkyBeam(): void {
  const c = getCtx();
  const now = c.currentTime;
  tone(c, 'sawtooth', 2600, 140, 0.18, 0.16);
  tone(c, 'square', 1800, 90, 0.08, 0.2);
  noise(c, 'highpass', 1800, 0.7, 0.7, 0.12, now + 0.08);
  tone(c, 'sine', 95, 28, 1.0, 1.1, now + 0.08);
  noise(c, 'lowpass', 260, 0.7, 0.5, 1.6, now + 0.1);
  for (const [f, a] of [[1320, 0.06], [1980, 0.04], [2640, 0.03]] as const) {
    tone(c, 'sine', f, f * 1.01, a, 1.4, now + 0.12);
  }
}

/** Splash sound for falling into water */
function synthSplash(): void {
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

/** Triumphant victory fanfare with brass harmonics and shimmer */
function synthVictoryFanfare(): void {
  const c = getCtx();
  const now = c.currentTime;

  const notes = [
    { freq: 261.63, time: 0.0, dur: 0.16 },
    { freq: 329.63, time: 0.14, dur: 0.16 },
    { freq: 392.00, time: 0.28, dur: 0.22 },
    { freq: 523.25, time: 0.46, dur: 0.55 },
    { freq: 659.25, time: 0.72, dur: 0.65 },
    { freq: 783.99, time: 0.95, dur: 1.4 },
  ];

  for (const n of notes) {
    const t = now + n.time;
    const osc1 = c.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(n.freq, t);

    const osc2 = c.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(n.freq * 2, t);

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + 0.08);
    filter.frequency.exponentialRampToValueAtTime(800, t + n.dur);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.24, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + n.dur);
    osc2.stop(t + n.dur);
  }
}

/** Melancholy dejected defeat synth sound */
function synthDefeatSound(): void {
  const c = getCtx();
  const now = c.currentTime;

  const notes = [
    { freq: 392.00, time: 0.0, dur: 0.5 },
    { freq: 311.13, time: 0.35, dur: 0.5 },
    { freq: 293.66, time: 0.70, dur: 0.5 },
    { freq: 261.63, time: 1.05, dur: 0.9 },
    { freq: 196.00, time: 1.40, dur: 1.5 },
  ];

  for (const n of notes) {
    const t = now + n.time;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    osc.frequency.linearRampToValueAtTime(n.freq * 0.96, t + n.dur);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(t);
    osc.stop(t + n.dur);
  }
}

/** Bright, energetic ascending fanfare chime when winning a round */
export function playRoundWinSound(): void {
  const c = getCtx();
  const now = c.currentTime;

  // Energetic 4-note ascending major arpeggio with celebratory bell shimmer
  const notes = [
    { freq: 440.0, time: 0.0, dur: 0.13 },    // A4
    { freq: 554.37, time: 0.10, dur: 0.13 },  // C#5
    { freq: 659.25, time: 0.20, dur: 0.16 },  // E5
    { freq: 880.0, time: 0.32, dur: 0.55 },   // A5
  ];

  for (const n of notes) {
    const t = now + n.time;
    const osc1 = c.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(n.freq, t);

    // Warm second harmonic for brassy arcade punch
    const osc2 = c.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(n.freq * 1.003, t);

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + n.dur);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.24, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + n.dur);
    osc2.stop(t + n.dur);
  }
}

/** Gentle, muted downward chime indicating round lost without being harsh */
export function playRoundLoseSound(): void {
  const c = getCtx();
  const now = c.currentTime;

  const notes = [
    { freq: 392.00, time: 0.0, dur: 0.28 },   // G4
    { freq: 329.63, time: 0.22, dur: 0.45 },  // E4
  ];

  for (const n of notes) {
    const t = now + n.time;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    osc.frequency.linearRampToValueAtTime(n.freq * 0.97, t + n.dur);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.14, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(t);
    osc.stop(t + n.dur);
  }
}

/** Crisp percussive point counter tick chime */
export function playScoreTickSound(): void {
  const c = getCtx();
  const now = c.currentTime;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(987.77, now); // B5
  osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12); // E6

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(now);
  osc.stop(now + 0.18);
}

