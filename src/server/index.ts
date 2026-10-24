import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
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

async function main() {
  const app = express();
  const server = createServer(app);
  const session = new GameSession();

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

  // ─── Vite dev middleware ──────────────────────────────────────────
  const vite = await createViteServer({
    root: resolve(ROOT, 'src/client'),
    server: { middlewareMode: true, hmr: { server } },
    resolve: {
      alias: { '@shared': resolve(ROOT, 'src/shared') },
    },
    appType: 'mpa',
  });
  app.use(vite.middlewares);

  // ─── WebSocket server ─────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket: Duplex, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Other upgrades (Vite HMR) pass through
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const role = url.searchParams.get('role');

    if (role === 'player') {
      // ─── Player laptop connection ──────────────────────────────────
      const result = session.playerJoin(ws);
      if (!result) {
        ws.send(JSON.stringify({ type: 'gameFull' }));
        ws.close();
        return;
      }

      ws.send(JSON.stringify({
        type: 'playerAssigned',
        slot: result.slot,
        token: result.token,
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

  server.listen(PORT, () => {
    console.log(`Saber Fight! server running at http://localhost:${PORT}`);
    console.log(`  Player:     http://localhost:${PORT}/player/`);
    console.log(`  Controller: http://localhost:${PORT}/controller/`);
    console.log(`\nFor phone access, run: npm run tunnel`);
  });
}

main().catch(console.error);
