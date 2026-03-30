/**
 * Channel, mode, and wheel draft schemas for the custom fixture editor (step 2).
 * These types mirror the OFL channel/mode structure and are used to build
 * the fixture definition before it gets saved.
 */

import { z } from 'zod';
import type { ChannelType } from '~/utils/engine/types';
import { CapabilityRangeSchema } from './custom-fixture-capability-schemas';

// ─── Channel capability metadata (UI labels, colors, groups) ─────────────────

/** UI metadata for each ChannelType: display label, color dot, group heading. */
export const CHANNEL_CAPABILITY_META: Record<ChannelType, { label: string; color: string; group: string }> = {
  RED:              { label: 'Red',             color: '#ef4444', group: 'Color' },
  GREEN:            { label: 'Green',           color: '#22c55e', group: 'Color' },
  BLUE:             { label: 'Blue',            color: '#3b82f6', group: 'Color' },
  WHITE:            { label: 'White',           color: '#f1f5f9', group: 'Color' },
  WARM_WHITE:       { label: 'Warm White',      color: '#fde68a', group: 'Color' },
  COOL_WHITE:       { label: 'Cool White',      color: '#bfdbfe', group: 'Color' },
  AMBER:            { label: 'Amber',           color: '#f59e0b', group: 'Color' },
  UV:               { label: 'UV',              color: '#a855f7', group: 'Color' },
  CYAN:             { label: 'Cyan',            color: '#06b6d4', group: 'Color' },
  MAGENTA:          { label: 'Magenta',         color: '#d946ef', group: 'Color' },
  YELLOW:           { label: 'Yellow',          color: '#eab308', group: 'Color' },
  LIME:             { label: 'Lime',            color: '#84cc16', group: 'Color' },
  INDIGO:           { label: 'Indigo',          color: '#6366f1', group: 'Color' },
  COLOR_WHEEL:      { label: 'Color Wheel',     color: '#e2e8f0', group: 'Color' },
  COLOR_PRESET:     { label: 'Color Macro',     color: '#e2e8f0', group: 'Color' },
  COLOR_TEMPERATURE:{ label: 'Color Temp',      color: '#fde68a', group: 'Color' },
  DIMMER:           { label: 'Dimmer',          color: '#94a3b8', group: 'Intensity' },
  PAN:              { label: 'Pan',             color: '#64748b', group: 'Position' },
  TILT:             { label: 'Tilt',            color: '#64748b', group: 'Position' },
  PAN_CONTINUOUS:   { label: 'Pan Continuous',   color: '#64748b', group: 'Position' },
  TILT_CONTINUOUS:  { label: 'Tilt Continuous',  color: '#64748b', group: 'Position' },
  PANTILT_SPEED:    { label: 'P/T Speed',       color: '#64748b', group: 'Position' },
  STROBE:           { label: 'Strobe',          color: '#fbbf24', group: 'Beam' },
  STROBE_SPEED:     { label: 'Strobe Speed',    color: '#fbbf24', group: 'Beam' },
  STROBE_DURATION:  { label: 'Strobe Duration', color: '#fbbf24', group: 'Beam' },
  ZOOM:             { label: 'Zoom',            color: '#94a3b8', group: 'Beam' },
  FOCUS:            { label: 'Focus',           color: '#94a3b8', group: 'Beam' },
  IRIS:             { label: 'Iris',            color: '#94a3b8', group: 'Beam' },
  IRIS_EFFECT:      { label: 'Iris Effect',      color: '#94a3b8', group: 'Beam' },
  FROST:            { label: 'Frost',           color: '#e0f2fe', group: 'Beam' },
  FROST_EFFECT:     { label: 'Frost Effect',     color: '#e0f2fe', group: 'Beam' },
  BEAM_ANGLE:       { label: 'Beam Angle',      color: '#94a3b8', group: 'Beam' },
  BEAM_POSITION:    { label: 'Beam Position',   color: '#94a3b8', group: 'Beam' },
  GOBO_WHEEL:       { label: 'Gobo Wheel',      color: '#78716c', group: 'Gobo' },
  GOBO_SPIN:        { label: 'Gobo Spin',       color: '#78716c', group: 'Gobo' },
  PRISM:            { label: 'Prism',           color: '#a78bfa', group: 'Gobo' },
  PRISM_ROTATION:   { label: 'Prism Rotation',  color: '#a78bfa', group: 'Gobo' },
  BLADE:            { label: 'Blade',           color: '#78716c', group: 'Gobo' },
  BLADE_ROTATION:        { label: 'Blade Rotation',        color: '#78716c', group: 'Gobo' },
  BLADE_SYSTEM_ROTATION: { label: 'Blade System Rotation', color: '#78716c', group: 'Gobo' },
  EFFECT:           { label: 'Effect',          color: '#8b5cf6', group: 'Effects' },
  EFFECT_SPEED:     { label: 'Effect Speed',    color: '#8b5cf6', group: 'Effects' },
  EFFECT_DURATION:  { label: 'Effect Duration', color: '#8b5cf6', group: 'Effects' },
  EFFECT_PARAMETER: { label: 'Effect Parameter', color: '#8b5cf6', group: 'Effects' },
  SOUND_SENSITIVITY:{ label: 'Sound',           color: '#8b5cf6', group: 'Effects' },
  ROTATION:         { label: 'Rotation',        color: '#64748b', group: 'Effects' },
  SPEED:            { label: 'Speed',           color: '#64748b', group: 'Effects' },
  TIME:             { label: 'Time',            color: '#64748b', group: 'Effects' },
  FOG:              { label: 'Fog',             color: '#e2e8f0', group: 'Other' },
  FOG_OUTPUT:       { label: 'Fog Output',       color: '#e2e8f0', group: 'Other' },
  FOG_TYPE:         { label: 'Fog Type',         color: '#e2e8f0', group: 'Other' },
  MAINTENANCE:      { label: 'Maintenance',     color: '#94a3b8', group: 'Other' },
  NO_FUNCTION:      { label: 'No Function',     color: '#475569', group: 'Other' },
  GENERIC:          { label: 'Generic',         color: '#64748b', group: 'Other' },
  CUSTOM:           { label: 'Custom',          color: '#64748b', group: 'Other' },
};

