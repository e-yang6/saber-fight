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
import { playRoundWinSound, playRoundLoseSound, playScoreTickSound } from './game/Audio.js';

// ─── DOM refs ───────────────────────────────────────────────────────

const lobbyScreen = document.getElementById('lobby')!;
const classSelectScreen = document.getElementById('class-select-screen')!;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const overlay = document.getElementById('overlay')!;
const overlayContent = document.getElementById('overlay-content')!;
const overlayBadge = document.getElementById('overlay-badge')!;
const overlayTitle = document.getElementById('overlay-title')!;
const overlaySub = document.getElementById('overlay-subtitle')!;
const overlayScore = document.getElementById('overlay-score')!;
const overlayBtn = document.getElementById('overlay-btn') as HTMLButtonElement;

// Round result DOM refs
const roundCard = document.getElementById('round-card')!;
const roundParticles = document.getElementById('round-particles')!;
const roundKicker = document.getElementById('round-kicker')!;
const roundTitle = document.getElementById('round-title')!;
const roundSubtitle = document.getElementById('round-subtitle')!;
const roundBoxP1 = document.getElementById('round-box-p1')!;
const roundBoxP2 = document.getElementById('round-box-p2')!;
const pointPopupP1 = document.getElementById('point-popup-p1')!;
const pointPopupP2 = document.getElementById('point-popup-p2')!;
const roundP1Label = document.getElementById('round-p1-label')!;
const roundP2Label = document.getElementById('round-p2-label')!;
const roundP1Num = document.getElementById('round-p1-num')!;
const roundP2Num = document.getElementById('round-p2-num')!;
const roundP1Pips = document.getElementById('round-p1-pips')!;
const roundP2Pips = document.getElementById('round-p2-pips')!;
const roundStatusBanner = document.getElementById('round-status-banner')!;

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
let currentRound = 1;
let previousScores: [number, number] = [0, 0];
let latestScores: [number, number] = [0, 0];
let roundAnimTimers: ReturnType<typeof setTimeout>[] = [];

/** Delay after the fall: allows the sky beam to strike before the celebratory card pops in */
const RESULT_DELAY_MS = 600;
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
  overlay.classList.remove('victory-mode', 'defeat-mode', 'round-mode', 'round-win-mode', 'round-lose-mode');
  overlayBadge.style.display = 'none';
  overlayScore.style.display = 'none';
  overlayContent.style.display = 'block';
  roundCard.style.display = 'none';
  roundParticles.innerHTML = '';
  roundAnimTimers.forEach(t => clearTimeout(t));
  roundAnimTimers = [];

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
  overlayBtn.textContent = 'Rematch';
  overlayBtn.style.display = showBtn ? 'inline-block' : 'none';
}

function spawnRoundParticles(container: HTMLElement, count = 32): void {
  container.innerHTML = '';
  const colors = ['#ffd23a', '#f59e0b', '#ffffff', '#38bdf8', '#fbbf24', '#f1f5f9'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'round-spark';
    const size = Math.random() * 8 + 6;
    p.style.width = `${size}px`;
    p.style.height = `${size * (Math.random() > 0.4 ? 1 : 1.6)}px`;
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = '50%';
    p.style.top = '40%';

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 240 + 70;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 30; // slight upward lift
    const rot = (Math.random() - 0.5) * 720;

    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);
    p.style.setProperty('--rot', `${rot}deg`);
    p.style.animationDelay = `${Math.random() * 0.15}s`;

    container.appendChild(p);
  }
}

