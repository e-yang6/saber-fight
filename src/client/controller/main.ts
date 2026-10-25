/**
 * Phone controller. Reads token from QR URL to link to the correct player slot.
 * Streams gyro orientation to the server, receives haptics back.
 */

import type { PlayerSlot, ClassName, SaberColor, ServerToControllerMsg } from '@shared/protocol.js';
import { CLASS_CONFIGS, SABER_COLORS, classTraits } from '@shared/classes.js';
import { classIconSvg } from '@shared/classIcons.js';
import { ORIENTATION_SEND_RATE } from '@shared/constants.js';
import { connect, send } from './network.js';
import { initOrientation, orientationToQuaternion, computeYawOffset, applyYawOffset } from './orientation.js';
import { initHaptics, haptic, testAllHaptics } from './haptics.js';

// ─── State ──────────────────────────────────────────────────────────

let mySlot: PlayerSlot | null = null;
let selectedClass: ClassName = 'guardian';
let selectedColor: SaberColor = 'blue';
let yawOffset: [number, number, number, number] = [0, 0, 0, 1];
let orientationGranted = false;
let currentAlpha = 0, currentBeta = 0, currentGamma = 0;
let currentRotRate: [number, number, number] = [0, 0, 0];

// Read token from URL query param (from QR code)
const urlParams = new URLSearchParams(location.search);
const token = urlParams.get('token') || '';

// ─── DOM refs ───────────────────────────────────────────────────────

const screens = {
  connect: document.getElementById('screen-connect')!,
  full: document.getElementById('screen-full')!,
  noToken: document.getElementById('screen-no-token')!,
  classSelect: document.getElementById('screen-class-select')!,
  game: document.getElementById('screen-game')!,
};

const btnConnect = document.getElementById('btn-connect') as HTMLButtonElement;
const connectStatus = document.getElementById('connect-status')!;
const classList = document.getElementById('class-list')!;
const colorList = document.getElementById('color-list')!;
const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
const btnReady = document.getElementById('btn-ready') as HTMLButtonElement;
const readyStatus = document.getElementById('ready-status')!;
const btnBlock = document.getElementById('btn-block') as HTMLButtonElement;
const btnPower = document.getElementById('btn-power') as HTMLButtonElement;
const cooldownText = document.getElementById('cooldown-text')!;
const powerIcon = document.getElementById('power-icon')!;
const btnRecalibrate = document.getElementById('btn-recalibrate') as HTMLButtonElement;
const playerLabel = document.getElementById('player-label')!;
const btnTestHaptics = document.getElementById('btn-test-haptics') as HTMLButtonElement;

// ─── Screen management ──────────────────────────────────────────────

function showScreen(name: keyof typeof screens) {
  for (const s of Object.values(screens)) s.classList.remove('active');
  screens[name].classList.add('active');
}

// ─── Player ID (localStorage for reconnect) ─────────────────────────

