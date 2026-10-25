import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, ComicNeue_400Regular, ComicNeue_700Bold } from '@expo-google-fonts/comic-neue';
import type { ClassName, SaberColor, ServerToControllerMsg } from '../src/shared/protocol';
import { CLASS_CONFIGS, SABER_COLORS, classTraits } from '../src/shared/classes';
import { Connection, parseControllerLink } from './src/connection';
import { applyYawOffset, computeYawOffset, orientationToQuaternion, type Quat } from './src/orientation';
import { playHaptic, tap, testAllHaptics } from './src/haptics';
import {
  BROWN, BoltIcon, CameraIcon, Card, CheckIcon, Chunky, ClassIcon, CrosshairIcon, FONT, FONT_REGULAR,
  Float, GRADIENTS, GameTitle, INK, LockIcon, NAVY, Orb, PlayIcon, Pulse, QrIcon, ShieldIcon,
} from './src/ui';

type Screen = 'scan' | 'connecting' | 'classSelect' | 'game' | 'full';

const SEND_HZ = 60;
const RAD2DEG = 180 / Math.PI;
const PLAYER_ID = `app-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export default function App() {
  useKeepAwake();
  const [fontsLoaded] = useFonts({ ComicNeue_400Regular, ComicNeue_700Bold });
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('scan');
  const [status, setStatus] = useState('');
  const [slot, setSlot] = useState<1 | 2 | null>(null);
  const [cls, setCls] = useState<ClassName>('guardian');
  const [color, setColor] = useState<SaberColor>('blue');
  const [ready, setReady] = useState(false);
  const [readyNote, setReadyNote] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [blocking, setBlocking] = useState(false);
  const [infoClass, setInfoClass] = useState<ClassName | null>(null);

  const conn = useRef<Connection | null>(null);
  const motion = useRef({ alpha: 0, beta: 0, gamma: 0, rate: [0, 0, 0] as [number, number, number] });
  const yawOffset = useRef<Quat>([0, 0, 0, 1]);
  const selection = useRef({ cls, color });
  selection.current = { cls, color };

  // â”€â”€â”€ Motion: sample natively, stream at a fixed rate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        setReadyNote(`P1 ${msg.scores[0]} - P2 ${msg.scores[1]}`);
        break;
      case 'matchResult':
        setReadyNote(`P${msg.winner} WINS!`);
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

  if (!fontsLoaded) return <CreamBackground>{null}</CreamBackground>;

  const zoneIcon = Math.min(width * 0.34, 150);
  const cooling = cooldown > 0;

  // ─── Screens ───────────────────────────────────────────────────────
  if (screen === 'game') {
    return (
      <View style={[styles.root, styles.game]}>
        <StatusBar style="light" />
        <View style={styles.hud}>
          <Chunky
            colors={['rgba(30,41,59,0.95)', 'rgba(30,41,59,0.95)']}
            radius={22}
            depth={3}
            borderWidth={2.5}
            shadowColor="#020617"
            faceStyle={[styles.hudButton, { borderColor: '#334155' }]}
            onPress={() => {
              calibrate();
              tap(true);
            }}
            accessibilityLabel="Recalibrate"
          >
            <CrosshairIcon size={24} color="#94a3b8" />
          </Chunky>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>P{slot}</Text>
          </View>
        </View>

        <Chunky
          colors={GRADIENTS.block}
          radius={26}
          depth={8}
          borderWidth={4}
          held={blocking}
          style={styles.zone}
          faceStyle={styles.zoneFace}
          onPressIn={() => {
            tap(true);
            setBlocking(true);
            conn.current?.send({ type: 'button', button: 'block', state: 'down' });
          }}
          onPressOut={() => {
            setBlocking(false);
            conn.current?.send({ type: 'button', button: 'block', state: 'up' });
          }}
          accessibilityLabel="Block"
        >
          {blocking && <View style={styles.blockGlow} />}
          <View style={{ transform: [{ scale: blocking ? 1.1 : 1 }] }}>
            <ShieldIcon size={zoneIcon} />
          </View>
        </Chunky>

        <Chunky
          colors={cooling ? GRADIENTS.cooldown : GRADIENTS.power}
          radius={26}
          depth={cooling ? 6 : 8}
          borderWidth={4}
          shadowColor={cooling ? '#1e293b' : INK}
          style={[styles.zone, cooling && { opacity: 0.75 }]}
          faceStyle={styles.zoneFace}
          onPressIn={() => {
            tap(true);
            conn.current?.send({ type: 'button', button: 'power', state: 'down' });
          }}
          onPressOut={() => conn.current?.send({ type: 'button', button: 'power', state: 'up' })}
          accessibilityLabel="Power"
        >
          <Pulse active={!cooling}>
            <View style={cooling && styles.iconCooling}>
              <ClassIcon name={cls} size={zoneIcon} />
            </View>
          </Pulse>
          {cooling && (
            <View style={styles.cooldownWrap} pointerEvents="none">
              <OutlinedText text={`${cooldown}s`} size={44} />
            </View>
          )}
        </Chunky>
      </View>
    );
  }

  return (
    <CreamBackground>
      <StatusBar style="dark" />
      {screen === 'scan' && <ScanScreen status={status} onLink={connectTo} />}

      {screen === 'connecting' && (
        <View style={styles.center}>
          <GameTitle />
          <Float>
            <Chunky colors={GRADIENTS.yellowButton} radius={60} depth={8} faceStyle={styles.heroButton}>
              <PlayIcon />
            </Chunky>
          </Float>
          <Text style={styles.status}>{status}</Text>
        </View>
      )}

      {screen === 'full' && (
        <View style={styles.center}>
          <GameTitle />
          <Notice icon={<LockIcon />} text="Match Full (2/2 Players)" />
        </View>
      )}

      {screen === 'classSelect' && (
        <ScrollView contentContainerStyle={styles.select} bounces={false}>
          <GameTitle />
          <View style={styles.classGrid}>
            {Object.values(CLASS_CONFIGS).map((cfg) => {
              const selected = cls === cfg.name;
              return (
                <Chunky
                  key={cfg.name}
                  colors={selected ? GRADIENTS.selectedCard : GRADIENTS.white}
                  radius={20}
                  depth={5}
                  held={selected}
                  style={[styles.classCard, selected && { transform: [{ scale: 1.02 }] }]}
                  faceStyle={styles.classFace}
                  onPress={() => {
                    tap();
                    setCls(cfg.name);
                    setColor(cfg.defaultColor);
                    sendSelection(cfg.name, cfg.defaultColor);
                  }}
                  accessibilityLabel={`${cfg.displayName}: ${cfg.ability.name}`}
                >
                  <ClassIcon name={cfg.name} size={48} />
                  <Text style={styles.className}>{cfg.displayName}</Text>
                  {selected && <Text style={styles.star}>★</Text>}
                  <Pressable
                    style={({ pressed }) => [styles.infoBadge, pressed && styles.infoBadgePressed]}
                    hitSlop={10}
                    onPress={() => {
                      tap();
                      setInfoClass(cfg.name);
                    }}
                    accessibilityLabel={`${cfg.displayName} ability info`}
                  >
                    <Text style={styles.infoBadgeText}>i</Text>
                  </Pressable>
                </Chunky>
              );
            })}
          </View>

          <View style={styles.colorPillWrap}>
            <View style={[StyleSheet.absoluteFill, styles.colorPillShadow]} />
            <View style={styles.colorPill}>
              {(Object.entries(SABER_COLORS) as [SaberColor, string][]).map(([name, hex]) => {
                const selected = color === name;
                return (
                  <Pressable
                    key={name}
                    accessibilityLabel={`${name} saber`}
                    onPress={() => {
                      tap();
                      setColor(name);
                      sendSelection(cls, name);
                    }}
                    style={({ pressed }) => [
                      styles.orb,
                      selected && styles.orbSelected,
                      selected && { shadowColor: hex },
                      pressed && { transform: [{ scale: 0.95 }] },
                    ]}
                  >
                    <Orb color={hex} size={38} />
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.actionBar}>
            <Chunky
              colors={GRADIENTS.calibrate}
              radius={28}
              depth={5}
              faceStyle={styles.calibrateButton}
              onPress={calibrate}
              accessibilityLabel="Calibrate: point the phone at the screen"
            >
              <CrosshairIcon />
            </Chunky>
            <Chunky
              colors={ready ? GRADIENTS.disabled : GRADIENTS.ready}
              radius={40}
              depth={ready ? 4 : 6}
              disabled={ready}
              faceStyle={styles.readyButton}
              onPress={() => {
                tap(true);
                conn.current?.send({ type: 'ready' });
                setReady(true);
              }}
              accessibilityLabel="Ready"
            >
              <CheckIcon color={ready ? '#64748b' : '#ffffff'} />
            </Chunky>
          </View>
          <Text style={styles.status}>
            {ready ? 'Waiting for other player...' : readyNote || 'Point at the screen, tap the target, then ready up!'}
          </Text>
          {ready && !!readyNote && <Text style={styles.status}>{readyNote}</Text>}
          <Pressable onPress={testAllHaptics} style={styles.link}>
            <Text style={styles.linkText}>Test haptics</Text>
          </Pressable>
          <ClassInfo
            name={infoClass}
            onClose={() => setInfoClass(null)}
            onPick={(name) => {
              tap(true);
              setCls(name);
              setColor(CLASS_CONFIGS[name].defaultColor);
              sendSelection(name, CLASS_CONFIGS[name].defaultColor);
              setInfoClass(null);
            }}
          />
        </ScrollView>
      )}
    </CreamBackground>
  );
}

function CreamBackground({ children }: { children: ReactNode }) {
  return (
    <LinearGradient colors={GRADIENTS.cream} locations={[0, 0.6, 1]} style={styles.root}>
      {children}
    </LinearGradient>
  );
}

function ClassInfo({ name, onClose, onPick }: {
  name: ClassName | null;
  onClose: () => void;
  onPick: (name: ClassName) => void;
}) {
  const cfg = name ? CLASS_CONFIGS[name] : null;
  return (
    <Modal visible={!!cfg} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.infoBackdrop} onPress={onClose}>
        {cfg && (
          <Pressable onPress={() => {}} style={styles.infoSheetWrap}>
            <Card>
              <Pressable style={styles.infoClose} onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Text style={styles.infoCloseText}>×</Text>
              </Pressable>
              <ClassIcon name={cfg.name} size={72} />
              <GameTitle text={cfg.displayName} size={30} />
              <View style={styles.abilityCard}>
                <BoltIcon size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.abilityName}>{cfg.ability.name}</Text>
                  <Text style={styles.abilityDesc}>{cfg.ability.description}.</Text>
                  <Text style={styles.abilityCooldown}>
                    {cfg.ability.cooldown}s cooldown{cfg.ability.duration ? ` · lasts ${cfg.ability.duration}s` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.traits}>
                {classTraits(cfg).map((t) => (
                  <View key={t.text} style={[styles.trait, { backgroundColor: t.good ? '#bbf7d0' : '#fecaca' }]}>
                    <Text style={styles.traitText}>{t.text}</Text>
                  </View>
                ))}
              </View>
              <Chunky
                colors={GRADIENTS.ready}
                radius={9999}
                depth={5}
                style={{ alignSelf: 'stretch' }}
                faceStyle={styles.pickFace}
                onPress={() => onPick(cfg.name)}
              >
                <Text style={styles.pickText}>Pick this class</Text>
              </Chunky>
            </Card>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

function Notice({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Card style={styles.noticeCard}>
      <View style={styles.iconBubble}>{icon}</View>
      <Text style={styles.noticeText}>{text}</Text>
    </Card>
  );
}

/** White number with a dark outline, for the cooldown */
function OutlinedText({ text, size }: { text: string; size: number }) {
  const s = 2;
  const offsets: [number, number][] = [[-s, 0], [s, 0], [0, -s], [0, s], [-s, -s], [s, -s], [-s, s], [s, s], [0, 4]];
  return (
    <View>
      {offsets.map(([x, y], i) => (
        <Text
          key={i}
          style={[styles.outlined, { fontSize: size, color: NAVY, position: 'absolute', transform: [{ translateX: x }, { translateY: y }] }]}
        >
          {text}
        </Text>
      ))}
      <Text style={[styles.outlined, { fontSize: size }]}>{text}</Text>
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
    <ScrollView contentContainerStyle={styles.scan} bounces={false} keyboardShouldPersistTaps="handled">
      <GameTitle />
      <View style={styles.scanHint}>
        <View style={styles.iconBubbleSmall}><QrIcon size={26} /></View>
        <Text style={styles.noticeText}>Scan QR code on desktop to join!</Text>
      </View>

      <Card style={styles.cameraCard}>
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
            <View style={styles.cameraPrompt}>
              <Float>
                <Chunky
                  colors={GRADIENTS.yellowButton}
                  radius={55}
                  depth={7}
                  faceStyle={styles.cameraButton}
                  onPress={requestPermission}
                  accessibilityLabel="Allow the camera"
                >
                  <CameraIcon />
                </Chunky>
              </Float>
              <Text style={styles.status}>Tap to allow the camera</Text>
            </View>
          )}
          {permission?.granted && <View style={styles.viewfinder} pointerEvents="none" />}
        </View>
      </Card>

      {!!status && <Text style={styles.error}>{status}</Text>}
      <TextInput
        style={styles.input}
        placeholder="...or paste the controller link"
        placeholderTextColor="#a16207"
        autoCapitalize="none"
        autoCorrect={false}
        value={manual}
        onChangeText={setManual}
        onSubmitEditing={() => onLink(manual)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 },
  status: { fontFamily: FONT, fontSize: 15, color: BROWN, textAlign: 'center', minHeight: 22 },
  error: { fontFamily: FONT, fontSize: 15, color: '#b91c1c', textAlign: 'center' },

  noticeCard: { maxWidth: 320, width: '100%' },
  iconBubble: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: '#fef08a',
    borderWidth: 3, borderColor: INK, alignItems: 'center', justifyContent: 'center',
  },
  iconBubbleSmall: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fef08a',
    borderWidth: 3, borderColor: INK, alignItems: 'center', justifyContent: 'center',
  },
  noticeText: { fontFamily: FONT, fontSize: 16, color: INK, textAlign: 'center', flexShrink: 1 },
  heroButton: { width: 120, height: 120 },

  scan: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingBottom: 40, paddingHorizontal: 20, gap: 18 },
  scanHint: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cameraCard: { width: '100%', maxWidth: 360 },
  cameraBox: {
    width: '100%', aspectRatio: 1, borderRadius: 18, overflow: 'hidden',
    borderWidth: 3, borderColor: INK, backgroundColor: '#fff7d6',
  },
  cameraPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  cameraButton: { width: 110, height: 110 },
  viewfinder: {
    position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%',
    borderWidth: 4, borderColor: '#ffd23a', borderRadius: 18, borderStyle: 'dashed',
  },
  input: {
    width: '100%', maxWidth: 360, borderWidth: 2.5, borderColor: INK, borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.8)', color: INK, paddingVertical: 12, paddingHorizontal: 18,
    fontSize: 14, fontFamily: FONT_REGULAR,
  },

  select: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 70, paddingBottom: 40, paddingHorizontal: 20, gap: 18 },
  classGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, width: '100%', maxWidth: 380 },
  classCard: { width: '48%' },
  classFace: { minHeight: 100, paddingVertical: 12 },
  className: { fontFamily: FONT, fontSize: 15, color: INK, marginTop: 4 },
  star: { position: 'absolute', top: 6, right: 10, fontSize: 16, color: '#f59e0b' },
  infoBadge: {
    position: 'absolute', top: 6, left: 6, width: 28, height: 28, borderRadius: 14,
    borderWidth: 2.5, borderColor: INK, backgroundColor: '#38bdf8',
    alignItems: 'center', justifyContent: 'center',
  },
  infoBadgePressed: { transform: [{ translateY: 2 }], backgroundColor: '#0ea5e9' },
  infoBadgeText: { fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '700', fontSize: 16, color: '#ffffff', marginTop: -1 },

  infoBackdrop: { flex: 1, backgroundColor: 'rgba(45,30,15,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  infoSheetWrap: { width: '100%', maxWidth: 340 },
  infoClose: {
    position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, zIndex: 2,
    borderWidth: 2.5, borderColor: INK, backgroundColor: '#fef08a', alignItems: 'center', justifyContent: 'center',
  },
  infoCloseText: { fontFamily: FONT, fontSize: 22, color: INK, lineHeight: 24 },
  abilityCard: {
    flexDirection: 'row', gap: 10, alignSelf: 'stretch', padding: 12,
    backgroundColor: '#fffbeb', borderWidth: 2.5, borderColor: INK, borderRadius: 18,
  },
  abilityName: { fontFamily: FONT, fontSize: 18, color: INK },
  abilityDesc: { fontFamily: FONT_REGULAR, fontSize: 15, color: INK, marginTop: 2 },
  abilityCooldown: { fontFamily: FONT, fontSize: 13, color: BROWN, marginTop: 6 },
  traits: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  trait: { paddingVertical: 4, paddingHorizontal: 10, borderWidth: 2, borderColor: INK, borderRadius: 9999 },
  traitText: { fontFamily: FONT, fontSize: 13, color: INK },
  pickFace: { paddingVertical: 12 },
  pickText: { fontFamily: FONT, fontSize: 18, color: '#ffffff' },

  colorPillWrap: { paddingBottom: 4 },
  colorPillShadow: { top: 4, borderRadius: 9999, backgroundColor: INK },
  colorPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: '#fffdf5', borderWidth: 2.5, borderColor: INK, borderRadius: 9999,
  },
  orb: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  orbSelected: {
    transform: [{ scale: 1.18 }], borderWidth: 3, borderColor: INK, backgroundColor: '#ffffff',
    shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },

  actionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  calibrateButton: { width: 56, height: 56 },
  readyButton: { width: 80, height: 80 },
  link: { padding: 8 },
  linkText: { fontFamily: FONT_REGULAR, fontSize: 13, color: '#a16207', textDecorationLine: 'underline' },

  game: { backgroundColor: NAVY, paddingHorizontal: 14, paddingTop: 56, paddingBottom: 34, gap: 14 },
  hud: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 50 },
  hudButton: { width: 44, height: 44 },
  badge: {
    paddingVertical: 6, paddingHorizontal: 16, backgroundColor: '#1e293b',
    borderWidth: 2.5, borderColor: '#475569', borderRadius: 9999,
  },
  badgeText: { fontFamily: FONT, fontSize: 16, color: '#fde047', letterSpacing: 0.5 },
  zone: { flex: 1 },
  zoneFace: { flex: 1 },
  blockGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.15)' },
  iconCooling: { opacity: 0.45 },
  cooldownWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  outlined: { fontFamily: FONT, color: '#ffffff', textAlign: 'center' },
});