function showRoundResultOverlay(
  isWinner: boolean,
  winningSlot: PlayerSlot,
  oldScores: [number, number],
  newScores: [number, number],
  roundNum: number,
): void {
  roundAnimTimers.forEach(t => clearTimeout(t));
  roundAnimTimers = [];

  overlay.style.display = 'flex';
  overlayContent.style.display = 'none';
  roundCard.style.display = 'flex';
  overlay.classList.remove('countdown-mode', 'victory-mode', 'defeat-mode');
  overlay.classList.add('round-mode');

  if (isWinner) {
    overlay.classList.remove('round-lose-mode');
    overlay.classList.add('round-win-mode');
    roundKicker.textContent = `ROUND ${roundNum} VICTORY`;
    roundTitle.textContent = 'ROUND WON!';
    roundSubtitle.textContent = 'POINT SECURED!';
    playRoundWinSound();
    spawnRoundParticles(roundParticles, 36);
  } else {
    overlay.classList.remove('round-win-mode');
    overlay.classList.add('round-lose-mode');
    roundKicker.textContent = `ROUND ${roundNum} CONCEDED`;
    roundTitle.textContent = 'ROUND LOST';
    roundSubtitle.textContent = 'OPPONENT SCORED';
    playRoundLoseSound();
    roundParticles.innerHTML = '';
  }

  // Label configuration
  if (mySlot === 1) {
    roundP1Label.textContent = 'YOU';
    roundP2Label.textContent = soloActive ? 'BOT' : 'OPPONENT';
  } else if (mySlot === 2) {
    roundP1Label.textContent = soloActive ? 'BOT' : 'OPPONENT';
    roundP2Label.textContent = 'YOU';
  } else {
    roundP1Label.textContent = 'PLAYER 1';
    roundP2Label.textContent = 'PLAYER 2';
  }

  // Reset highlight states on cards & badges
  roundBoxP1.classList.remove('scored-point');
  roundBoxP2.classList.remove('scored-point');
  pointPopupP1.classList.remove('show-point');
  pointPopupP2.classList.remove('show-point');

  // Display old scores first
  roundP1Num.textContent = String(oldScores[0]);
  roundP2Num.textContent = String(oldScores[1]);
  roundP1Num.classList.remove('score-bump');
  roundP2Num.classList.remove('score-bump');

  // Display pips according to old scores
  const p1Pips = roundP1Pips.querySelectorAll<HTMLElement>('.pip-circle');
  p1Pips.forEach((pip, idx) => {
    pip.className = 'pip-circle';
    if (idx < oldScores[0]) pip.classList.add('filled');
  });

  const p2Pips = roundP2Pips.querySelectorAll<HTMLElement>('.pip-circle');
  p2Pips.forEach((pip, idx) => {
    pip.className = 'pip-circle';
    if (idx < oldScores[1]) pip.classList.add('filled');
  });

  // Action status banner
  const isMatchPoint = newScores[winningSlot - 1] >= ROUNDS_TO_WIN;
  if (isWinner) {
    roundStatusBanner.textContent = isMatchPoint
      ? 'MATCH VICTORY SECURED!'
      : `1 MORE POINT TO WIN — ROUND ${roundNum + 1} UP NEXT`;
  } else {
    roundStatusBanner.textContent = isMatchPoint
      ? 'MATCH DECIDED'
      : `RESET YOUR STANCE — ROUND ${roundNum + 1} UP NEXT`;
  }

  // Stage 2: Animate point award, pip fill, and score counter tick
  const timer = setTimeout(() => {
    const winningBox = winningSlot === 1 ? roundBoxP1 : roundBoxP2;
    const winningPopup = winningSlot === 1 ? pointPopupP1 : pointPopupP2;
    const winningNum = winningSlot === 1 ? roundP1Num : roundP2Num;
    const winningPipsContainer = winningSlot === 1 ? roundP1Pips : roundP2Pips;
    const winningHudScore = winningSlot === 1 ? hudP1Score : hudP2Score;

    // Highlight score card
    winningBox.classList.add('scored-point');

    // Pop the "+1 POINT" badge
    winningPopup.classList.add('show-point');

    // Chime score tick
    playScoreTickSound();

    // Increment digit with punchy bump
    winningNum.textContent = String(newScores[winningSlot - 1]);
    winningNum.classList.remove('score-bump');
    void winningNum.offsetWidth;
    winningNum.classList.add('score-bump');

    // Mirror on top HUD score
    winningHudScore.textContent = String(newScores[winningSlot - 1]);
    winningHudScore.classList.remove('hud-bump');
    void winningHudScore.offsetWidth;
    winningHudScore.classList.add('hud-bump');

    // Light up the newly awarded pip
    const awardedPipIndex = newScores[winningSlot - 1] - 1;
    const pipCircles = winningPipsContainer.querySelectorAll<HTMLElement>('.pip-circle');
    if (pipCircles[awardedPipIndex]) {
      pipCircles[awardedPipIndex].classList.add('filled', 'just-filled');
    }
  }, 450);

  roundAnimTimers.push(timer);
}

