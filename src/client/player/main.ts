/**
 * Player client entry point. Each player opens this on their laptop.
 * Connects to server, shows QR for phone controller, renders first-person view.
 */

import QRCode from 'qrcode';
import type { PlayerSlot, ServerToPlayerMsg, GameState } from '@shared/protocol.js';
import { FEATURES } from '@shared/constants.js';
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
const classInfo = document.getElementById('class-info')!;
const opponentStatus = document.getElementById('opponent-status')!;
const hudP1Score = document.getElementById('hud-p1-score')!;
const hudP2Score = document.getElementById('hud-p2-score')!;
const hudRound = document.getElementById('hud-round')!;
const debugBar = document.getElementById('debug-bar')!;

// ─── State ──────────────────────────────────────────────────────────

let mySlot: PlayerSlot | null = null;
let renderer: GameRenderer | null = null;
const isDebug = location.search.includes('debug');
const isTest = location.search.includes('test');

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

function showOverlay(title: string, subtitle: string, showBtn = false): void {
  overlay.style.display = 'flex';
  overlayTitle.textContent = title;
  overlaySub.textContent = subtitle;
  overlayBtn.style.display = showBtn ? 'inline-block' : 'none';
}

function hideOverlay(): void {
  overlay.style.display = 'none';
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
  lobbyUrl.textContent = controllerUrl;
}

// ─── Game state handling ────────────────────────────────────────────

function handleGameState(state: GameState): void {
  hideOverlay();
  switch (state) {
    case 'lobby':
      showScreen('lobby');
      break;
    case 'classSelect':
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
        controllerStatus.textContent = msg.connected
          ? 'Controller connected!'
          : 'Controller disconnected. Reconnecting...';
      }
      break;

    case 'gameState':
      handleGameState(msg.state);
      // In debug mode (keyboard), auto-ready since there's no phone to pick class
      if (isDebug && msg.state === 'classSelect') {
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
          showOverlay(String(msg.countdown), '');
        } else if (msg.state === 'fighting') {
          hideOverlay();
        }
      }
      break;

    case 'roundResult': {
      const isWinner = msg.winner === mySlot;
      showOverlay(
        isWinner ? 'You win the round!' : 'You lose the round!',
        `Score: ${msg.scores[0]} - ${msg.scores[1]}`,
      );
      break;
    }

    case 'matchResult': {
      const isWinner = msg.winner === mySlot;
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

overlayBtn.addEventListener('click', () => {
  send({ type: 'rematch' });
  hideOverlay();
  // In debug mode (keyboard), re-ready after rematch
  if (isDebug) {
    setTimeout(() => send({ type: 'ready' }), 200);
  }
});

connectPlayer(handleMessage);
