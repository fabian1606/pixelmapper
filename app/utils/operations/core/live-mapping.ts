/**
 * Live widget mappings for the `live.*` operations (ADR 0002 §4.2).
 *
 * Agents use a friendly mapping shape (`{ type: 'effect-param', modifierId,
 * paramKey }`) that is translated to the stored `LiveMapping`
 * (`{ type: 'effect-param', effectId, paramKey: 'params.<key>' }`) and back.
 * `mappingFindings` checks a stored mapping against the project state
 * (modifier / param / fixture / group / page exist) and against what the
 * widget type can actually drive at runtime (`apply-mapping.ts`).
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import { getManifest } from '~/utils/plugins/plugin-store';
import {
  defaultBlindConfig,
  defaultSpeedConfig,
  defaultStrobeConfig,
  type CoreLiveWidgetType,
  type GlobalFunctionConfig,
  type GlobalFunctionType,
  type LiveMapping,
} from '~/utils/live/types';
import type { CoreReadApi } from '../read-api';
import { FixtureIdSchema } from './shared';

// ── Widget types ────────────────────────────────

/** Core widget types an agent can add (controller twins are added per controller in the UI). */
export const LIVE_WIDGET_TYPES = ['button', 'slider', 'xy', 'color', 'label', 'beat', 'fixture-preview'] as const;

/** Widget type schema. */
export const LiveWidgetTypeSchema = z.enum(LIVE_WIDGET_TYPES).describe([
  'Widget type: "button" (momentary/toggle pad; presets, global functions, page switch, channel, dimmer group),',
  '"slider" (vertical fader, value 0–1; channel, dimmer-group, effect-param),',
  '"button" also drives effect-param on a plugin "trigger" param (press / release / multi-click),',
  '"xy" (2D pad; only a "channel" mapping: x drives channelOffset, y drives channelOffset + 1),',
  '"color" (color picker), "label" (text), "beat" (BPM/tap display), "fixture-preview" (live 2D view). The last four ignore mappings.',
].join(' '));

/** Mapping types each widget type drives at runtime (others are stored but have no effect). */
const SUPPORTED_MAPPINGS: Record<CoreLiveWidgetType, readonly LiveMapping['type'][]> = {
  // effect-param on buttons only drives `trigger` params (checked in `effectParamFindings`).
  'button': ['none', 'preset', 'channel', 'dimmer-group', 'global-function', 'page-switch', 'position-recall', 'effect-param'],
  'slider': ['none', 'channel', 'dimmer-group', 'effect-param'],
  'xy': ['none', 'channel'],
  'color': ['none'],
  'label': ['none'],
  'beat': ['none'],
  'fixture-preview': ['none'],
  'controller-twin': ['none'],
};

// ── Effect params ───────────────────────────────

/** Modifier-level keys every modifier offers (0–1 control → strength / speed / spread). */
export const BUILTIN_EFFECT_PARAMS = ['strength', 'speed', 'fanning'] as const;

/** Plugin param types a control can drive (`trigger`: press / release from a button, ABI 1.3). */
const MAPPABLE_PARAM_TYPES = new Set(['number', 'int', 'bool', 'trigger']);

/**
 * Normalizes an agent param key to the stored form: built-in keys stay
 * (`speed`), plugin params get the `params.` prefix (`count` → `params.count`).
 */
export function normalizeParamKey(key: string): string {
  if ((BUILTIN_EFFECT_PARAMS as readonly string[]).includes(key)) return key;
  if (key.startsWith('params.')) return key;
  if (key.startsWith('waveformParams.')) return `params.${key.slice('waveformParams.'.length)}`;
  return `params.${key}`;
}

// ── Friendly mapping schema ─────────────────────

/** Fixture or group id. */
const TargetId = FixtureIdSchema;

