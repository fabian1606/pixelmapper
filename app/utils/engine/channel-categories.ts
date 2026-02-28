import type { Component } from 'vue';
import type { ChannelType } from './types';
import type { Fixture } from './core/fixture';
import {
  Lightbulb,
  Palette,
  Move,
  Aperture,
  Disc3,
  Sun,
  Zap,
  Star,
  Hexagon,
  Scissors,
  Wind,
  ZoomIn,
  Focus,
  Settings,
  Activity,
  Orbit,
  Gauge,
  Thermometer,
  MinusCircle,
  SlidersHorizontal,
} from 'lucide-vue-next';

export type ChannelCategoryKey = 'intensity' | 'color' | 'position' | 'beam' | 'shaping' | 'effects' | 'control';

export interface ChannelCategory {
  id: ChannelCategoryKey;
  label: string;
  icon: Component;
  types: ChannelType[];
}

/**
 * Global definitions mapping UI tabs/categories to ChannelTypes.
 */
export const CHANNEL_CATEGORIES: ChannelCategory[] = [
  {
    id: 'intensity',
    label: 'Intensity',
    icon: Lightbulb,
    types: ['DIMMER'],
  },
  {
    id: 'color',
    label: 'Color',
    icon: Palette,
    types: ['RED', 'GREEN', 'BLUE', 'WHITE', 'WARM_WHITE', 'COOL_WHITE', 'AMBER', 'UV', 'CYAN', 'MAGENTA', 'YELLOW', 'LIME', 'INDIGO', 'COLOR_WHEEL', 'COLOR_PRESET', 'COLOR_TEMPERATURE'],
  },
  {
    id: 'position',
    label: 'Position',
    icon: Move,
    types: ['PAN', 'TILT', 'PANTILT_SPEED'],
  },
  {
    id: 'beam',
    label: 'Beam',
    icon: Aperture,
    types: ['STROBE', 'STROBE_SPEED', 'STROBE_DURATION', 'ZOOM', 'FOCUS', 'IRIS', 'FROST', 'BEAM_ANGLE', 'BEAM_POSITION'],
  },
  {
    id: 'shaping',
    label: 'Shaping',
    icon: Orbit,
    types: ['GOBO_WHEEL', 'GOBO_SPIN', 'PRISM', 'PRISM_ROTATION', 'BLADE'],
  },
  {
    id: 'effects',
    label: 'Effects',
    icon: Activity,
    types: ['EFFECT', 'EFFECT_SPEED', 'EFFECT_DURATION', 'SOUND_SENSITIVITY', 'ROTATION', 'SPEED', 'TIME'],
  },
  {
    id: 'control',
    label: 'Control',
    icon: Settings,
    types: ['FOG', 'MAINTENANCE', 'GENERIC', 'NO_FUNCTION', 'CUSTOM'],
  }
];

/**
 * Flat array of all supported ChannelTypes sorted according to the UI category display order.
 */
export const TAB_ORDER: ChannelType[] = CHANNEL_CATEGORIES.flatMap(cat => cat.types);

/**
 * Resolves the parent category for a given specific ChannelType.
 */
export function getCategoryForType(type: ChannelType): ChannelCategory | undefined {
  return CHANNEL_CATEGORIES.find(cat => cat.types.includes(type));
}

/**
 * Counts how many selected fixtures have channels falling under each category.
 */
export function getAvailableCategories(fixtures: Fixture[]): Record<ChannelCategoryKey | 'total', number> {
  const counts = { total: fixtures.length } as Record<ChannelCategoryKey | 'total', number>;
  for (const cat of CHANNEL_CATEGORIES) {
    counts[cat.id] = 0;
  }

  if (fixtures.length === 0) return counts;

  for (const f of fixtures) {
    for (const cat of CHANNEL_CATEGORIES) {
      const hasCategory = f.channels.some(c => {
        // Also support generic role matches across generic channels
        if (cat.id === 'intensity' && c.role === 'DIMMER') return true;
        if (cat.id === 'color' && c.role === 'COLOR') return true;
        return cat.types.includes(c.type);
      });
      if (hasCategory) {
        counts[cat.id] = (counts[cat.id] ?? 0) + 1;
      }
    }
  }

  return counts;
}

/**
 * Specific visual icons mapped per ChannelType for rendering in the channel list grid.
 */
export const CHANNEL_TYPE_ICONS: Partial<Record<ChannelType, Component>> = {
  COLOR_WHEEL: Disc3,
  DIMMER: Sun,
  STROBE: Zap,
  PAN: Move,
  TILT: Move,
  PANTILT_SPEED: Gauge,
  GOBO_WHEEL: Star,
  GOBO_SPIN: Orbit,
  PRISM: Hexagon,
  PRISM_ROTATION: Orbit,
  BLADE: Scissors,
  FOG: Wind,
  FROST: Wind,
  ZOOM: ZoomIn,
  FOCUS: Focus,
  IRIS: Aperture,
  SPEED: Gauge,
  COLOR_TEMPERATURE: Thermometer,
  NO_FUNCTION: MinusCircle,
  GENERIC: SlidersHorizontal,
  CUSTOM: SlidersHorizontal,
};

/**
 * Resolves the visual icon for a channel, falling back to its category icon or a generic symbol.
 */
export function getIconForChannel(type: ChannelType, role: string): Component {
  if (CHANNEL_TYPE_ICONS[type]) return CHANNEL_TYPE_ICONS[type]!;

  if (role === 'NONE') return getCategoryForType(type)?.icon ?? SlidersHorizontal;

  return getCategoryForType(type)?.icon ?? Aperture;
}