/** `showBtn` stays false until the server is in matchEnd; before that a rematch click is ignored */
function showMatchEndOverlay(isWinner: boolean, scores: [number, number], showBtn: boolean): void {
  overlay.style.display = 'flex';
  overlay.classList.remove('countdown-mode', 'round-mode', 'round-win-mode', 'round-lose-mode');
  overlayContent.style.display = 'block';
  roundCard.style.display = 'none';
  roundParticles.innerHTML = '';
  roundAnimTimers.forEach(t => clearTimeout(t));
  roundAnimTimers = [];

  if (isWinner) {
    overlay.classList.remove('defeat-mode');
    overlay.classList.add('victory-mode');
    overlayBadge.textContent = 'VICTORY';
    overlayBadge.style.display = 'inline-block';
    overlayTitle.textContent = 'YOU WIN!';
    overlaySub.textContent = 'MATCH CHAMPION';
    overlayBtn.textContent = 'PLAY AGAIN';
  } else {
    overlay.classList.remove('victory-mode');
    overlay.classList.add('defeat-mode');
    overlayBadge.textContent = 'DEFEAT';
    overlayBadge.style.display = 'inline-block';
    overlayTitle.textContent = 'YOU LOSE';
    overlaySub.textContent = 'BETTER LUCK NEXT TIME';
    overlayBtn.textContent = 'REMATCH';
  }

  overlayScore.textContent = `Match Score: ${scores[0]} - ${scores[1]}`;
  overlayScore.style.display = 'block';
  overlayBtn.style.display = showBtn ? 'inline-block' : 'none';
}

function hideOverlay(): void {
  overlay.style.display = 'none';
  overlay.classList.remove('countdown-mode', 'victory-mode', 'defeat-mode', 'round-mode', 'round-win-mode', 'round-lose-mode');
  overlayBadge.style.display = 'none';
  overlayScore.style.display = 'none';
  overlayBtn.textContent = 'Rematch';
  overlayContent.style.display = 'block';
  roundCard.style.display = 'none';
  roundParticles.innerHTML = '';
  roundAnimTimers.forEach(t => clearTimeout(t));
  roundAnimTimers = [];
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
  if (state === 'lobby' || state === 'classSelect') {
    previousScores = [0, 0];
    latestScores = [0, 0];
    currentRound = 1;
  }
  if (state !== 'matchEnd') {
    renderer?.clearMatchEnd();
    hideOverlay();
  }
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
        currentRound = msg.round;
        latestScores = [msg.scores[0], msg.scores[1]];
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
      // Derive previous scores before this point was scored
      const oldScores: [number, number] = [previousScores[0], previousScores[1]];
      if (oldScores[msg.winner - 1] === msg.scores[msg.winner - 1]) {
        oldScores[msg.winner - 1] = Math.max(0, msg.scores[msg.winner - 1] - 1);
      }
      latestScores = [msg.scores[0], msg.scores[1]];
      previousScores = [msg.scores[0], msg.scores[1]];

      if (resultTimer) clearTimeout(resultTimer);
      // Let the sky beam strike at the start of fall, then drop in the celebratory card
      resultTimer = setTimeout(() => {
        resultTimer = null;
        if (matchOver) {
          renderer?.setMatchEnd(isWinner, latestScores);
          showMatchEndOverlay(isWinner, latestScores, false);
        } else {
          showRoundResultOverlay(isWinner, msg.winner, oldScores, latestScores, currentRound);
        }
      }, RESULT_DELAY_MS);
      break;
    }

    case 'matchResult': {
      const isWinner = msg.winner === mySlot;
      if (resultTimer) clearTimeout(resultTimer);
      resultTimer = null;
      renderer?.setMatchEnd(isWinner, latestScores);
      showMatchEndOverlay(isWinner, latestScores, true);
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
  renderer?.clearMatchEnd();
  send({ type: 'rematch' });
  hideOverlay();
  previousScores = [0, 0];
  latestScores = [0, 0];
  currentRound = 1;
  hudP1Score.textContent = '0';
  hudP2Score.textContent = '0';
  // In debug or solo mode (keyboard), re-ready after rematch
  if (isDebug || soloActive) {
    setTimeout(() => send({ type: 'ready' }), 200);
  }
});

const powerBtn = document.getElementById('power');
if (powerBtn) {
  powerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    send({ type: 'fakeInput', msg: { type: 'button', button: 'power', state: 'down' } });
    setTimeout(() => {
      send({ type: 'fakeInput', msg: { type: 'button', button: 'power', state: 'up' } });
    }, 120);
  });
}

connectPlayer(handleMessage);