/** Agent-facing mapping (discriminated by `type`). */
export const LiveMappingInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).describe('No action.'),
  z.object({
    type: z.literal('effect-param'),
    modifierId: z.string().describe('Id of the modifier (effect) instance, see modifiers.list.'),
    paramKey: z.string().describe([
      'Which value the control drives: "strength" (0–1), "speed" (cycle time 50 ms–5 s),',
      '"fanning" (spread length, 0–1 of the world width), or a numeric/int/bool plugin param key of the modifier',
      '(e.g. "count" or "params.count"; the 0–1 control maps onto the param\'s min–max, bools switch at 0.5).',
      'Use "params.speed" for a plugin param literally named "speed".',
      'A "trigger" param (momentary: hold / release / multi-click) is driven by a button widget: press and release go to the effect.',
    ].join(' ')),
  }).describe('Drive a modifier parameter: a slider for number/int/bool params (value 0–1), a button for a trigger param.'),
  z.object({
    type: z.literal('channel'),
    fixtureId: TargetId.optional().describe('Single fixture target (with channelOffset).'),
    channelOffset: z.number().int().min(0).optional().describe('0-based channel index within the fixture.'),
    groupId: TargetId.optional().describe('Group target (with channelType): all channels of that type in the group.'),
    channelType: z.string().optional().describe('Channel type for group targets, e.g. "DIMMER", "WHITE".'),
  }).describe('Write a raw DMX channel (0–255; sliders scale 0–1, buttons send 255 while pressed).'),
  z.object({
    type: z.literal('dimmer-group'),
    groupId: TargetId.optional().describe('Group whose fixtures are dimmed.'),
    fixtureId: TargetId.optional().describe('Single fixture to dim (when no group).'),
  }).describe('Dim a group or fixture (DIMMER channels, or a virtual dimmer on color channels).'),
  z.object({
    type: z.literal('preset'),
    presetId: z.string().describe('Saved preset id.'),
  }).describe('Activate a preset (flash/overwrite presets act while held).'),
  z.object({
    type: z.literal('page-switch'),
    targetPageId: z.string().describe('Live page to switch to.'),
  }).describe('Switch to another live page.'),
  z.object({
    type: z.literal('global-function'),
    function: z.enum(['strobe', 'blind', 'blackout', 'speed']).describe('Global function.'),
    config: z.record(z.string(), z.unknown()).optional().describe([
      'Optional config merged over the defaults: strobe { frequency: 8 (Hz), beatSync: false, beatDivision: 8 },',
      'blind { color: "#ffffff", dimmerCurve: false }, speed { multiplier: 2, behavior: "latch" | "hold" }.',
    ].join(' ')),
  }).describe('Global function while held (strobe, blind, blackout) or speed multiplier.'),
  z.object({
    type: z.literal('position-recall'),
    positionId: z.string().describe('Saved moving-head position id.'),
  }).describe('Recall a saved moving-head position.'),
]).describe('What the widget controls. Most common: { type: "effect-param", modifierId, paramKey: "speed" } on a slider.');

/** Agent-facing mapping type. */
export type LiveMappingInput = z.infer<typeof LiveMappingInputSchema>;

/** Default config of a global function. */
function defaultGlobalConfig(fn: GlobalFunctionType): GlobalFunctionConfig {
  if (fn === 'strobe') return defaultStrobeConfig();
  if (fn === 'blind') return defaultBlindConfig();
  if (fn === 'speed') return defaultSpeedConfig();
  return {};
}

/** Stored id of a fixture (string vs. numeric legacy ids); falls back to the raw id. */
function resolveFixtureId(read: CoreReadApi, id: string | number): string | number {
  return read.fixtures().find(f => String(f.id) === String(id))?.id ?? id;
}

/** Stored id of a group; falls back to the raw id. */
function resolveGroupId(read: CoreReadApi, id: string | number): string | number {
  return read.groups().find(g => String(g.id) === String(id))?.id ?? id;
}

