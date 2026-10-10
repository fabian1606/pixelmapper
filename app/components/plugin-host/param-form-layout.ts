/**
 * Layout of a param form (plan M5.3, pure): which composite editors and
 * params show where. Order: editors (filtered by `when`), primary params not
 * bound to a shown editor, then advanced params under "More". Hidden params
 * never render.
 */
import type { ParamCondition, ParamDef, ParamSchema, ParamValue } from '@pixelmapper/extension-api';
import type { ManifestEditor } from '@pixelmapper/plugin-toolchain/types';

/** Context `when` conditions read. */
export interface WhenContext {
  params: Record<string, ParamValue>;
  /** Current `distribution.mode` of the instance. */
  distributionMode?: string;
}

/** True when every condition holds (missing params use their schema default). */
export function matchWhen(when: ParamCondition | undefined, schema: ParamSchema, ctx: WhenContext): boolean {
  if (!when) return true;
  return Object.entries(when).every(([key, want]) => {
    const value = key === 'distribution.mode'
      ? ctx.distributionMode
      : (ctx.params[key] ?? schema.find(p => p.key === key)?.default);
    return Array.isArray(want) ? want.includes(value as never) : value === want;
  });
}

/** Grouped params (by `group`, ungrouped first, manifest order kept). */
export interface ParamGroup {
  name: string | null;
  params: ParamDef[];
}

/** Groups params by their `group` field. */
export function groupParams(params: readonly ParamDef[]): ParamGroup[] {
  const out: ParamGroup[] = [];
  for (const p of params) {
    const name = p.group ?? null;
    let g = out.find(x => x.name === name);
    if (!g) {
      g = { name, params: [] };
      if (name === null) out.unshift(g);
      else out.push(g);
    }
    g.params.push(p);
  }
  return out;
}

/** The computed layout of a form. */
export interface ParamFormLayout {
  editors: ManifestEditor[];
  primary: ParamGroup[];
  advanced: ParamGroup[];
}

/** Computes the layout for the current values. */
export function layoutParams(schema: ParamSchema, editors: readonly ManifestEditor[] = [], ctx: WhenContext): ParamFormLayout {
  const shownEditors = editors.filter(e => matchWhen(e.when, schema, ctx));
  const bound = new Set(editors.flatMap(e => Object.values(e.bind)));
  const visible = schema.filter(p => (p.tier ?? 'primary') !== 'hidden' && !bound.has(p.key) && matchWhen(p.when, schema, ctx));
  return {
    editors: shownEditors,
    primary: groupParams(visible.filter(p => (p.tier ?? 'primary') === 'primary')),
    advanced: groupParams(visible.filter(p => p.tier === 'advanced')),
  };
}

/** The model value of a composite editor: its bound params by prop name. */
export function editorValue(editor: ManifestEditor, schema: ParamSchema, params: Record<string, ParamValue>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [prop, key] of Object.entries(editor.bind)) out[prop] = params[key] ?? (schema.find(p => p.key === key)?.default as ParamValue);
  return out;
}

/** Writes an editor's emitted value back onto the params (bound keys only). */
export function applyEditorValue(editor: ManifestEditor, params: Record<string, ParamValue>, value: Record<string, ParamValue>): Record<string, ParamValue> {
  const out = { ...params };
  for (const [prop, key] of Object.entries(editor.bind)) if (prop in value) out[key] = value[prop]!;
  return out;
}
