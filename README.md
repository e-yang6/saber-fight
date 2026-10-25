# Nailong Battle!

A 3D lightsaber dueling game inspired by Wii Sports Resort Swordplay (Duel mode). Two players each bring their own laptop + phone — the phone is the sword controller, the laptop renders a first-person view with head-coupled parallax.

## Architecture

```
Player 1's Phone ──┐              ┌── Player 1's Laptop (first-person view)
  (gyro sword)     ├── Server ────┤
Player 2's Phone ──┘ (authoritative)└── Player 2's Laptop (first-person view)
  (gyro sword)        game state
```

- **Server**: authoritative game state + physics (60Hz tick)
- **Each laptop**: renders first-person view from their fighter's eyes, with optional webcam head-coupled parallax
- **Each phone**: sword controller via gyro, linked to their laptop by QR code token

## Quick Start

```bash
npm install
npm run dev
```

Player 1 opens `http://localhost:3000/player/` on their laptop. Player 2 opens the same URL (or the tunnel URL if remote). Each player scans the QR code on their laptop with their phone.

## Phone Controller Access (HTTPS required)

iOS Safari requires HTTPS for DeviceOrientation/DeviceMotion.

### Option A: Cloudflare Quick Tunnel (easiest)

```bash
# In a second terminal:
npm run tunnel
```

This runs `cloudflared tunnel --url http://localhost:3000` and gives you a temporary HTTPS URL. Both players open that URL on their laptops — the QR codes will point phones to the tunnel.

**Install cloudflared:** https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

### Option B: ngrok (fallback if Cloudflare is rate-limited)

```bash
# In a second terminal:
npx ngrok http 3000
```

Gives you an HTTPS URL like `https://xxxx.ngrok-free.app`. Open that on your laptop instead of localhost — QR codes will point phones to the tunnel.

**Note:** ngrok free tier shows a "Visit Site" interstitial page. On your phone, you may need to open the base tunnel URL first, tap "Visit Site", then scan the QR code.

### Option C: mkcert (LAN, no tunnel)

```bash
mkcert -install
mkcert localhost 192.168.x.x  # your LAN IP

SSL_CERT=./localhost+1.pem SSL_KEY=./localhost+1-key.pem npm run dev
```

## Expo Controller App (real haptics, no Xcode)

Safari can't do proper vibration on iPhone, so `mobile/` is an Expo app version of the phone controller with layered Taptic haptics: a metallic clang on blade clashes, a thud that scales with swing power on hits, and a long rumble on smashes. It runs inside the free **Expo Go** app; no Xcode, Mac, or Apple developer account needed.

```bash
cd mobile
npm install
npx expo start        # scan the QR it prints with your iPhone camera (opens Expo Go)
```

Then in the app, scan the QR code on your laptop. Phone and laptop must be on the same Wi-Fi as the game server (the app talks to it over plain `ws://` on port 3000, so no certificate setup). Tunnel URLs work too.

Notes:
- Haptics are silent in Low Power Mode or if System Haptics is off in Settings.
- The browser controller still works; players can mix the app and Safari.

## How to Play

1. Each player opens `/player/` on their laptop
2. Each player scans the QR code on their own laptop screen with their phone
3. Tap "Tap to Connect" on the phone to grant motion permissions
4. Pick a class and saber color on the phone, then tap "Ready"
5. Hold your phone like a saber hilt — the top edge is the blade direction
6. Swing to attack! Knock your opponent off the platform to win a round
7. Best of 3 rounds wins the match

### Controls (Phone)

- **Swing phone** — sword movement
- **BLOCK button (hold)** — guard stance; blocks attacks if blade angle is right
- **POWER button (tap)** — activate class ability
- **Calibrate** — point phone at screen and tap to reset orientation

### Classes

| Class | Ability | Cooldown | Description |
|-------|---------|----------|-------------|
| Guardian | Shockwave Push | 12s | Short-range blast that knocks opponent back |
| Striker | Overcharge | 15s | 4s of double knockback + longer blade |
| Mystic | Barrier | 18s | 3s bubble that auto-blocks everything |
| Phantom | Blink | 8s | Instant short dash in saber direction |

## Test Mode (Solo)

Add `?test` to the player URL: `http://localhost:3000/player/?test`

- Spawns a bot opponent that swings, blocks, and moves around
- Connect your phone controller via QR as normal — fight the bot with gyro
- Great for testing phone mechanics without a second player

## Debug Mode

Add `?debug` to the player URL: `http://localhost:3000/player/?debug`

- Mouse drag controls the sword (no phone needed)
- **Space** = block, **E** = power
- Fake controller input is sent through the player WebSocket

## Feature Flags

In `src/shared/constants.ts`:

```ts
export const FEATURES = {
  HEAD_TRACKING: true,    // Webcam head tracking for parallax
  PARALLAX_CAMERA: true,  // Off-axis head-coupled perspective
};
```

## File Structure

```
src/
├── server/
│   ├── index.ts           # Express + Vite + WebSocket server (single port)
│   ├── session.ts         # Game session: 2 slots, token-based phone linking
│   └── GameServer.ts      # Authoritative game engine (physics, combat, rounds)
├── shared/
│   ├── protocol.ts        # All message types (controller↔server↔player)
│   ├── math.ts            # Vec3/Quat classes (no Three.js, used server-side)
│   ├── collision.ts       # Segment/capsule collision (shared math)
│   ├── classes.ts         # Class configs (stats, abilities)
│   └── constants.ts       # Game constants + feature flags
└── client/
    ├── player/
    │   ├── index.html      # Player laptop page
    │   ├── styles.css
    │   ├── main.ts         # Entry: lobby, QR, networking, game init
    │   ├── network.ts      # WebSocket client (role=player)
    │   ├── FakeController.ts   # Debug keyboard/mouse controller
    │   ├── HeadTracker.ts      # MediaPipe face tracking → parallax
    │   └── game/
    │       ├── GameRenderer.ts # First-person Three.js renderer
    │       ├── Arena.ts        # 3D arena: platform, water, sky, lighting
    │       ├── Fighter.ts      # Render-only character (snapshot interpolation)
    │       ├── Saber.ts        # Saber with glow, bloom, motion trail
    │       ├── VFX.ts          # Particles, sparks, hit flashes, screen shake
    │       └── Audio.ts        # Procedural Web Audio (hum, clash, hit, swoosh)
    └── controller/
        ├── index.html      # Phone controller page
        ├── styles.css
        ├── main.ts         # Entry: permissions, token linking, UI, streaming
        ├── network.ts      # WebSocket client (role=controller)
        ├── orientation.ts  # DeviceOrientation → quaternion math
        └── haptics.ts      # Layered haptics (vibrate / iOS switch / flash)
```

## Tech Stack

- **Server:** Node.js + Express + `ws` WebSocket on a single port
- **Client:** Vite + Three.js (vanilla TypeScript, no framework)
- **3D:** Three.js with UnrealBloomPass for saber glow
- **Head tracking:** MediaPipe Face Landmarker (optional, feature-flagged)
- **Assets** — characters, the SF skyline, and all audio are procedural; the only external asset is the Golden Gate Bridge model below

## Credits

- [Golden Gate bridge](https://poly.pizza/m/a648BwpXx-A) by Steren Giannini, licensed [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/), via Poly Pizza (`src/client/public/models/golden-gate.glb`; its built-in water slab is hidden at load)
