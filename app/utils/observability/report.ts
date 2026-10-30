/**
 * Compact text report of an observation (ADR 0002 §6.4).
 *
 * ```
 * observe front · 0.0–2.0s · 30 fps · preview · bpm 120
 * GROUP 8 fixtures · scalar · sources: waveform@sha256:3fa…(absolute, add, 1.0)
 *   range    0–1.00 mean .50 sd .35
 *   temporal periodic 1.00 Hz · 2 beats · beat lock
 *   spatial  chase +x · step .125 · 1.14 u/s · position
 *   issues   none
 * FIXTURE par-3 (x .29 y 0) 0–0 constant · stuck-0
 * EXPECT   ✓ group.temporal.kind = "periodic" · ✗ …
 * ```
 *
 * Group blocks come from `json.groups` (named) or the aggregate `json.group`;
 * FIXTURE lines list outliers only (all fixtures with `detail: 'fixture'`).
 */
import type { ExpectationResult, Finding } from '@pixelmapper/agent-kit';
import type { Trace } from './types';
import type { FixtureFeatures, GroupFeatures, ObservationJson, ObservationSource, Range, Spatial, Temporal } from './features/types';

// ── Limits ──────────────────────────────────────

/** Maximum FIXTURE lines before "… n more". */
const MAX_FIXTURE_LINES = 8;
/** Maximum finding lines. */
const MAX_FINDING_LINES = 4;
/** Maximum event times listed per direction. */
const MAX_EVENT_TIMES = 4;

// ── Number formatting ───────────────────────────

/** Short number: `.92`, `-.12`, `1.00`, `0`. */
export function short(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '0';
  const s = x.toFixed(digits);
  if (Number(s) === 0) return '0';
  if (Math.abs(x) >= 1) return s;
  return s.replace(/^(-?)0\./, '$1.');
}

/** Number with trailing zeros trimmed (`2`, `0.5`, `1.54`). */
function trim(x: number, digits = 2): string {
  return String(Number(x.toFixed(digits)));
}

/** Seconds with one decimal. */
function secs(x: number): string {
  return x.toFixed(1);
}

/** Padded line label (`  range    `). */
function label(name: string): string {
  return `  ${name.padEnd(9)}`;
}

// ── Feature text ────────────────────────────────

/** `min–max mean m sd s`. */
function rangeText(r: Range): string {
  return `${short(r.min)}–${short(r.max)} mean ${short(r.mean)} sd ${short(r.sd)}`;
}

/** One-line temporal verdict. */
export function temporalText(t: Temporal): string {
  switch (t.kind) {
    case 'constant':
      return 'constant';
    case 'periodic':
      return `periodic ${t.hz.toFixed(2)} Hz · ${trim(t.beats)} beat${t.beats === 1 ? '' : 's'} · ${t.beatLock ? 'beat lock' : 'no beat lock'}`;
    case 'aperiodic':
      return `aperiodic · band ${trim(t.band[0], 1)}–${trim(t.band[1], 1)} Hz · no beat lock`;
    case 'events': {
      const list = (ts: number[]) => ts.slice(0, MAX_EVENT_TIMES).map(x => `${x.toFixed(2)}s`).join(' ') + (ts.length > MAX_EVENT_TIMES ? ' …' : '');
      return `events · on ${list(t.on) || '-'} · off ${list(t.off) || '-'}`;
    }
  }
}

/** Direction label: `+x`, `-y` or `(.71, .71)`. */
function directionText(d: [number, number]): string {
  if (Math.abs(d[0]) >= 0.92) return d[0] > 0 ? '+x' : '-x';
  if (Math.abs(d[1]) >= 0.92) return d[1] > 0 ? '+y' : '-y';
  return `(${short(d[0])}, ${short(d[1])})`;
}

