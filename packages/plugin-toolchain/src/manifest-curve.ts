/**
 * Validation of curve params and curve values (plan M1.5).
 */
import type { CurveParam, CurvePointV2 } from '@pixelmapper/extension-api';
import { getShape } from './curve-shapes';

const DOMAINS = ['cycle', 'signed'];
const AXES = ['fixtures', 'beats', 'none'];
const RANGES = ['unipolar', 'bipolar'];
const KINDS = ['smooth', 'corner', 'linear', 'step'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUnit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;

/**
 * Validates a curve value (programmatic, free or legacy). `where` prefixes
 * messages. Unknown shape ids are warnings (extension shapes are only known
 * in the app).
 */
export function validateCurveValue(v: unknown, where: string, domain: string, errors: string[], warnings: string[]): void {
  if (Array.isArray(v)) {
    if (v.length < 2) errors.push(`${where}: curve needs ≥ 2 points`);
    else if (v.some(pt => !isUnit(pt?.x) || !isUnit(pt?.y))) errors.push(`${where}: curve points must be in 0–1`);
    else if (v.some((pt, j) => j > 0 && pt.x <= v[j - 1].x)) errors.push(`${where}: curve x must increase`);
    return;
  }
  if (!v || typeof v !== 'object') {
    errors.push(`${where}: curve must be a point list, { points } or { shape, args }`);
    return;
  }
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.points)) {
    const pts = o.points as CurvePointV2[];
    if (pts.length < 1) errors.push(`${where}: free curve needs ≥ 1 point`);
    if (pts.some(pt => !isUnit(pt?.x) || !isUnit(pt?.y))) errors.push(`${where}: curve points must be in 0–1`);
    else if (pts.some((pt, j) => j > 0 && pt.x < pts[j - 1]!.x)) errors.push(`${where}: curve x must not decrease`);
    if (pts.some(pt => pt?.kind !== undefined && !KINDS.includes(pt.kind))) errors.push(`${where}: point kind must be one of ${KINDS.join(', ')}`);
    return;
  }
  if (typeof o.shape === 'string') {
    const args = (o.args ?? {}) as Record<string, unknown>;
    if (typeof args !== 'object' || Object.values(args).some(a => !isNum(a))) errors.push(`${where}: shape args must be numbers`);
    const def = getShape(o.shape);
    if (!def) {
      warnings.push(`${where}: shape "${o.shape}" is not built in (must be contributed by an extension)`);
      return;
    }
    if (def.domain !== domain) errors.push(`${where}: shape "${o.shape}" has domain "${def.domain}", param has "${domain}"`);
    for (const k of Object.keys(args)) if (!def.args.some(a => a.key === k)) errors.push(`${where}: shape "${o.shape}" has no arg "${k}"`);
    return;
  }
  errors.push(`${where}: curve must be a point list, { points } or { shape, args }`);
}

/** Validates a curve param definition (enums, offered shapes, default). */
export function validateCurveParam(p: CurveParam, where: string, errors: string[], warnings: string[]): void {
  const domain = p.domain ?? 'cycle';
  if (!DOMAINS.includes(domain)) errors.push(`${where}: domain must be one of ${DOMAINS.join(', ')}`);
  if (p.axis !== undefined && !AXES.includes(p.axis)) errors.push(`${where}: axis must be one of ${AXES.join(', ')}`);
  if (p.range !== undefined && !RANGES.includes(p.range)) errors.push(`${where}: range must be one of ${RANGES.join(', ')}`);
  if (p.allowFree !== undefined && typeof p.allowFree !== 'boolean') errors.push(`${where}: allowFree must be boolean`);
  if (p.shapes !== undefined) {
    if (!Array.isArray(p.shapes)) errors.push(`${where}: shapes must be an array of shape ids`);
    else for (const id of p.shapes) {
      const def = getShape(id);
      if (!def) warnings.push(`${where}: shape "${id}" is not built in (must be contributed by an extension)`);
      else if (def.domain !== domain) errors.push(`${where}: shape "${id}" has domain "${def.domain}", param has "${domain}"`);
    }
  }
  if (p.shapes?.length === 0 && p.allowFree === false) errors.push(`${where}: offers no shapes and no free editing`);
  validateCurveValue(p.default, `${where} default`, domain, errors, warnings);
}
