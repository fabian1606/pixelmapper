/**
 * Content-plugin manifest validation (ADR §6.2). Lightweight subpath export
 * (`@pixelmapper/plugin-toolchain/manifest`).
 */
import semver from 'semver';
import type { ParamDef } from '@pixelmapper/extension-api';
import type { ContentPluginManifest } from './types';
import { validateCurveParam } from './manifest-curve';
import { validateManifestUx } from './manifest-ux';
import { validateCanvasRefs, validateParamUi } from './manifest-canvas';
import { checkGradient, checkSteps } from './param-structs';

/** Plugin ABI/SDK version this toolchain produces. */
export const PLUGIN_API_VERSION = '1.2.0';

const SIGNATURES = ['scalar', 'rgb', 'panTilt'];
const KINDS = ['modifier', 'shader', 'visual'];
const OUTPUTS = ['bipolar', 'absolute', 'scale'];
const PARAM_TYPES = ['number', 'int', 'bool', 'enum', 'color', 'angle', 'point', 'curve', 'gradient', 'steps'];
const UI_INPUTS = ['pm.fader', 'pm.numberInput', 'pm.colorInput', 'pm.xyInput', 'pm.select', 'pm.toggle', 'pm.curve', 'pm.angle', 'pm.tapTempo', 'pm.button', 'pm.gradient', 'pm.steps'];
const ALIAS_RE = /^@[a-z0-9-]+\/[a-z0-9-]+$/;
const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

/** Result of a validation. */
export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  /** Non-fatal findings (e.g. curve shapes only known to extensions). */
  warnings: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUnit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;

/** Validates one param definition; pushes readable errors and warnings. */
function validateParam(p: ParamDef, i: number, errors: string[], warnings: string[]): void {
  const where = `params[${i}] "${String((p as { key?: unknown }).key)}"`;
  if (typeof p.key !== 'string' || !KEY_RE.test(p.key)) errors.push(`${where}: key must be camelCase`);
  if (!PARAM_TYPES.includes(p.type)) {
    errors.push(`${where}: unknown type "${String(p.type)}"`);
    return;
  }
  if (typeof p.label !== 'string' || !p.label) errors.push(`${where}: label is required`);
  // `ui`: input name or object form with a canvas hint (manifest-canvas.ts).
  validateParamUi(p, where, UI_INPUTS, errors);

  switch (p.type) {
    case 'number':
    case 'int':
      if (!isNum(p.min) || !isNum(p.max) || p.min >= p.max) errors.push(`${where}: needs numeric min < max`);
      else if (!isNum(p.default) || p.default < p.min || p.default > p.max) errors.push(`${where}: default must lie in [min, max]`);
      if (p.type === 'int' && isNum(p.default) && !Number.isInteger(p.default)) errors.push(`${where}: int default must be an integer`);
      break;
    case 'bool':
      if (typeof p.default !== 'boolean') errors.push(`${where}: default must be boolean`);
      break;
    case 'enum':
      if (!Array.isArray(p.options) || p.options.length === 0) errors.push(`${where}: options must be a non-empty array`);
      else if (!p.options.includes(p.default)) errors.push(`${where}: default must be one of the options`);
      if (p.optionLabels && p.optionLabels.length !== p.options?.length) errors.push(`${where}: optionLabels must match options`);
      for (const o of Object.keys(p.optionDistribution ?? {})) if (!p.options?.includes(o)) errors.push(`${where}: optionDistribution names unknown option "${o}"`);
      break;
    case 'color':
      if (!p.default || !isUnit(p.default.r) || !isUnit(p.default.g) || !isUnit(p.default.b)) errors.push(`${where}: default must be { r, g, b } in 0–1`);
      break;
    case 'angle':
      if (!isNum(p.default)) errors.push(`${where}: default must be a number (radians)`);
      break;
    case 'point':
      if (!p.default || !isUnit(p.default.x) || !isUnit(p.default.y)) errors.push(`${where}: default must be { x, y } in 0–1`);
      break;
    case 'curve':
      validateCurveParam(p, where, errors, warnings);
      break;
    case 'gradient': {
      const msg = checkGradient(p.default);
      if (msg) errors.push(`${where}: default ${msg}`);
      break;
    }
    case 'steps': {
      const msg = checkSteps(p.default);
      if (msg) errors.push(`${where}: default ${msg}`);
      break;
    }
  }
}

/** Validates a manifest (structure and values). */
export function validateManifest(json: unknown): ManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const m = json as Partial<ContentPluginManifest> | null;
  if (!m || typeof m !== 'object') return { ok: false, errors: ['manifest must be an object'], warnings };

  if (m.schema !== 1) errors.push('schema must be 1');
  if (!KINDS.includes(String(m.kind))) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  else if (m.kind !== 'modifier') errors.push(`kind "${m.kind}" is reserved and not implemented yet`);
  if (typeof m.alias !== 'string' || !ALIAS_RE.test(m.alias)) errors.push('alias must look like "@scope/name" (kebab-case)');
  if (typeof m.name !== 'string' || !m.name.trim()) errors.push('name is required');
  if (!semver.valid(m.version)) errors.push(`version "${String(m.version)}" is not valid semver`);
  if (!semver.validRange(m.apiVersion)) errors.push(`apiVersion "${String(m.apiVersion)}" is not a valid range`);
  else if (!semver.satisfies(PLUGIN_API_VERSION, m.apiVersion!)) errors.push(`apiVersion "${m.apiVersion}" is incompatible with plugin API ${PLUGIN_API_VERSION}`);
  if (typeof m.description !== 'string' || m.description.trim().length < 10) errors.push('description is required (≥ 10 characters, read by humans and AI)');
  if (!Array.isArray(m.signatures) || m.signatures.length === 0) errors.push('signatures must be a non-empty array');
  else for (const s of m.signatures) if (!SIGNATURES.includes(s)) errors.push(`unknown signature "${s}"`);
  if (!OUTPUTS.includes(String(m.output))) errors.push('output must be "bipolar", "absolute" or "scale"');

  if (!Array.isArray(m.params)) errors.push('params must be an array');
  else {
    const keys = new Set<string>();
    m.params.forEach((p, i) => {
      validateParam(p, i, errors, warnings);
      if (keys.has(p.key)) errors.push(`params[${i}]: duplicate key "${p.key}"`);
      keys.add(p.key);
    });
    validateCanvasRefs(m.params, errors, warnings);
  }

  validateManifestUx(m, errors);

  if (m.ui !== undefined) {
    if (!m.ui || typeof m.ui.panel !== 'string' || !m.ui.panel.endsWith('.ts')) errors.push('ui.panel must name a .ts file');
    if (m.ui?.placement && !['below-params', 'above-params', 'replace-params'].includes(m.ui.placement)) errors.push('ui.placement is invalid');
  }

  return { ok: errors.length === 0, errors, warnings };
}
