import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import type { ClassName, SaberColor, ServerToControllerMsg } from '../src/shared/protocol';
import { CLASS_CONFIGS, SABER_COLORS } from '../src/shared/classes';
import { Connection, parseControllerLink } from './src/connection';
import { applyYawOffset, computeYawOffset, orientationToQuaternion, type Quat } from './src/orientation';
import { playHaptic, tap, testAllHaptics } from './src/haptics';

type Screen = 'scan' | 'connecting' | 'classSelect' | 'game' | 'full';

const SEND_HZ = 60;
const RAD2DEG = 180 / Math.PI;
const FONT = Platform.select({ ios: 'Chalkboard SE', android: 'casual', default: undefined });
const YELLOW = '#ffd23a';
const PLAYER_ID = `app-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export default function App() {
  useKeepAwake();
  const [screen, setScreen] = useState<Screen>('scan');
  const [status, setStatus] = useState('');
  const [slot, setSlot] = useState<1 | 2 | null>(null);
  const [cls, setCls] = useState<ClassName>('guardian');
  const [color, setColor] = useState<SaberColor>('blue');
  const [ready, setReady] = useState(false);
  const [readyNote, setReadyNote] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [blocking, setBlocking] = useState(false);

  const conn = useRef<Connection | null>(null);
  const motion = useRef({ alpha: 0, beta: 0, gamma: 0, rate: [0, 0, 0] as [number, number, number] });
  const yawOffset = useRef<Quat>([0, 0, 0, 1]);
  const selection = useRef({ cls, color });
  selection.current = { cls, color };

  // ─── Motion: sample natively, stream at a fixed rate ──────────────
  const streaming = screen !== 'scan' && screen !== 'full';
  useEffect(() => {
    if (!streaming) return;
    DeviceMotion.setUpdateInterval(1000 / SEND_HZ);
    const sub = DeviceMotion.addListener((m) => {
      if (m.rotation) {
        motion.current.alpha = m.rotation.alpha * RAD2DEG;
        motion.current.beta = m.rotation.beta * RAD2DEG;
        motion.current.gamma = m.rotation.gamma * RAD2DEG;
      }
      if (m.rotationRate) {
        motion.current.rate = [m.rotationRate.alpha, m.rotationRate.beta, m.rotationRate.gamma];
      }
    });
    const timer = setInterval(() => {
      const { alpha, beta, gamma, rate } = motion.current;
      const q = applyYawOffset(orientationToQuaternion(alpha, beta, gamma), yawOffset.current);
      conn.current?.send({ type: 'orientation', q, rotRate: rate, t: Date.now() });
    }, 1000 / SEND_HZ);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [streaming]);

  useEffect(() => () => conn.current?.close(), []);

  const calibrate = useCallback(() => {
    tap();
    yawOffset.current = computeYawOffset(motion.current.alpha);
    conn.current?.send({ type: 'calibrate', yawOffset: yawOffset.current });
  }, []);

  const sendSelection = (c: ClassName, col: SaberColor) => {
    conn.current?.send({ type: 'classSelect', className: c, saberColor: col });
  };

  const handleMessage = useCallback((msg: ServerToControllerMsg) => {
    switch (msg.type) {
      case 'controllerAssigned':
        setSlot(msg.slot);
        setScreen('classSelect');
        sendSelection(selection.current.cls, selection.current.color);
        break;
      case 'gameFull':
        setScreen('full');
        break;
      case 'invalidToken':
        conn.current?.close();
        conn.current = null;
        setStatus('That QR code has expired. Scan the one on the laptop again.');
        setScreen('scan');
        break;
      case 'haptic':
        playHaptic(msg.effect, msg.power, msg.smash);
        break;
      case 'gameState':
        if (msg.state === 'countdown' || msg.state === 'fighting') {
          setScreen('game');
        } else if (msg.state === 'classSelect' || msg.state === 'lobby') {
          setScreen('classSelect');
          setReady(false);
          setReadyNote('');
        }
        break;
      case 'cooldown':
        setCooldown(Math.ceil(msg.remaining));
        break;
      case 'roundResult':
        setReadyNote(`Round: P1 ${msg.scores[0]} - P2 ${msg.scores[1]}`);
        break;
      case 'matchResult':
        setReadyNote(`Player ${msg.winner} wins the match!`);
        break;
    }
  }, []);

  const connectTo = useCallback(async (data: string) => {
    const link = parseControllerLink(data);
    if (!link) {
      setStatus("That isn't a Nailong Battle QR code.");
      return;
    }
    const perm = await DeviceMotion.requestPermissionsAsync();
    if (!perm.granted) {
      setStatus('Motion access is needed to swing the sword. Enable it in Settings.');
      return;
    }
    tap(true);
    // Leaving 'scan' unmounts the camera: iOS mutes the Taptic Engine while it's running
    setScreen('connecting');
    setStatus('Connecting...');
    conn.current?.close();
    conn.current = new Connection(link.wsUrl, {
      onOpen: () => {
        setStatus('Connected! Joining...');
        conn.current?.send({ type: 'controllerJoin', playerId: PLAYER_ID, token: link.token });
      },
      onClose: () => setStatus('Disconnected. Reconnecting...'),
      onMessage: handleMessage,
    });
  }, [handleMessage]);

  // ─── Screens ───────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {screen === 'scan' && <ScanScreen status={status} onLink={connectTo} />}

      {screen === 'connecting' && (
        <View style={styles.center}>
          <Text style={styles.title}>Nailong Battle!</Text>
          <Text style={styles.body}>{status}</Text>
        </View>
      )}

      {screen === 'full' && (
        <View style={styles.center}>
          <Text style={styles.title}>Game Full</Text>
          <Text style={styles.body}>Two players are already connected.</Text>
        </View>
      )}

      {screen === 'classSelect' && (
        <ScrollView contentContainerStyle={styles.select}>
          <Text style={styles.title}>Player {slot}</Text>
          <Text style={styles.heading}>Class</Text>
          <View style={styles.grid}>
            {Object.values(CLASS_CONFIGS).map((cfg) => (
              <Chip
                key={cfg.name}
                label={cfg.displayName}
                selected={cls === cfg.name}
                onPress={() => {
                  tap();
                  setCls(cfg.name);
                  setColor(cfg.defaultColor);
                  sendSelection(cfg.name, cfg.defaultColor);
                }}
              />
            ))}
          </View>
          <Text style={styles.heading}>Saber color</Text>
          <View style={styles.grid}>
            {(Object.entries(SABER_COLORS) as [SaberColor, string][]).map(([name, hex]) => (
              <Chip
                key={name}
                label={name}
                accent={hex}
                selected={color === name}
                onPress={() => {
                  tap();
                  setColor(name);
                  sendSelection(cls, name);
                }}
              />
            ))}
          </View>
          <BigButton label="Calibrate (point at screen)" onPress={calibrate} />
          <BigButton
            label={ready ? 'Waiting for other player...' : 'Ready'}
            primary
            disabled={ready}
            onPress={() => {
              tap(true);
              conn.current?.send({ type: 'ready' });
              setReady(true);
            }}
          />
          {!!readyNote && <Text style={styles.body}>{readyNote}</Text>}
          <Pressable onPress={testAllHaptics} style={styles.link}>
            <Text style={styles.linkText}>Test haptics</Text>
          </Pressable>
        </ScrollView>
      )}

      {screen === 'game' && (
        <View style={styles.game}>
          <Pressable
            style={[styles.block, blocking && styles.blockHeld]}
            onPressIn={() => {
              tap(true);
              setBlocking(true);
              conn.current?.send({ type: 'button', button: 'block', state: 'down' });
            }}
            onPressOut={() => {
              setBlocking(false);
              conn.current?.send({ type: 'button', button: 'block', state: 'up' });
            }}
          >
            <Text style={styles.blockText}>BLOCK</Text>
          </Pressable>
          <View style={styles.gameRow}>
            <Pressable
              style={[styles.power, cooldown > 0 && styles.powerCooling]}
              onPressIn={() => {
                tap(true);
                conn.current?.send({ type: 'button', button: 'power', state: 'down' });
              }}
              onPressOut={() => conn.current?.send({ type: 'button', button: 'power', state: 'up' })}
            >
              <Text style={styles.powerText}>{cooldown > 0 ? `${cooldown}s` : 'POWER'}</Text>
            </Pressable>
            <Pressable style={styles.recal} onPress={calibrate}>
              <Text style={styles.recalText}>Recalibrate</Text>
            </Pressable>
          </View>
          <Text style={styles.body}>Player {slot}</Text>
        </View>
      )}
    </View>
  );
}

function ScanScreen({ status, onLink }: { status: string; onLink: (data: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const handled = useRef(false);

  useEffect(() => {
    handled.current = false;
  }, [status]);

  return (
    <View style={styles.scan}>
      <Text style={styles.title}>Nailong Battle!</Text>
      <Text style={styles.body}>Scan the QR code on your laptop</Text>
      <View style={styles.cameraBox}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              handled.current = true;
              onLink(data);
            }}
          />
        ) : (
          <Pressable style={styles.center} onPress={requestPermission}>
            <Text style={styles.body}>Tap to allow the camera</Text>
          </Pressable>
        )}
      </View>
      {!!status && <Text style={styles.error}>{status}</Text>}
      <TextInput
        style={styles.input}
        placeholder="…or paste the controller link"
        placeholderTextColor="#777"
        autoCapitalize="none"
        autoCorrect={false}
        value={manual}
        onChangeText={setManual}
        onSubmitEditing={() => onLink(manual)}
      />
    </View>
  );
}

function Chip(props: { label: string; selected: boolean; accent?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.chip,
        props.accent ? { borderColor: props.accent } : null,
        props.selected && styles.chipSelected,
      ]}
    >
      <Text style={[styles.chipText, props.selected && styles.chipTextSelected]}>{props.label}</Text>
    </Pressable>
  );
}

function BigButton(props: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.big,
        props.primary && styles.bigPrimary,
        (pressed || props.disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.bigText, props.primary && styles.bigTextPrimary]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontFamily: FONT, fontSize: 34, fontWeight: '700', color: YELLOW, textAlign: 'center' },
  heading: { fontFamily: FONT, fontSize: 20, color: '#fff', marginTop: 8 },
  body: { fontFamily: FONT, fontSize: 16, color: '#ccc', textAlign: 'center' },
  error: { fontFamily: FONT, fontSize: 15, color: '#ff8a80', textAlign: 'center' },

  scan: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 20, gap: 14 },
  cameraBox: {
    width: '100%', aspectRatio: 1, borderRadius: 20, overflow: 'hidden',
    borderWidth: 3, borderColor: YELLOW, backgroundColor: '#000',
  },
  input: {
    width: '100%', borderWidth: 1, borderColor: '#444', borderRadius: 10,
    color: '#fff', padding: 12, fontSize: 14,
  },

  select: { paddingTop: 70, paddingHorizontal: 20, paddingBottom: 40, gap: 12, alignItems: 'stretch' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 2, borderColor: '#555', backgroundColor: '#222',
  },
  chipSelected: { backgroundColor: YELLOW, borderColor: YELLOW },
  chipText: { fontFamily: FONT, fontSize: 16, color: '#fff', textTransform: 'capitalize' },
  chipTextSelected: { color: '#3a2600' },
  big: {
    marginTop: 8, paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    borderWidth: 2, borderColor: '#555', backgroundColor: '#222',
  },
  bigPrimary: { backgroundColor: YELLOW, borderColor: '#5a3a00' },
  bigText: { fontFamily: FONT, fontSize: 18, color: '#fff' },
  bigTextPrimary: { color: '#3a2600', fontWeight: '700' },
  link: { alignSelf: 'center', padding: 10 },
  linkText: { fontFamily: FONT, color: '#888', textDecorationLine: 'underline' },

  game: { flex: 1, padding: 16, paddingTop: 60, paddingBottom: 40, gap: 14 },
  block: {
    flex: 1, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1d3b66', borderWidth: 3, borderColor: '#4f8fe0',
  },
  blockHeld: { backgroundColor: '#2f6ad0', borderColor: '#bfe0ff' },
  blockText: { fontFamily: FONT, fontSize: 48, fontWeight: '700', color: '#fff' },
  gameRow: { flexDirection: 'row', gap: 14, height: 140 },
  power: {
    flex: 2, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: YELLOW, borderWidth: 3, borderColor: '#5a3a00',
  },
  powerCooling: { opacity: 0.45 },
  powerText: { fontFamily: FONT, fontSize: 32, fontWeight: '700', color: '#3a2600' },
  recal: {
    flex: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#222', borderWidth: 2, borderColor: '#555',
  },
  recalText: { fontFamily: FONT, fontSize: 15, color: '#fff', textAlign: 'center' },
});
