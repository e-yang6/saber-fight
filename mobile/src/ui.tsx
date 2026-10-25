import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated, Easing, Pressable, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle, Defs, Ellipse, Line, Path, Polyline, RadialGradient, Rect, Stop, G,
} from 'react-native-svg';
import type { ClassName } from '../../src/shared/protocol';

// Same palette as the web controller (src/client/controller/styles.css)
export const INK = '#2d1e0f';
export const TITLE = '#ffd23a';
export const TITLE_STROKE = '#5a3a00';
export const BROWN = '#78350f';
export const NAVY = '#0f172a';
export const FONT = 'ComicNeue_700Bold';
export const FONT_REGULAR = 'ComicNeue_400Regular';

export const GRADIENTS = {
  cream: ['#fffef7', '#fff7d6', '#fed7aa'],
  yellowButton: ['#fff3a1', '#ffd23a'],
  calibrate: ['#7dd3fc', '#0284c7'],
  ready: ['#4ade80', '#16a34a'],
  disabled: ['#cbd5e1', '#cbd5e1'],
  block: ['#38bdf8', '#0284c7', '#0369a1'],
  power: ['#fde047', '#f59e0b', '#d97706'],
  cooldown: ['#475569', '#334155'],
  white: ['#ffffff', '#ffffff'],
  selectedCard: ['#fefce8', '#fefce8'],
} as const satisfies Record<string, readonly [string, string, ...string[]]>;

/** Comic title: yellow fill with a thick brown outline and a dropped shadow */
export function GameTitle({ text = 'Nailong Battle!', size = 42 }: { text?: string; size?: number }) {
  const s = Math.max(2, Math.round(size / 16));
  const offsets: [number, number][] = [
    [-s, 0], [s, 0], [0, -s], [0, s], [-s, -s], [s, -s], [-s, s], [s, s],
    [0, s + 4], [-s, s + 4], [s, s + 4],
  ];
  const textStyle = [styles.titleText, { fontSize: size, lineHeight: size * 1.2 }];
  return (
    <View accessibilityRole="header" accessibilityLabel={text}>
      {offsets.map(([x, y], i) => (
        <Text
          key={i}
          style={[textStyle, styles.titleOutline, { transform: [{ translateX: x }, { translateY: y }] }]}
          importantForAccessibility="no"
        >
          {text}
        </Text>
      ))}
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

type ChunkyProps = {
  colors: readonly [string, string, ...string[]];
  radius: number;
  depth?: number;
  borderWidth?: number;
  shadowColor?: string;
  /** Force the pushed-in look (e.g. while block is held) */
  held?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  faceStyle?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
};

/** Cartoon button: ink outline, gradient face, solid offset shadow that the face sinks into */
export function Chunky(props: ChunkyProps) {
  const {
    colors, radius, depth = 6, borderWidth = 3.5, shadowColor = INK, held, disabled,
    style, faceStyle, children,
  } = props;
  const [pressed, setPressed] = useState(false);
  const down = (pressed || held) && !disabled;
  const sink = down ? depth - 2 : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      disabled={disabled}
      onPress={props.onPress}
      onPressIn={() => {
        setPressed(true);
        props.onPressIn?.();
      }}
      onPressOut={() => {
        setPressed(false);
        props.onPressOut?.();
      }}
      style={[{ paddingBottom: depth }, style]}
    >
      <View style={[StyleSheet.absoluteFill, { top: depth, borderRadius: radius, backgroundColor: shadowColor }]} />
      <View
        style={[
          styles.face,
          { borderRadius: radius, borderWidth, transform: [{ translateY: sink }] },
          faceStyle,
        ]}
      >
        <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
        <View style={styles.content}>{children}</View>
      </View>
    </Pressable>
  );
}

/** White rounded card with ink outline and offset shadow */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingBottom: 6 }, style]}>
      <View style={[StyleSheet.absoluteFill, { top: 6, borderRadius: 24, backgroundColor: INK }]} />
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/** Gentle bob, like the web connect button */
export function Float({ children }: { children: ReactNode }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: -8, duration: 1250, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 1250, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [y]);
  return <Animated.View style={{ transform: [{ translateY: y }] }}>{children}</Animated.View>;
}

/** Breathing scale while the power is ready */
export function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, scale]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

// ─── Icons (paths copied from the web controller) ───────────────────

export function PlayIcon({ size = 60 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" style={{ transform: [{ translateX: size / 20 }] }}>
      <Path d="M14 10 L38 24 L14 38 Z" fill={TITLE} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
    </Svg>
  );
}

export function QrIcon({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Rect x="7" y="7" width="3" height="3" fill={INK} />
      <Rect x="14" y="7" width="3" height="3" fill={INK} />
      <Rect x="7" y="14" width="3" height="3" fill={INK} />
      <Path d="M14 14 h3 v3" />
    </Svg>
  );
}

export function LockIcon({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

export function CameraIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 8 h3 l2 -3 h6 l2 3 h3 a1 1 0 0 1 1 1 v9 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 V9 a1 1 0 0 1 1 -1 Z" fill={TITLE} />
      <Circle cx="12" cy="13" r="3.5" fill="#ffffff" />
    </Svg>
  );
}

