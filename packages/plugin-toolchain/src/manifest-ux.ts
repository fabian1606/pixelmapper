/**
 * Validation of the manifest UX fields (plan M5.1): `purpose`,
 * `distribution`, `editors`, `presets`, param `tier` and `when`.
 */
import type { ParamDef, ParamSchema } from '@pixelmapper/extension-api';
import type { ContentPluginManifest } from './types';
import { validateCurveValue } from './manifest-curve';

const MODES = ['none', 'linear', 'radial', 'conical', 'order'];
const SCOPES = ['across', 'within'];
const TIERS = ['primary', 'advanced', 'hidden'];
const KINDS = ['single', 'row', 'ring', 'area'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Checks that `v` is a valid value of `def`; returns an error message or null. */
export function checkParamValue(def: ParamDef, v: unknown): string | null {
  switch (def.type) {
    case 'number':
    case 'int':
      if (!isNum(v) || v < def.min || v > def.max) return `must be a number in [${def.min}, ${def.max}]`;
      if (def.type === 'int' && !Number.isInteger(v)) return 'must be an integer';
      return null;
    case 'bool': return typeof v === 'boolean' ? null : 'must be boolean';
    case 'enum': return def.options.includes(String(v)) && typeof v === 'string' ? null : `must be one of ${def.options.join(', ')}`;
    case 'angle': return isNum(v) ? null : 'must be a number (radians)';
    case 'color': return isObj(v) && isNum(v.r) && isNum(v.g) && isNum(v.b) ? null : 'must be { r, g, b }';
    case 'point': return isObj(v) && isNum(v.x) && isNum(v.y) ? null : 'must be { x, y }';
    case 'curve': {
      const errors: string[] = [];
      validateCurveValue(v, 'value', def.domain ?? 'cycle', errors, []);
      return errors[0] ?? null;
    }
    default: return null;
  }
}

/** Validates a `when` condition against the params. */
function checkWhen(when: unknown, keys: Set<string>, where: string, errors: string[]): void {
  if (when === undefined) return;
  if (!isObj(when)) {
    errors.push(`${where}: when must be an object`);
    return;
  }
  for (const k of Object.keys(when)) {
    if (k !== 'distribution.mode' && !keys.has(k)) errors.push(`${where}: when refers to unknown key "${k}"`);
  }
}

/** Validates the UX fields; pushes readable errors. */
export function validateManifestUx(m: Partial<ContentPluginManifest>, errors: string[]): void {
  const params: ParamSchema = Array.isArray(m.params) ? m.params : [];
  const keys = new Set(params.map(p => p.key));
  const byKey = new Map(params.map(p => [p.key, p]));

  if (m.purpose !== undefined && (typeof m.purpose !== 'string' || !m.purpose.trim())) errors.push('purpose must be a non-empty sentence');

  params.forEach((p, i) => {
    const where = `params[${i}] "${p.key}"`;
    if (p.tier !== undefined && !TIERS.includes(p.tier)) errors.push(`${where}: tier must be one of ${TIERS.join(', ')}`);
    checkWhen(p.when, keys, where, errors);
  });

  const d = m.distribution;
  if (d !== undefined) {
    if (!isObj(d)) errors.push('distribution must be an object');
    else {
      if (d.modes !== undefined && (!Array.isArray(d.modes) || d.modes.some(x => !MODES.includes(x)))) errors.push(`distribution.modes must list ${MODES.join(', ')}`);
      if (d.scopes !== undefined && (!Array.isArray(d.scopes) || d.scopes.some(x => !SCOPES.includes(x)))) errors.push(`distribution.scopes must list ${SCOPES.join(', ')}`);
      if (d.default?.mode !== undefined && !MODES.includes(d.default.mode)) errors.push('distribution.default.mode is invalid');
    }
  }

  const editorIds = new Set<string>();
  (m.editors ?? []).forEach((e, i) => {
    const where = `editors[${i}] "${String(e?.id)}"`;
    if (!e || typeof e.id !== 'string' || !e.id) errors.push(`editors[${i}]: id is required`);
    else if (editorIds.has(e.id)) errors.push(`${where}: duplicate id`);
    editorIds.add(e?.id);
    if (typeof e?.input !== 'string' || !e.input.startsWith('pm.')) errors.push(`${where}: input must name a pm.* input`);
    if (!isObj(e?.bind) || Object.keys(e.bind).length === 0) errors.push(`${where}: bind must map props to param keys`);
    else for (const [prop, key] of Object.entries(e.bind)) if (!keys.has(key)) errors.push(`${where}: bind "${prop}" refers to unknown param "${key}"`);
    checkWhen(e?.when, keys, where, errors);
  });

  const presets = m.presets ?? [];
  if (!Array.isArray(presets)) errors.push('presets must be an array');
  else {
    const ids = new Set<string>();
    presets.forEach((p, i) => {
      const where = `presets[${i}] "${String(p?.id)}"`;
      if (!p || typeof p.id !== 'string' || !p.id) errors.push(`presets[${i}]: id is required`);
      else if (ids.has(p.id)) errors.push(`${where}: duplicate id`);
      ids.add(p?.id);
      if (typeof p?.label !== 'string' || !p.label) errors.push(`${where}: label is required`);
      if (!isObj(p?.params)) errors.push(`${where}: params must be an object`);
      else for (const [k, v] of Object.entries(p.params)) {
        const def = byKey.get(k);
        if (!def) errors.push(`${where}: unknown param "${k}"`);
        else {
          const msg = checkParamValue(def, v);
          if (msg) errors.push(`${where}: param "${k}" ${msg}`);
        }
      }
      if (p?.strength !== undefined && !(isNum(p.strength) && p.strength >= 0 && p.strength <= 1)) errors.push(`${where}: strength must be in [0, 1]`);
      if (p?.speed !== undefined && !['time', 'beat', 'infinite'].includes(p.speed.mode)) errors.push(`${where}: speed.mode is invalid`);
      if (p?.distribution?.mode !== undefined && !MODES.includes(p.distribution.mode)) errors.push(`${where}: distribution.mode is invalid`);
      if (p?.when?.kind && p.when.kind.some(k => !KINDS.includes(k))) errors.push(`${where}: when.kind must list ${KINDS.join(', ')}`);
    });
    if (presets.filter(p => p?.default).length > 1) errors.push('at most one preset may be default');
  }
}
