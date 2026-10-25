import type { ClassName, SaberColor } from './protocol.js';

export interface ClassConfig {
  name: ClassName;
  displayName: string;
  defaultColor: SaberColor;
  ability: {
    name: string;
    description: string;
    cooldown: number; // seconds
    duration: number; // seconds (0 = instant)
  };
  /** Class-specific stat multipliers */
  stats: {
    knockbackDealt: number;
    knockbackReceived: number;
    moveSpeed: number;
  };
}

export const CLASS_CONFIGS: Record<ClassName, ClassConfig> = {
  guardian: {
    name: 'guardian',
    displayName: 'Guardian',
    defaultColor: 'blue',
    ability: {
      name: 'Shockwave Push',
      description: 'Short-range blast that knocks opponent back',
      cooldown: 12,
      duration: 0,
    },
    stats: {
      knockbackDealt: 1.0,
      knockbackReceived: 0.85,
      moveSpeed: 0.9,
    },
  },
  striker: {
    name: 'striker',
    displayName: 'Striker',
    defaultColor: 'red',
    ability: {
      name: 'Overcharge',
      description: '4s of double knockback and a longer, brighter blade',
      cooldown: 15,
      duration: 4,
    },
    stats: {
      knockbackDealt: 1.15,
      knockbackReceived: 1.1,
      moveSpeed: 1.0,
    },
  },
  mystic: {
    name: 'mystic',
    displayName: 'Mystic',
    defaultColor: 'purple',
    ability: {
      name: 'Barrier',
      description: '3s bubble that auto-blocks everything',
      cooldown: 18,
      duration: 3,
    },
    stats: {
      knockbackDealt: 0.9,
      knockbackReceived: 1.0,
      moveSpeed: 1.0,
    },
  },
  phantom: {
    name: 'phantom',
    displayName: 'Phantom',
    defaultColor: 'green',
    ability: {
      name: 'Blink',
      description: 'Instant short dash in the saber direction',
      cooldown: 8,
      duration: 0,
    },
    stats: {
      knockbackDealt: 1.0,
      knockbackReceived: 1.05,
      moveSpeed: 1.15,
    },
  },
};

export const SABER_COLORS: Record<SaberColor, string> = {
  blue: '#4488ff',
  red: '#ff3333',
  green: '#33ff66',
  purple: '#aa44ff',
  orange: '#ff8800',
  white: '#eeeeff',
};