function getPlayerId(): string {
  try {
    let id = localStorage.getItem('saber-fight-player-id');
    if (!id) {
      id = (typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('saber-fight-player-id', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// ─── Wake Lock ──────────────────────────────────────────────────────

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch { /* not critical */ }
}

// ─── iOS motion permission ──────────────────────────────────────────

async function requestMotionPermission(): Promise<boolean> {
  const DOE = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null) as unknown as {
    requestPermission?: () => Promise<string>;
  };
  const DME = (typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : null) as unknown as {
    requestPermission?: () => Promise<string>;
  };

  try {
    if (DOE?.requestPermission) {
      const result = await DOE.requestPermission();
      if (result !== 'granted') return false;
    }
    if (DME?.requestPermission) {
      const result = await DME.requestPermission();
      if (result !== 'granted') return false;
    }
    return true;
  } catch {
    // If not supported or errored on non-mobile devices, allow proceeding
    return true;
  }
}

// ─── Orientation streaming ──────────────────────────────────────────

function startOrientationStream() {
  window.addEventListener('deviceorientation', (e) => {
    currentAlpha = e.alpha ?? 0;
    currentBeta = e.beta ?? 0;
    currentGamma = e.gamma ?? 0;
  });

  window.addEventListener('devicemotion', (e) => {
    const r = e.rotationRate;
    if (r) {
      currentRotRate = [r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0];
    }
  });

  const interval = 1000 / ORIENTATION_SEND_RATE;
  setInterval(() => {
    if (!orientationGranted) return;
    const rawQ = orientationToQuaternion(currentAlpha, currentBeta, currentGamma);
    const q = applyYawOffset(rawQ, yawOffset);
    send({
      type: 'orientation',
      q,
      rotRate: currentRotRate,
      t: performance.now(),
    });
  }, interval);
}

function calibrate() {
  yawOffset = computeYawOffset(currentAlpha);
  send({ type: 'calibrate', yawOffset });
}

// ─── Class SVG Icons ────────────────────────────────────────────────

const CLASS_ICONS = Object.fromEntries(
  (Object.keys(CLASS_CONFIGS) as ClassName[]).map((n) => [n, classIconSvg(n, 'class-svg-icon')]),
) as Record<ClassName, string>;

/** The power button shows the icon of the class you picked */
function updatePowerIcon() {
  powerIcon.innerHTML = classIconSvg(selectedClass, 'battle-icon bolt-icon');
}
updatePowerIcon();

// ─── Class/color selection UI ───────────────────────────────────────

function buildClassSelect() {
  classList.innerHTML = '';
  for (const cfg of Object.values(CLASS_CONFIGS)) {
    const btn = document.createElement('button');
    btn.className = 'class-card-btn';
    btn.dataset.cls = cfg.name;
    btn.setAttribute('aria-label', cfg.displayName);
    btn.setAttribute('title', `${cfg.displayName}: ${cfg.ability.name}`);
    if (cfg.name === selectedClass) btn.classList.add('selected');
    btn.innerHTML = `<div class="class-icon-wrap">${CLASS_ICONS[cfg.name]}</div>
      <span class="class-info-btn" role="button" tabindex="0" aria-label="${cfg.displayName} ability info">i</span>`;
    btn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.class-info-btn')) {
        openClassInfo(cfg.name);
        return;
      }
      pickClass(cfg.name);
    });
    classList.appendChild(btn);
  }

  colorList.innerHTML = '';
  for (const [name, hex] of Object.entries(SABER_COLORS)) {
    const btn = document.createElement('button');
    btn.className = 'color-orb-btn';
    btn.dataset.color = name;
    btn.style.setProperty('--orb-color', hex);
    btn.setAttribute('aria-label', `${name} saber`);
    btn.setAttribute('title', name);
    if (name === selectedColor) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      selectedColor = name as SaberColor;
      updateSelectionUI();
      send({ type: 'classSelect', className: selectedClass, saberColor: selectedColor });
    });
    colorList.appendChild(btn);
  }
}

function pickClass(name: ClassName) {
  selectedClass = name;
  selectedColor = CLASS_CONFIGS[name].defaultColor;
  updateSelectionUI();
  send({ type: 'classSelect', className: selectedClass, saberColor: selectedColor });
}

// ─── Class info popup ───────────────────────────────────────────────

const classInfo = document.getElementById('class-info')!;
let infoClass: ClassName = 'guardian';

function openClassInfo(name: ClassName) {
  const cfg = CLASS_CONFIGS[name];
  infoClass = name;
  haptic('hit_landed');
  document.getElementById('class-info-icon')!.innerHTML = CLASS_ICONS[name];
  document.getElementById('class-info-name')!.textContent = cfg.displayName;
  document.getElementById('class-info-ability')!.textContent = cfg.ability.name;
  document.getElementById('class-info-desc')!.textContent = `${cfg.ability.description}.`;
  document.getElementById('class-info-cooldown')!.textContent =
    `${cfg.ability.cooldown}s cooldown${cfg.ability.duration ? ` · lasts ${cfg.ability.duration}s` : ''}`;
  const traits = document.getElementById('class-info-traits')!;
  traits.innerHTML = '';
  for (const t of classTraits(cfg)) {
    const li = document.createElement('li');
    li.className = t.good ? 'trait good' : 'trait bad';
    li.textContent = t.text;
    traits.appendChild(li);
  }
  classInfo.classList.add('open');
}

function closeClassInfo() {
  classInfo.classList.remove('open');
}

classInfo.addEventListener('click', (e) => {
  if (e.target === classInfo) closeClassInfo();
});
document.getElementById('class-info-close')!.addEventListener('click', closeClassInfo);
document.getElementById('class-info-pick')!.addEventListener('click', () => {
  pickClass(infoClass);
  closeClassInfo();
});

function updateSelectionUI() {
  classList.querySelectorAll('button').forEach(b => {
    b.classList.toggle('selected', b.dataset.cls === selectedClass);
  });
  colorList.querySelectorAll('button').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === selectedColor);
  });
}