export type { ChannelType } from '~/utils/engine/types';

export const CHANNEL_CAPABILITY_TYPES = Object.keys(CHANNEL_CAPABILITY_META) as ChannelType[];

/** Channel types that imply a physical wheel with named slots. */
export const WHEEL_CAPABILITY_TYPES = new Set<ChannelType>([
  'COLOR_WHEEL', 'GOBO_WHEEL', 'PRISM',
]);

export const WHEEL_RANGE_TYPES = Array.from(WHEEL_CAPABILITY_TYPES);

// ─── Wheel definitions ────────────────────────────────────────────────────────

/** A single slot on a physical wheel. */
export const WheelSlotDraftSchema = z.object({
  slotId:  z.string().describe('Internal UUID'),
  type:    z.enum(['Open', 'Color', 'Gobo', 'Prism', 'Frost', 'Iris']).default('Color')
             .describe('What the slot contains'),
  name:    z.string().default('').describe('Descriptive name shown in UI (e.g. "Red", "Hypnotic")'),
  colors:  z.array(z.string()).default([])
             .describe('Hex color codes. One for solid, two for split-color slots.'),
});
export type WheelSlotDraft = z.infer<typeof WheelSlotDraftSchema>;

/** A physical wheel belonging to a channel. Maps to the OFL `wheels` top-level object. */
export const WheelDraftSchema = z.object({
  wheelId:   z.string().describe('Internal UUID'),
  channelId: z.string().describe('The ChannelDraft.id that controls this wheel'),
  name:      z.string().describe('Wheel name as used in OFL (e.g. "Color Wheel", "Gobo Wheel 1")'),
  direction: z.enum(['CW', 'CCW']).optional()
               .describe('Default rotation direction of the wheel'),
  slots:     z.array(WheelSlotDraftSchema).default([])
               .describe('Ordered list of slots. Slot 1 is typically Open.'),
});
export type WheelDraft = z.infer<typeof WheelDraftSchema>;

// ─── Channel draft ────────────────────────────────────────────────────────────

export const ChannelDraftSchema = z.object({
  id:             z.string().describe('Internal UUID'),
  name:           z.string().min(1).describe('Channel name as shown in the fixture (e.g. "Red", "Dimmer", "Pan")'),
  capabilityType: z.enum(CHANNEL_CAPABILITY_TYPES as [ChannelType, ...ChannelType[]])
                    .describe('Primary function of this DMX channel — used for engine routing and grouping. When capability ranges are defined this reflects the dominant capability type.'),
  resolution:     z.enum(['8bit', '16bit']).default('8bit')
                    .describe('8bit = 1 DMX address; 16bit = 2 addresses (coarse + fine)'),
  defaultValue:   z.number().int().min(0).max(255).default(0)
                    .describe('Default DMX value when the fixture is reset (0–255)'),
  capabilities:   z.array(CapabilityRangeSchema).default([])
                    .describe('Optional sub-ranges mapping portions of the DMX range to specific capabilities. Empty = the full 0–255 range has one capability (capabilityType).'),
});
export type ChannelDraft = z.infer<typeof ChannelDraftSchema>;

// ─── Mode draft ───────────────────────────────────────────────────────────────

/**
 * A channel slot in a mode.
 * - perHead: false (default) → appears once in the DMX map
 * - perHead: true → part of a per-head group; consecutive perHead entries
 *   form one group.
 */
export const ModeEntrySchema = z.object({
  entryId:   z.string().describe('Unique ID for this slot instance'),
  channelId: z.string().describe('References a ChannelDraft.id'),
  perHead:   z.boolean().default(false)
               .describe('Repeated once per head/pixel; head count comes from the fixture config'),
  order:     z.enum(['perPixel', 'perChannel']).default('perPixel')
               .describe('perPixel: R₁G₁B₁ R₂G₂B₂ … | perChannel: R₁R₂… G₁G₂… B₁B₂…'),
});
export type ModeEntry = z.infer<typeof ModeEntrySchema>;

export const ModeDraftSchema = z.object({
  id:      z.string(),
  name:    z.string().min(1).describe('Mode name (e.g. "3-channel", "Full 16ch")'),
  entries: z.array(ModeEntrySchema).describe('Ordered channel entries for this mode'),
});
export type ModeDraft = z.infer<typeof ModeDraftSchema>;

/** Total DMX address count for a mode. headCount = number of heads from fixture config. */
export function modeAddressCount(mode: ModeDraft, channels: ChannelDraft[], headCount = 1): number {
  let n = 0;
  const addrPerCh = (id: string) => channels.find(c => c.id === id)?.resolution === '16bit' ? 2 : 1;
  let i = 0;
  while (i < mode.entries.length) {
    const e = mode.entries[i]!;
    if (!e.perHead) {
      n += addrPerCh(e.channelId);
      i++;
    } else {
      let groupAddr = 0;
      while (i < mode.entries.length && mode.entries[i]!.perHead) {
        groupAddr += addrPerCh(mode.entries[i]!.channelId);
        i++;
      }
      n += groupAddr * headCount;
    }
  }
  return n;
}
