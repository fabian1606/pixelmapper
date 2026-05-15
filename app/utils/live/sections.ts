import type { LivePage, LiveSection, LiveWidget, SectionMember, SectionSource } from './types';
import type { Preset } from '~/utils/engine/preset-types';
import { getControllerDefinition } from '~/utils/controllers/catalog';
import { autoColorPalette, colorNameFor, getPresetNaturalRGB, type RGB } from '~/utils/live/color-utils';

export interface SectionResolveContext {
  savedPresets: Preset[];
  selectedPresetId: string | null;
  /** Number of section slots. Only used by 'auto-color-variants'. */
  slotCount?: number;
}

/** One resolved slot: which preset it binds to, plus an optional color override + label. */
export interface ResolvedSlot {
  preset: Preset;
  colorOverride?: RGB;
  /** When set, overrides the preset name as the button's displayed label. */
  label?: string;
}

/**
 * Resolve the dynamic list of slots a section is currently pointing at.
 * Returned order is the order section members will be assigned to.
 */
export function resolveSectionSource(source: SectionSource, ctx: SectionResolveContext): ResolvedSlot[] {
  switch (source) {
    case 'all-presets':
      // Top-level presets only — variants are surfaced via 'preset-variants'.
      return ctx.savedPresets.filter(p => !p.basePresetId).map(preset => ({ preset }));
    case 'preset-variants': {
      if (!ctx.selectedPresetId) return [];
      // Walk up to the root preset of the currently selected one so a variant
      // selector stays stable when the user picks one of its own variants.
      const byId = new Map(ctx.savedPresets.map(p => [p.id, p]));
      let rootId = ctx.selectedPresetId;
      let safety = 16;
      while (safety-- > 0) {
        const cur = byId.get(rootId);
        if (!cur?.basePresetId) break;
        rootId = cur.basePresetId;
      }
      const variants = ctx.savedPresets.filter(p => p.basePresetId === rootId);
      const root = byId.get(rootId);
      const list = root ? [root, ...variants] : variants;
      return list.map(preset => ({ preset }));
    }
    case 'auto-color-variants': {
      // N hue-rotated copies of the currently active preset (N = slot count).
      // Slot 0 = the preset's natural base colour; subsequent slots are evenly
      // hue-rotated from that base, preserving its saturation/value.
      const activeId = ctx.selectedPresetId;
      if (!activeId) return [];
      const active = ctx.savedPresets.find(p => p.id === activeId);
      if (!active) return [];
      const n = Math.max(0, ctx.slotCount ?? 0);
      const base = getPresetNaturalRGB(activeId, ctx.savedPresets);
      return autoColorPalette(n, base ?? undefined).map((colorOverride, i) => ({
        preset: active,
        colorOverride,
        label: i === 0 ? 'Default' : colorNameFor(colorOverride),
      }));
    }
  }
}

interface PositionedMember {
  member: SectionMember;
  y: number;
  x: number;
}

function memberPosition(member: SectionMember, page: LivePage): PositionedMember | null {
  const widget = page.widgets.find(w => w.id === member.widgetId);
  if (!widget) return null;

  if (!member.controlId) {
    return { member, y: widget.gridY, x: widget.gridX };
  }

  // Twin sub-control: compute its in-grid offset from the controller SVG rect
  // so multiple members within the same twin order by their visual position.
  const def = widget.controllerKey ? getControllerDefinition(widget.controllerKey) : null;
  const control = def?.controls.find(c => c.id === member.controlId);
  if (!def || !control) {
    return { member, y: widget.gridY, x: widget.gridX };
  }
  const dxCells = (control.rect.x / def.viewBox.w) * widget.gridW;
  const dyCells = (control.rect.y / def.viewBox.h) * widget.gridH;
  return { member, y: widget.gridY + dyCells, x: widget.gridX + dxCells };
}

/**
 * Return section members sorted by their effective canvas position
 * (row-major: top first, then left). Members whose widget no longer exists
 * are dropped silently — the source assignment skips them.
 *
 * Members within the same visual row (within ~0.5 grid cell vertical span)
 * are treated as one row so a slight Y-misalignment doesn't flip the order.
 */
export function orderedSectionMembers(section: LiveSection, page: LivePage): SectionMember[] {
  const positioned: PositionedMember[] = [];
  for (const m of section.members) {
    const p = memberPosition(m, page);
    if (p) positioned.push(p);
  }
  const ROW_TOLERANCE = 0.5;
  positioned.sort((a, b) => {
    if (Math.abs(a.y - b.y) > ROW_TOLERANCE) return a.y - b.y;
    return a.x - b.x;
  });
  return positioned.map(p => p.member);
}

export interface SectionMembership {
  section: LiveSection;
  index: number;
  total: number;
}

/**
 * Find which section a given widget (or twin sub-control) belongs to, plus its
 * index in the ordered member list. Returns null if not part of any section.
 */
export function findSectionFor(
  page: LivePage,
  widgetId: string,
  controlId?: string,
): SectionMembership | null {
  if (!page.sections) return null;
  for (const section of page.sections) {
    const ordered = orderedSectionMembers(section, page);
    const index = ordered.findIndex(m => m.widgetId === widgetId && m.controlId === controlId);
    if (index !== -1) {
      return { section, index, total: ordered.length };
    }
  }
  return null;
}

/**
 * Convenience: same as findSectionFor but matches a widget's index inside its
 * section. Returns null if no membership.
 */
export function memberKey(m: SectionMember): string {
  return m.controlId ? `${m.widgetId}::${m.controlId}` : m.widgetId;
}