/** Translates the friendly mapping into the stored `LiveMapping`. */
export function toLiveMapping(read: CoreReadApi, input: LiveMappingInput): LiveMapping {
  switch (input.type) {
    case 'none':
      return { type: 'none' };
    case 'effect-param':
      return { type: 'effect-param', effectId: input.modifierId, paramKey: normalizeParamKey(input.paramKey) };
    case 'channel': {
      const out: LiveMapping = { type: 'channel' };
      if (input.groupId !== undefined) out.groupId = resolveGroupId(read, input.groupId);
      if (input.channelType !== undefined) out.channelType = input.channelType;
      if (input.fixtureId !== undefined) out.fixtureId = resolveFixtureId(read, input.fixtureId);
      if (input.channelOffset !== undefined) out.channelOffset = input.channelOffset;
      return out;
    }
    case 'dimmer-group': {
      const out: LiveMapping = { type: 'dimmer-group' };
      if (input.groupId !== undefined) out.groupId = resolveGroupId(read, input.groupId);
      if (input.fixtureId !== undefined) out.fixtureId = resolveFixtureId(read, input.fixtureId);
      return out;
    }
    case 'preset':
      return { type: 'preset', presetId: input.presetId };
    case 'page-switch':
      return { type: 'page-switch', targetPageId: input.targetPageId };
    case 'global-function':
      return {
        type: 'global-function',
        globalFunction: input.function,
        globalFunctionConfig: { ...defaultGlobalConfig(input.function), ...(input.config ?? {}) } as GlobalFunctionConfig,
      };
    case 'position-recall':
      return { type: 'position-recall', positionId: input.positionId };
  }
}

/** Translates a stored mapping back into the friendly shape (`live.listPages`). */
export function fromLiveMapping(m: LiveMapping): Record<string, unknown> {
  switch (m.type) {
    case 'effect-param':
      return { type: m.type, modifierId: m.effectId, paramKey: m.paramKey };
    case 'global-function':
      return { type: m.type, function: m.globalFunction, config: m.globalFunctionConfig };
    default: {
      // Drop undefined fields; everything else already matches the input shape.
      return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
    }
  }
}

/** One-line human/AI summary of a stored mapping. */
export function mappingSummary(m: LiveMapping): string {
  switch (m.type) {
    case 'effect-param': return `effect-param: modifier ${m.effectId ?? '?'} → ${m.paramKey ?? '?'}`;
    case 'channel': return m.groupId !== undefined
      ? `channel: group ${m.groupId} ${m.channelType ?? '?'}`
      : `channel: fixture ${m.fixtureId ?? '?'} #${m.channelOffset ?? '?'}`;
    case 'dimmer-group': return `dimmer-group: ${m.groupId !== undefined ? `group ${m.groupId}` : `fixture ${m.fixtureId ?? '?'}`}`;
    case 'preset': return `preset: ${m.presetId ?? '?'}`;
    case 'page-switch': return `page-switch: ${m.targetPageId ?? '?'}`;
    case 'global-function': return `global-function: ${m.globalFunction ?? '?'}`;
    case 'position-recall': return `position-recall: ${m.positionId ?? '?'}`;
    default: return 'none';
  }
}

// ── Validation ──────────────────────────────────

/** Error finding about a widget's mapping. */
function mappingError(code: string, message: string, widgetId: string): Finding {
  return { level: 'error', code, message, entityIds: [`liveWidget:${widgetId}`] };
}

/**
 * Checks an `effect-param` mapping: modifier exists, param key exists and is
 * mappable. On a button only `trigger` params react (press / release), so
 * any other target is a warning there.
 */
