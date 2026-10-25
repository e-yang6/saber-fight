import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import type { Duplex } from 'stream';
import { GameSession } from './session.js';
import { GameServer } from './GameServer.js';
import type {
  PlayerSlot, ControllerMsg, PlayerToServerMsg,
  SnapshotMsg, HapticEffect, GameState,
} from '../shared/protocol.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

function getLanIP(): string {
  const nets = networkInterfaces();
  // Prefer Wi-Fi / Ethernet, skip virtual adapters (VirtualBox, Bluetooth, etc.)
  const skip = /virtual|vbox|vmware|bluetooth|loopback/i;
  const prefer = /wi-fi|wifi|wlan|ethernet/i;
  let fallback = '';
  for (const name of Object.keys(nets)) {
    if (skip.test(name)) continue;
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.') && !net.address.startsWith('192.168.56.')) {
        if (prefer.test(name)) return net.address;
        if (!fallback) fallback = net.address;
      }
    }
  }
  return fallback || 'localhost';
}

async function main() {
  const app = express();
  const session = new GameSession();


  // Bypass ngrok's browser interstitial warning
  app.use((_req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', '1');
    next();
  });

  // Always run HTTP on PORT (for laptop + cloudflare tunnel)
  const server = createHttpServer(app);

  // Additionally run HTTPS on HTTPS_PORT for direct LAN phone access
  const certPath = resolve(ROOT, 'cert.pem');
  const keyPath = resolve(ROOT, 'key.pem');
  const hasSSL = existsSync(certPath) && existsSync(keyPath);
  const httpsServer = hasSSL
    ? createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, app)
    : null;

  // ─── Game engine ────────────────────────────────────────────────────
  const game = new GameServer({
    sendSnapshot(slot: PlayerSlot, msg: SnapshotMsg) {
      session.sendToPlayer(slot, msg);
    },
    sendHaptic(slot: PlayerSlot, effect: HapticEffect) {
      session.sendToController(slot, { type: 'haptic', effect });
    },
    sendCooldown(slot: PlayerSlot, remaining: number, total: number) {
      session.sendToController(slot, { type: 'cooldown', remaining, total });
    },
    broadcastGameState(state: GameState) {
      session.broadcastToPlayers({ type: 'gameState', state });
      session.broadcastToControllers({ type: 'gameState', state });
    },
    broadcastRoundResult(winner: PlayerSlot, scores: [number, number]) {
      session.broadcastToPlayers({ type: 'roundResult', winner, scores });
      session.broadcastToControllers({ type: 'roundResult', winner, scores });
    },
    broadcastMatchResult(winner: PlayerSlot) {
      session.broadcastToPlayers({ type: 'matchResult', winner });
      session.broadcastToControllers({ type: 'matchResult', winner });
    },
  });
  game.start();

  // ─── Vite dev middleware / static serving ────────────────────────
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(resolve(ROOT, 'dist/client')));
    app.get('/', (_req, res) => res.redirect('/player/'));
    app.get('/player', (_req, res) => res.redirect('/player/'));
    app.get('/controller', (_req, res) => res.redirect('/controller/'));
    app.get('/player/*', (_req, res) => res.sendFile(resolve(ROOT, 'dist/client/player/index.html')));
    app.get('/controller/*', (_req, res) => res.sendFile(resolve(ROOT, 'dist/client/controller/index.html')));
  } else {
    const vite = await createViteServer({
      root: resolve(ROOT, 'src/client'),
      server: { middlewareMode: true, hmr: false, allowedHosts: true },
      resolve: {
        alias: { '@shared': resolve(ROOT, 'src/shared') },
      },
      appType: 'mpa',
    });
    app.get('/', (_req, res) => res.redirect('/player/'));
    app.get('/player', (_req, res) => res.redirect('/player/'));
    app.get('/controller', (_req, res) => res.redirect('/controller/'));
    app.use(vite.middlewares);
  }

  // ─── WebSocket server ─────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(request: any, socket: Duplex, head: Buffer) {
    const host = request.headers.host || 'localhost';
    const pathname = new URL(request.url || '/', `http://${host}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  }

  server.on('upgrade', handleUpgrade);
  if (httpsServer) httpsServer.on('upgrade', handleUpgrade);

  wss.on('connection', (ws, req) => {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const role = url.searchParams.get('role');

    if (role === 'player') {
      // ─── Player laptop connection ──────────────────────────────────
      const result = session.playerJoin(ws);
      if (!result) {
        ws.send(JSON.stringify({ type: 'gameFull' }));
        ws.close();
        return;
      }

      const lanIP = getLanIP();
      const lanOrigin = hasSSL
        ? `https://${lanIP}:${HTTPS_PORT}`
        : `http://${lanIP}:${PORT}`;

      ws.send(JSON.stringify({
        type: 'playerAssigned',
        slot: result.slot,
        token: result.token,
        lanOrigin,
      }));

      // If both players now connected, start class select
      if (session.bothPlayersConnected() && game.getState() === 'lobby') {
        game.startClassSelect();
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as PlayerToServerMsg;
          const slot = session.getPlayerSlot(ws);
          if (!slot) return;

          switch (msg.type) {
            case 'ready':
              game.handleReady(slot);
              break;
            case 'rematch':
              game.handleRematch();
              break;
            case 'headDodge':
              game.moveFighter(slot, msg.dx, msg.dz);
              break;
            case 'startSolo':
              if (game.getState() === 'lobby') {
                game.startSolo();
              }
              break;
            case 'fakeInput':
              // Debug: laptop sends input as if it were the phone controller
              if (msg.msg.type === 'orientation') {
                game.handleOrientation(slot, msg.msg);
              } else if (msg.msg.type === 'button') {
                game.handleButton(slot, msg.msg);
              }
              break;
          }
        } catch { /* ignore */ }
      });

      ws.on('close', () => session.playerDisconnect(ws));

    } else if (role === 'controller') {
      // ─── Phone controller connection ───────────────────────────────
      let joined = false;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ControllerMsg;

          if (!joined && msg.type === 'controllerJoin') {
            const result = session.controllerJoin(ws, msg.token, msg.playerId);
            if ('error' in result) {
              if (result.error === 'Invalid token') {
                ws.send(JSON.stringify({ type: 'invalidToken' }));
              } else {
                ws.send(JSON.stringify({ type: 'gameFull' }));
              }
              ws.close();
            } else {
              ws.send(JSON.stringify({ type: 'controllerAssigned', slot: result.slot }));
              joined = true;

              // If both controllers now connected and in classSelect, notify
              if (session.bothControllersConnected() && game.getState() === 'classSelect') {
                // Controllers are ready to interact
              }
            }
            return;
          }

          if (!joined) return;
          const slot = session.getControllerSlot(ws);
          if (!slot) return;

          switch (msg.type) {
            case 'orientation':
              game.handleOrientation(slot, msg);
              break;
            case 'button':
              game.handleButton(slot, msg);
              break;
            case 'classSelect':
              game.handleClassSelect(slot, msg.className, msg.saberColor);
              break;
            case 'ready':
              game.handleReady(slot);
              break;
            case 'calibrate':
              // Calibration is applied on the controller side
              break;
          }
        } catch { /* ignore */ }
      });

      ws.on('close', () => session.controllerDisconnect(ws));
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Saber Fight! server running at http://localhost:${PORT}`);
    console.log(`  Player:     http://localhost:${PORT}/player/`);
    console.log(`  Test mode:  http://localhost:${PORT}/player/?test`);
    console.log(`\nFor phone access, run: npm run tunnel`);
  });

  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const lanIP = getLanIP();
      console.log(`\n  HTTPS also running on port ${HTTPS_PORT} (LAN phone access)`);
      console.log(`  Phone: https://${lanIP}:${HTTPS_PORT}/controller/?token=<from-QR>`);
      console.log(`  (Accept the self-signed cert warning on your phone)`);
    });
  }
}

main().catch(console.error);
