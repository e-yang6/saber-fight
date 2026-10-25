/**
 * Player client entry point. Each player opens this on their laptop.
 * Connects to server, shows QR for phone controller, renders first-person view.
 */

import QRCode from 'qrcode';
import type { PlayerSlot, ServerToPlayerMsg, GameState } from '@shared/protocol.js';
import { FEATURES, ROUNDS_TO_WIN } from '@shared/constants.js';
import { connectPlayer, send } from './network.js';
import { GameRenderer } from './game/GameRenderer.js';
import { FakeController } from './FakeController.js';

// ─── DOM refs ───────────────────────────────────────────────────────

const lobbyScreen = document.getElementById('lobby')!;
const classSelectScreen = document.getElementById('class-select-screen')!;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const overlay = document.getElementById('overlay')!;
const overlayTitle = document.getElementById('overlay-title')!;
const overlaySub = document.getElementById('overlay-subtitle')!;
const overlayBtn = document.getElementById('overlay-btn') as HTMLButtonElement;
const lobbyStatus = document.getElementById('lobby-status')!;
const qrCanvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
const lobbyUrl = document.getElementById('lobby-url')!;
const controllerStatus = document.getElementById('controller-status')!;
const btnSoloLobby = document.getElementById('btn-solo-lobby') as HTMLButtonElement | null;
const classInfo = document.getElementById('class-info')!;
const opponentStatus = document.getElementById('opponent-status')!;
const hudP1Score = document.getElementById('hud-p1-score')!;
const hudP2Score = document.getElementById('hud-p2-score')!;
const hudRound = document.getElementById('hud-round')!;
const debugBar = document.getElementById('debug-bar')!;

// ─── State ──────────────────────────────────────────────────────────

let mySlot: PlayerSlot | null = null;
let renderer: GameRenderer | null = null;
let soloActive = false;
let myControllerConnected = false;
let currentState: GameState = 'lobby';
let fakeController: FakeController | null = null;
let resultTimer: ReturnType<typeof setTimeout> | null = null;
/** Matches the sky beam's strike + hold + fade in VFX.spawnSkyBeam */
const RESULT_DELAY_MS = 1400;
const isDebug = location.search.includes('debug');
const isTest = location.search.includes('test');

function activateSoloMode() {
  if (soloActive) return;
  soloActive = true;
  debugBar.style.display = 'block';
  fakeController = new FakeController();
  fakeController.start();
  controllerStatus.textContent = 'Solo mode active: mouse=sword, space=block, E=power';
  send({ type: 'startSolo' });
}

// ─── Screen management ──────────────────────────────────────────────

function showScreen(name: 'lobby' | 'classSelect' | 'game') {
  lobbyScreen.classList.remove('active');
  classSelectScreen.classList.remove('active');

  switch (name) {
    case 'lobby':
      lobbyScreen.classList.add('active');
      hud.style.display = 'none';
      break;
    case 'classSelect':
      classSelectScreen.classList.add('active');
      hud.style.display = 'none';
      break;
    case 'game':
      hud.style.display = 'flex';
      break;
  }
}

function showOverlay(title: string, subtitle: string, showBtn = false, isCountdown = false): void {
  overlay.style.display = 'flex';
  if (isCountdown) {
    overlay.classList.add('countdown-mode');
  } else {
    overlay.classList.remove('countdown-mode');
  }
  if (overlayTitle.textContent !== title) {
    overlayTitle.textContent = title;
    if (isCountdown) {
      overlayTitle.style.animation = 'none';
      void overlayTitle.offsetWidth;
      overlayTitle.style.animation = '';
    }
  }
  overlaySub.textContent = subtitle;
  overlayBtn.style.display = showBtn ? 'inline-block' : 'none';
}

function hideOverlay(): void {
  overlay.style.display = 'none';
  overlay.classList.remove('countdown-mode');
}

// ─── QR code generation ─────────────────────────────────────────────

let serverLanOrigin: string | null = null;

function generateQR(token: string): void {
  // If accessed via tunnel (not localhost/LAN IP), use the tunnel origin for the QR
  const isLocalAccess = location.hostname === 'localhost'
    || location.hostname === '127.0.0.1'
    || location.hostname.match(/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./);
  const origin = isLocalAccess ? (serverLanOrigin || window.location.origin) : window.location.origin;
  const controllerUrl = `${origin}/controller/?token=${token}`;
  QRCode.toCanvas(qrCanvas, controllerUrl, {
    width: 240,
    margin: 2,
    color: { dark: '#ffffff', light: '#000000' },
  });
  lobbyUrl.innerHTML = `<a href="${controllerUrl}" target="_blank" rel="noopener noreferrer" style="color: #64b5f6; text-decoration: underline;">${controllerUrl}</a>`;
}

// ─── Game state handling ────────────────────────────────────────────