export function CrosshairIcon({ size = 32, color = '#ffffff', strokeWidth = 2.5 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="8" />
      <Circle cx="12" cy="12" r="2.5" fill={color} />
      <Line x1="12" y1="1" x2="12" y2="4" />
      <Line x1="12" y1="20" x2="12" y2="23" />
      <Line x1="1" y1="12" x2="4" y2="12" />
      <Line x1="20" y1="12" x2="23" y2="12" />
    </Svg>
  );
}

export function CheckIcon({ size = 44, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function ShieldIcon({ size = 110 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M32 6 L54 14 V30 C54 44 43 54 32 58 C21 54 10 44 10 30 V14 Z" fill="#e0f2fe" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <Path d="M32 12 L46 18 V28 C46 38 39 46 32 49 C25 46 18 38 18 28 V18 Z" fill="#38bdf8" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M32 18 L40 22 V28 C40 34 36 39 32 41 C28 39 24 34 24 28 V22 Z" fill="#ffffff" />
    </Svg>
  );
}

export function BoltIcon({ size = 110 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M37 4 L12 36 H29 L23 60 L52 26 H33 Z" fill={INK} />
      <Path d="M36 6 L14 36 H30 L25 58 L50 28 H33 Z" fill="#ffffff" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M34 10 L19 33 H31 L27 50 L44 29 H31 Z" fill="#fef08a" />
    </Svg>
  );
}

export function ClassIcon({ name, size = 44 }: { name: ClassName; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {name === 'guardian' && (
        <G>
          <Path d="M24 4 L42 10 V24 C42 34 33 42 24 45 C15 42 6 34 6 24 V10 Z" fill="#3b82f6" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <Path d="M24 10 L36 14 V24 C36 31 30 37 24 39 C18 37 12 31 12 24 V14 Z" fill="#60a5fa" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <Path d="M24 16 L26.5 21.5 L32 22.5 L28 26.5 L29 32 L24 29 L19 32 L20 26.5 L16 22.5 L21.5 21.5 Z" fill="#ffffff" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
        </G>
      )}
      {name === 'striker' && (
        <G>
          <Path d="M10 38 L34 10 L38 14 L14 42 Z" fill="#ef4444" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <Path d="M34 10 L40 6 L42 8 L38 14 Z" fill="#fef08a" stroke={INK} strokeWidth={2} />
          <Path d="M7 35 L13 41 L10 44 L4 38 Z" fill="#b91c1c" stroke={INK} strokeWidth={2} />
          <Path d="M38 38 L14 10 L10 14 L34 42 Z" fill="#f97316" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <Path d="M14 10 L8 6 L6 8 L10 14 Z" fill="#fef08a" stroke={INK} strokeWidth={2} />
          <Path d="M41 35 L35 41 L38 44 L44 38 Z" fill="#c2410c" stroke={INK} strokeWidth={2} />
          <Circle cx="24" cy="24" r="3.5" fill="#ffffff" stroke={INK} strokeWidth={2} />
        </G>
      )}
      {name === 'mystic' && (
        <G>
          <Circle cx="24" cy="24" r="13" fill="#a855f7" stroke={INK} strokeWidth={3} />
          <Circle cx="21" cy="21" r="9" fill="#c084fc" />
          <Circle cx="18" cy="18" r="3" fill="#ffffff" />
          <Ellipse cx="24" cy="24" rx="19" ry="6.5" transform="rotate(-25 24 24)" stroke={INK} strokeWidth={3} fill="none" />
          <Ellipse cx="24" cy="24" rx="19" ry="6.5" transform="rotate(-25 24 24)" stroke="#fef08a" strokeWidth={1.8} fill="none" />
          <Path d="M37 10 L38.5 13.5 L42 15 L38.5 16.5 L37 20 L35.5 16.5 L32 15 L35.5 13.5 Z" fill="#ffffff" stroke={INK} strokeWidth={1.5} />
        </G>
      )}
      {name === 'phantom' && (
        <G>
          <Path d="M8 20 L16 20 M6 26 L18 26 M10 32 L20 32" stroke="#047857" strokeWidth={3} strokeLinecap="round" />
          <Path d="M28 4 L14 26 H26 L20 44 L40 18 H26 Z" fill="#10b981" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <Path d="M26 10 L19 24 H28 L23 37 L34 20 H25 Z" fill="#a7f3d0" />
        </G>
      )}
    </Svg>
  );
}

/** Glossy saber color orb */
export function Orb({ color, size = 40 }: { color: string; size?: number }) {
  const id = `orb-${color.replace('#', '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <RadialGradient id={id} cx="35%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.45" stopColor={color} />
          <Stop offset="1" stopColor="#111827" />
        </RadialGradient>
      </Defs>
      <Circle cx="20" cy="20" r="18.5" fill={`url(#${id})`} stroke={INK} strokeWidth={3} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  titleText: {
    fontFamily: FONT,
    color: TITLE,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  titleOutline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    color: TITLE_STROKE,
  },
  face: {
    borderColor: INK,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    gap: 14,
    padding: 22,
    backgroundColor: '#ffffff',
    borderWidth: 3.5,
    borderColor: INK,
    borderRadius: 24,
  },
});