// ─── Game controls ──────────────────────────────────────────────────

function setupGameControls() {
  btnBlock.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btnBlock.classList.add('held');
    haptic('block');
    send({ type: 'button', button: 'block', state: 'down' });
  });
  const blockUp = () => {
    btnBlock.classList.remove('held');
    send({ type: 'button', button: 'block', state: 'up' });
  };
  btnBlock.addEventListener('pointerup', blockUp);
  btnBlock.addEventListener('pointercancel', blockUp);
  btnBlock.addEventListener('pointerleave', blockUp);

  btnPower.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    haptic('powerup');
    send({ type: 'button', button: 'power', state: 'down' });
  });
  btnPower.addEventListener('pointerup', () => {
    send({ type: 'button', button: 'power', state: 'up' });
  });

  btnRecalibrate.addEventListener('click', () => {
    calibrate();
    haptic('hit_landed');
  });
}

// ─── Message handling ───────────────────────────────────────────────

function handleMessage(msg: ServerToControllerMsg) {
  switch (msg.type) {
    case 'controllerAssigned':
      mySlot = msg.slot;
      playerLabel.textContent = `P${msg.slot}`;
      showScreen('classSelect');
      buildClassSelect();
      send({ type: 'classSelect', className: selectedClass, saberColor: selectedColor });
      break;

    case 'gameFull':
      showScreen('full');
      break;

    case 'invalidToken':
      connectStatus.textContent = 'Invalid link. Scan the QR code again.';
      break;

    case 'haptic':
      haptic(msg.effect);
      break;

    case 'gameState':
      if (msg.state === 'fighting') {
        updatePowerIcon();
        showScreen('game');
      } else if (msg.state === 'classSelect' || msg.state === 'lobby') {
        showScreen('classSelect');
        btnReady.disabled = false;
        readyStatus.textContent = '';
      }
      break;

    case 'cooldown':
      if (msg.remaining > 0) {
        cooldownText.textContent = `${Math.ceil(msg.remaining)}s`;
        btnPower.classList.add('on-cooldown');
      } else {
        cooldownText.textContent = '';
        btnPower.classList.remove('on-cooldown');
      }
      break;

    case 'roundResult':
      readyStatus.textContent = `P1 ${msg.scores[0]} - P2 ${msg.scores[1]}`;
      break;

    case 'matchResult':
      readyStatus.textContent = `P${msg.winner} WINS!`;
      break;
  }
}

// ─── Init ───────────────────────────────────────────────────────────

function init() {
  if (!token) {
    showScreen('noToken');
    return;
  }

  // Bind the connect button FIRST so it always works even if other init fails
  btnConnect.addEventListener('click', async () => {
    btnConnect.disabled = true;
    connectStatus.textContent = 'Requesting permissions...';

    try {
      const granted = await requestMotionPermission();
      if (!granted) {
        connectStatus.textContent = 'Motion permission denied. Reload and try again.';
        btnConnect.disabled = false;
        return;
      }
      orientationGranted = true;
      startOrientationStream();
      await requestWakeLock();
    } catch (e) {
      console.error('[controller] permission error:', e);
      connectStatus.textContent = 'Permission error. Continuing anyway...';
      orientationGranted = true;
      startOrientationStream();
    }

    connectStatus.textContent = 'Connecting...';

    connect({
      onOpen: () => {
        connectStatus.textContent = 'Connected! Joining...';
        send({ type: 'controllerJoin', playerId: getPlayerId(), token });
      },
      onClose: () => {
        connectStatus.textContent = 'Disconnected. Reconnecting...';
      },
      onMessage: handleMessage,
    });
  });

  btnCalibrate.addEventListener('click', calibrate);

  btnReady.addEventListener('click', () => {
    send({ type: 'ready' });
    readyStatus.textContent = 'Waiting for other player...';
    btnReady.disabled = true;
  });

  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // These can fail on some browsers — don't let them block the UI
  try { initHaptics(); } catch (e) { console.warn('[haptics] init failed:', e); }
  try { initOrientation(); } catch (e) { console.warn('[orientation] init failed:', e); }
  setupGameControls();

  if (location.search.includes('debug')) {
    document.getElementById('debug-panel')!.style.display = 'block';
    const log = document.getElementById('debug-log')!;
    log.textContent = `Token: ${token}`;
    btnTestHaptics.addEventListener('click', testAllHaptics);
  }
}

init();