function handleGameState(state: GameState): void {
  currentState = state;
  hideOverlay();
  if (resultTimer && state !== 'roundEnd' && state !== 'matchEnd') {
    clearTimeout(resultTimer);
    resultTimer = null;
  }
  renderer?.setMenuMode(state === 'lobby' || state === 'classSelect');
  switch (state) {
    case 'lobby':
      showScreen('lobby');
      break;
    case 'classSelect':
      // Class is picked on the phone, so keep the QR up until this player's phone is linked
      if (!myControllerConnected && !isDebug && !soloActive) {
        showScreen('lobby');
        controllerStatus.textContent = 'Scan the QR code with your phone to pick your class';
        break;
      }
      showScreen('classSelect');
      classInfo.textContent = 'Select your class on your phone controller';
      break;
    case 'countdown':
    case 'fighting':
      showScreen('game');
      break;
    case 'roundEnd':
      showScreen('game');
      break;
    case 'matchEnd':
      showScreen('game');
      break;
  }
}

// ─── Message handling ───────────────────────────────────────────────

function handleMessage(msg: ServerToPlayerMsg): void {
  switch (msg.type) {
    case 'playerAssigned': {
      mySlot = msg.slot;
      if (msg.lanOrigin) serverLanOrigin = msg.lanOrigin;
      lobbyStatus.textContent = `You are Player ${msg.slot}`;
      generateQR(msg.token);
      controllerStatus.textContent = 'Scan the QR code with your phone';

      // Create renderer now that we know our slot
      renderer = new GameRenderer(gameCanvas, mySlot);
      renderer.setMenuMode(currentState === 'lobby' || currentState === 'classSelect');
      renderer.start();

      // Start head tracking if enabled
      if (FEATURES.HEAD_TRACKING) {
        import('./HeadTracker.js').then(({ HeadTracker }) => {
          const tracker = new HeadTracker(renderer!);
          tracker.start().catch(() => {
            console.log('[head-tracking] Not available, continuing without it');
          });
        }).catch(() => {});
      }

      // Test mode: bot opponent, connect phone controller via QR
      if (isTest) {
        send({ type: 'startSolo' });
        controllerStatus.textContent = 'Test mode: scan QR with your phone to fight the bot';
      }

      // Debug mode: keyboard/mouse instead of phone
      if (isDebug) {
        debugBar.style.display = 'block';
        const fake = new FakeController();
        fake.start();
        controllerStatus.textContent = 'Debug mode: mouse=sword, space=block, E=power';
      }
      break;
    }

    case 'waitingForOpponent':
      opponentStatus.textContent = 'Waiting for another player to join...';
      break;

    case 'controllerConnected':
      if (msg.slot === mySlot) {
        myControllerConnected = msg.connected;
        controllerStatus.textContent = msg.connected
          ? 'Controller connected!'
          : 'Controller disconnected. Reconnecting...';
        if (msg.connected && currentState === 'classSelect') handleGameState('classSelect');
      }
      break;

    case 'gameState':
      handleGameState(msg.state);
      // In debug or solo mode (keyboard), auto-ready since there's no phone to pick class
      if ((isDebug || soloActive) && msg.state === 'classSelect') {
        send({ type: 'ready' });
      }
      break;

    case 'snapshot':
      if (renderer) {
        renderer.applySnapshot(msg);

        // Update HUD
        hudP1Score.textContent = String(msg.scores[0]);
        hudP2Score.textContent = String(msg.scores[1]);
        hudRound.textContent = msg.state === 'fighting' || msg.state === 'roundEnd'
          ? `Round ${msg.round}` : '';

        // Show countdown
        if (msg.state === 'countdown' && msg.countdown !== undefined) {
          showOverlay(String(msg.countdown), '', false, true);
        } else if (msg.state === 'fighting') {
          hideOverlay();
        }
      }
      break;

    case 'roundResult': {
      const isWinner = msg.winner === mySlot;
      const matchOver = msg.scores[msg.winner - 1] >= ROUNDS_TO_WIN;
      const score = `Score: ${msg.scores[0]} - ${msg.scores[1]}`;
      if (resultTimer) clearTimeout(resultTimer);
      // Let the sky beam play out before the result covers the screen
      resultTimer = setTimeout(() => {
        resultTimer = null;
        if (matchOver) {
          showOverlay(isWinner ? 'You win the match!' : 'You lose the match!', score);
        } else {
          showOverlay(isWinner ? 'You win the round!' : 'You lose the round!', score);
        }
      }, RESULT_DELAY_MS);
      break;
    }

    case 'matchResult': {
      const isWinner = msg.winner === mySlot;
      if (resultTimer) clearTimeout(resultTimer);
      resultTimer = null;
      showOverlay(
        isWinner ? 'You win the match!' : 'You lose the match!',
        '',
        true,
      );
      break;
    }
  }
}

// ─── Init ───────────────────────────────────────────────────────────

if (btnSoloLobby) {
  btnSoloLobby.addEventListener('click', () => {
    activateSoloMode();
  });
}

overlayBtn.addEventListener('click', () => {
  send({ type: 'rematch' });
  hideOverlay();
  // In debug or solo mode (keyboard), re-ready after rematch
  if (isDebug || soloActive) {
    setTimeout(() => send({ type: 'ready' }), 200);
  }
});

connectPlayer(handleMessage);