function effectParamFindings(read: CoreReadApi, m: LiveMapping, widgetId: string, widgetType: string): Finding[] {
  if (!m.effectId || !m.paramKey) return [mappingError('mapping-incomplete', 'effect-param mapping needs modifierId and paramKey', widgetId)];
  const modifier = read.modifier(m.effectId);
  if (!modifier) {
    return [mappingError('modifier-not-found', `modifier "${m.effectId}" not found (use modifiers.list to list ids)`, widgetId)];
  }
  const buttonIgnores = (what: string): Finding[] => [{
    level: 'warning',
    code: 'mapping-ignored-by-widget',
    message: `a button only drives effect-param mappings on trigger params; ${what} needs a slider`,
    entityIds: [`liveWidget:${widgetId}`],
  }];
  if ((BUILTIN_EFFECT_PARAMS as readonly string[]).includes(m.paramKey)) return widgetType === 'button' ? buttonIgnores(`"${m.paramKey}"`) : [];
  const key = m.paramKey.slice(m.paramKey.indexOf('.') + 1);
  const manifestParam = getManifest(modifier.plugin)?.params.find(p => p.key === key);
  const available = [...BUILTIN_EFFECT_PARAMS, ...Object.keys(modifier.params)].join(', ');
  if (!(key in modifier.params) && !manifestParam) {
    return [mappingError('param-not-found', `modifier "${m.effectId}" has no param "${key}" (available: ${available})`, widgetId)];
  }
  if (manifestParam && !MAPPABLE_PARAM_TYPES.has(manifestParam.type)) {
    return [mappingError('param-not-mappable', `param "${key}" is of type ${manifestParam.type}; only number, int, bool and trigger params can be driven by a control`, widgetId)];
  }
  if (widgetType === 'button' && manifestParam?.type !== 'trigger') return buttonIgnores(`"${key}"`);
  if (!manifestParam && typeof modifier.params[key] !== 'number' && typeof modifier.params[key] !== 'boolean') {
    return [mappingError('param-not-mappable', `param "${key}" is not numeric or boolean; only number, int and bool params can be driven by a control`, widgetId)];
  }
  return [];
}

/** Checks a fixture/group target (channel and dimmer-group mappings). */
function targetFindings(read: CoreReadApi, m: LiveMapping, widgetId: string): Finding[] {
  if (m.groupId !== undefined) {
    if (!read.groups().some(g => String(g.id) === String(m.groupId))) {
      return [mappingError('group-not-found', `group "${String(m.groupId)}" not found`, widgetId)];
    }
    if (m.type === 'channel' && !m.channelType) return [mappingError('mapping-incomplete', 'channel mapping on a group needs channelType', widgetId)];
    return [];
  }
  if (m.fixtureId !== undefined) {
    const f = read.fixture(m.fixtureId);
    if (!f) return [mappingError('fixture-not-found', `fixture "${String(m.fixtureId)}" not found (use fixtures.find to list ids)`, widgetId)];
    if (m.type === 'channel') {
      if (m.channelOffset === undefined) return [mappingError('mapping-incomplete', 'channel mapping on a fixture needs channelOffset', widgetId)];
      if (m.channelOffset >= f.channelCount) {
        return [mappingError('channel-out-of-range', `fixture "${String(m.fixtureId)}" has ${f.channelCount} channels; channelOffset ${m.channelOffset} is out of range`, widgetId)];
      }
    }
    return [];
  }
  return [mappingError('mapping-incomplete', `${m.type} mapping needs a fixtureId or groupId`, widgetId)];
}

/**
 * Postcondition findings for a widget's stored mapping: referenced entities
 * exist (errors) and the widget type drives the mapping at runtime (warning).
 * Presets and saved positions are not part of the read API and not checked.
 */
export function mappingFindings(read: CoreReadApi, widgetType: string, m: LiveMapping, widgetId: string): Finding[] {
  const out: Finding[] = [];
  if (m.type === 'effect-param') out.push(...effectParamFindings(read, m, widgetId, widgetType));
  else if (m.type === 'channel' || m.type === 'dimmer-group') out.push(...targetFindings(read, m, widgetId));
  else if (m.type === 'page-switch' && !read.livePages().some(p => p.id === m.targetPageId)) {
    out.push(mappingError('page-not-found', `live page "${m.targetPageId ?? ''}" not found (use live.listPages)`, widgetId));
  }
  const supported = SUPPORTED_MAPPINGS[widgetType as CoreLiveWidgetType];
  if (supported && !supported.includes(m.type)) {
    out.push({
      level: 'warning',
      code: 'mapping-ignored-by-widget',
      message: `a ${widgetType} widget does not drive "${m.type}" mappings at runtime (supported: ${supported.join(', ')})`,
      entityIds: [`liveWidget:${widgetId}`],
    });
  }
  return out;
}