/** One-line spatial verdict. */
function spatialText(s: Spatial): string {
  switch (s.kind) {
    case 'uniform':
    case 'constant':
      return s.kind;
    case 'independent':
      return `independent (corr ${short(s.corr)})`;
    case 'gradient':
      return `gradient ${directionText(s.direction)} · span ${short(s.span)}`;
    case 'chase': {
      const speed = s.speed !== undefined ? ` · ${trim(s.speed)} u/s` : '';
      return `chase ${directionText(s.direction)} · step ${short(s.step, 3)}${speed} · ${s.axis}`;
    }
  }
}

/** Short source label: `alias@sha256:3fa…(output, blend, strength)`. */
function sourceText(s: ObservationSource): string {
  const m = /^(sha256:)?([0-9a-f]+)$/i.exec(s.hash);
  const hash = m ? `${m[1] ?? ''}${m[2]!.slice(0, 3)}…` : s.hash;
  const name = s.plugin && s.plugin !== s.hash ? `${s.plugin}@${hash}` : hash;
  return `${name}(${s.output}, ${s.blend}, ${s.strength.toFixed(1)})`;
}

// ── Blocks ──────────────────────────────────────

/** GROUP block: header plus indented feature lines. */
function groupBlock(g: GroupFeatures, json: ObservationJson): string[] {
  const head = [
    'GROUP',
    g.name ? `${g.name} ·` : '',
    `${g.count} fixture${g.count === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' ');
  const parts = [head, json.signature];
  if (g.samples !== g.count) parts.push(`${g.samples} heads`);
  if (json.sources.length > 0) parts.push(`sources: ${json.sources.map(sourceText).join(', ')}`);
  const lines = [parts.join(' · ')];
  if (g.samples === 0) {
    lines.push(`${label('issues')}${g.issues.join(', ')}`);
    return lines;
  }
  // Range (rgb: covered by the color line; panTilt: per component).
  if (json.signature === 'panTilt') {
    const comp = Object.entries(g.components).map(([n, c]) => `${n} ${short(c.range.min)}–${short(c.range.max)} mean ${short(c.range.mean)}`);
    lines.push(`${label('range')}${comp.join(' · ')}`);
  } else if (!g.color) {
    lines.push(`${label('range')}${rangeText(g.range)}`);
  }
  if (g.color) {
    const c = g.color;
    lines.push(`${label('color')}${c.name} · hue ${Math.round(c.hue.min)}°–${Math.round(c.hue.max)}° mean ${Math.round(c.hue.mean)}° · sat ${short(c.sat.mean)} · value ${rangeText(c.value)}`);
  }
  lines.push(`${label('temporal')}${temporalText(g.temporal)}${g.active < 1 && g.active > 0 ? ` · ${Math.round(g.active * 100)}% active` : ''}`);
  // Mirror note only when it says something (a uniform group is trivially symmetric).
  const moving = g.spatial.kind !== 'uniform' && g.spatial.kind !== 'constant';
  const mirrored = (['x', 'y'] as const).filter(a => (g.mirror?.[a]?.r ?? 0) >= 0.9);
  const mirror = moving && mirrored.length > 0
    ? ` · mirror ${mirrored.map(a => `${a} ${short(g.mirror![a]!.at)}`).join(', ')}`
    : '';
  lines.push(`${label('spatial')}${spatialText(g.spatial)}${mirror}`);
  if (g.radial) {
    const r = g.radial;
    const speed = r.kind !== 'none' && r.speed > 0 ? ` · ${trim(r.speed)} u/s` : '';
    lines.push(`${label('radial')}${r.kind} r ${short(r.r)}${speed} from ${r.from.map(p => p.key).join(', ')}`);
  }
  lines.push(`${label('issues')}${g.issues.length > 0 ? g.issues.join(', ') : 'none'}`);
  return lines;
}

/** Why a fixture is notable (empty = not an outlier). */
function outlierReasons(f: FixtureFeatures, g: GroupFeatures): string[] {
  const reasons: string[] = [];
  const stuck = f.issues.includes('stuck-0') || f.issues.includes('stuck-1');
  if (stuck || (f.issues.includes('constant') && g.temporal.kind !== 'constant')) reasons.push('constant');
  else if (f.range.max < 0.02) reasons.push('dark');
  if (g.temporal.kind !== 'constant' && f.temporal.kind !== 'constant' && f.temporal.kind !== g.temporal.kind) {
    reasons.push(`differs (${f.temporal.kind} vs ${g.temporal.kind})`);
  } else if (f.temporal.kind === 'periodic' && g.temporal.kind === 'periodic' && Math.abs(f.temporal.hz / g.temporal.hz - 1) > 0.05) {
    reasons.push(`differs (${f.temporal.hz.toFixed(2)} vs ${g.temporal.hz.toFixed(2)} Hz)`);
  }
  return reasons;
}

/** FIXTURE line. */
function fixtureLine(f: FixtureFeatures, reasons: string[]): string {
  const value = f.color ? `${f.color.name} value ${short(f.range.min)}–${short(f.range.max)}` : `${short(f.range.min)}–${short(f.range.max)}`;
  const issues = f.issues.filter(i => i !== 'constant');
  const notes = [...reasons.filter(r => r !== 'constant'), ...issues];
  const heads = f.heads > 1 ? ` ${f.heads} heads` : '';
  return `FIXTURE ${f.name} (x ${short(f.x)} y ${short(f.y)}${heads}) ${value} ${temporalText(f.temporal)}${notes.length > 0 ? ` · ${notes.join(', ')}` : ''}`;
}

/** EXPECT line: passes by label, failures with their actual value. */
function expectLine(results: ExpectationResult[]): string {
  const items = results.map(r => {
    if (!r.pass) return r.message;
    const cut = r.message.lastIndexOf(' (');
    return cut > 0 ? r.message.slice(0, cut) : r.message;
  });
  return `EXPECT   ${items.join(' · ')}`;
}

// ── Report ──────────────────────────────────────

/** Renders the compact text report of an observation. */
export function renderReport(
  trace: Trace,
  json: ObservationJson,
  expectations: ExpectationResult[],
  findings: Finding[],
  opts: { title?: string; detail?: 'group' | 'fixture' | 'raw' } = {},
): string {
  const w = json.window;
  const lines = [
    `observe${opts.title ? ` ${opts.title}` : ''} · ${secs(w.from)}–${secs(w.from + w.duration)}s · ${w.fps} fps · ${trace.mode} · bpm ${trim(w.bpm, 1)}`,
  ];
  const groups = json.groups ? Object.values(json.groups) : [];
  for (const g of groups.length > 0 ? groups : [json.group]) lines.push(...groupBlock(g, json));

  // Fixtures: outliers vs. the aggregate group, or all with detail 'fixture'.
  const all = opts.detail === 'fixture';
  const fixtureLines: string[] = [];
  for (const f of Object.values(json.fixtures)) {
    const reasons = outlierReasons(f, json.group);
    // `clamped` stays on the group issues line; NaN marks a fixture as notable.
    const notable = reasons.length > 0 || f.issues.includes('nan');
    if (all || notable) fixtureLines.push(fixtureLine(f, reasons));
  }
  const limit = all ? Infinity : MAX_FIXTURE_LINES;
  lines.push(...fixtureLines.slice(0, limit));
  if (fixtureLines.length > limit) lines.push(`FIXTURE … ${fixtureLines.length - limit} more`);

  // Findings that are not already obvious from the issues line.
  const shown = findings.filter(f => f.code !== 'observe-constant-output').slice(0, MAX_FINDING_LINES);
  for (const f of shown) lines.push(`${f.level.toUpperCase().padEnd(8)} ${f.code}: ${f.message}`);

  if (expectations.length > 0) lines.push(expectLine(expectations));
  return lines.join('\n');
}
