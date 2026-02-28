/**
 * Single source of truth for channel category definitions.
 *
 * Each ChannelType is assigned:
 *   - `tab`   — which sidebar tab it appears in
 *   - `icon`  — Lucide icon shown in the property-control box
 *   - `label` — optional label override (falls back to oflChannelName)
 *
 * OFL capability types that map to each entry are noted in comments.
 * To add a new ChannelType or change its icon/tab, edit CHANNEL_CATEGORY_MAP.
 */

import type { Component } from 'vue';
import {
  Lightbulb,       // Intensity / Dimmer
  Palette,         // Generic colour (Red, Green, Blue, Amber, UV …)
  Disc3,           // Colour wheel  (WheelSlot on a colour wheel)
  MoveHorizontal,  // Pan
  MoveVertical,    // Tilt
  Zap,             // Shutter / Strobe
  Thermometer,     // White-balance channels
  Aperture,        // Fallback / unknown
} from 'lucide-vue-next';
import type { ChannelType } from './types';

// ─── Tab identifiers ─────────────────────────────────────────────────────────

export type SidebarTab = 'intensity' | 'color' | 'position' | 'beam';

// ─── Config entry ─────────────────────────────────────────────────────────────

export interface ChannelCategoryConfig {
  /** Sidebar tab this channel belongs to */
  tab: SidebarTab;
  /** Lucide icon displayed in the property-control box */
  icon: Component;
  /** Optional human-readable label override (falls back to oflChannelName) */
  label?: string;
}

// ─── Map — edit here to change tabs / icons ───────────────────────────────────

export const CHANNEL_CATEGORY_MAP = {

  // ── Intensity ──────────────────────────────────────────────────────────────
  // OFL: Intensity
  DIMMER:      { tab: 'intensity', icon: Lightbulb,      label: 'Dimmer'       },

  // ── Color — primaries & secondaries ────────────────────────────────────────
  // OFL: ColorIntensity (color: Red / Green / Blue / Amber / UV)
  RED:         { tab: 'color',     icon: Palette                               },
  GREEN:       { tab: 'color',     icon: Palette                               },
  BLUE:        { tab: 'color',     icon: Palette                               },
  AMBER:       { tab: 'color',     icon: Palette                               },
  UV:          { tab: 'color',     icon: Palette                               },

  // ── Color — white-balance ──────────────────────────────────────────────────
  // OFL: ColorIntensity (color: White / Warm White / Cold White)
  WHITE:       { tab: 'color',     icon: Thermometer                           },
  WARM_WHITE:  { tab: 'color',     icon: Thermometer                           },
  COOL_WHITE:  { tab: 'color',     icon: Thermometer                           },

  // ── Color — colour wheel ───────────────────────────────────────────────────
  // OFL: WheelSlot on a wheel whose name contains "color"
  COLOR_WHEEL: { tab: 'color',     icon: Disc3,          label: 'Color Wheel'  },

  // ── Color — generic ────────────────────────────────────────────────────────
  // OFL: ColorIntensity colours not in the list above (e.g. Cyan, Magenta, Yellow)
  CUSTOM:      { tab: 'color',     icon: Palette                               },

  // ── Position ───────────────────────────────────────────────────────────────
  // OFL: Pan / PanContinuous / Tilt / TiltContinuous
  PAN:         { tab: 'position',  icon: MoveHorizontal, label: 'Pan'          },
  TILT:        { tab: 'position',  icon: MoveVertical,   label: 'Tilt'         },

  // ── Beam / Shutter ─────────────────────────────────────────────────────────
  // OFL: ShutterStrobe
  STROBE:      { tab: 'beam',      icon: Zap,            label: 'Shutter'      },

} as const satisfies Partial<Record<ChannelType, ChannelCategoryConfig>>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _map = CHANNEL_CATEGORY_MAP as Partial<Record<ChannelType, ChannelCategoryConfig>>;

/** All ChannelTypes belonging to a given tab, in insertion order. */
export function getTypesForTab(tab: SidebarTab): ChannelType[] {
  return (Object.entries(CHANNEL_CATEGORY_MAP) as [ChannelType, ChannelCategoryConfig][])
    .filter(([, cfg]) => cfg.tab === tab)
    .map(([type]) => type);
}

/** True when the ChannelType belongs to the given tab. */
export function channelBelongsToTab(type: ChannelType, tab: SidebarTab): boolean {
  return _map[type]?.tab === tab;
}

/** Icon component for a ChannelType; falls back to Aperture. */
export function getIconForType(type: ChannelType): Component {
  return _map[type]?.icon ?? Aperture;
}

/** Label override for a ChannelType (undefined → use oflChannelName). */
export function getLabelForType(type: ChannelType): string | undefined {
  return _map[type]?.label;
}
