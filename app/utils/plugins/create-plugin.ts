/**
 * Create-from-code seam (plan P4.3): manifest + sources in, validated package
 * out. The "New modifier from code" dialog drives it today; the future AI
 * loop calls the same function and feeds the returned diagnostics back.
 *
 * Runs entirely in the browser: the toolchain (AssemblyScript + Binaryen) is
 * imported lazily on first use.
 */
import type { ContentPluginManifest, ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import { registerPackage } from './plugin-store';

/** One readable problem (compile, manifest or validation). */
export interface CreateDiagnostic {
  stage: 'manifest' | 'compile' | 'validate';
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/** Outcome of `buildFromCode`. */
export interface CreateResult {
  /** Built + validated package (registered locally), or null on errors. */
  pkg: ContentPluginPackage | null;
  diagnostics: CreateDiagnostic[];
  /** Validation metrics when validation ran. */
  metrics?: { medianFrameMs: number; samples: number; outputMin: number; outputMax: number };
}

/** Inputs: the manifest (object or JSON text) and sources by file name. */
export interface CreateInput {
  manifest: ContentPluginManifest | string;
  /** `modifier.ts` (required) and the optional panel file named by `manifest.ui.panel`. */
  source: Record<string, string>;
}

/** Parses a manifest given as JSON text. */
function parseManifest(input: CreateInput['manifest']): { manifest?: ContentPluginManifest; error?: string } {
  if (typeof input !== 'string') return { manifest: input };
  try {
    return { manifest: JSON.parse(input) as ContentPluginManifest };
  }
  catch (err) {
    return { error: `manifest.json is not valid JSON: ${(err as Error).message}` };
  }
}

/**
 * Compiles, instruments, hashes and validates a content plugin. On success
 * the package is registered with the plugin store (available for previews
 * and for adding to the stack) but not published.
 */
export async function buildFromCode(input: CreateInput): Promise<CreateResult> {
  const { manifest, error } = parseManifest(input.manifest);
  if (!manifest) return { pkg: null, diagnostics: [{ stage: 'manifest', severity: 'error', message: error! }] };

  const { buildPackage, validate } = await import('@pixelmapper/plugin-toolchain');
  const built = await buildPackage(manifest, input.source);
  const diagnostics: CreateDiagnostic[] = built.diagnostics.map(d => ({
    stage: d.message.startsWith('manifest:') ? 'manifest' : 'compile',
    severity: d.severity,
    message: d.message,
  }));
  if (!built.pkg) return { pkg: null, diagnostics };

  const report = await validate(built.pkg);
  for (const message of report.errors) diagnostics.push({ stage: 'validate', severity: 'error', message });
  for (const message of report.warnings) diagnostics.push({ stage: 'validate', severity: 'warning', message });
  const { medianFrameMs, samples, outputMin, outputMax } = report.metrics;
  if (!report.ok) return { pkg: null, diagnostics, metrics: { medianFrameMs, samples, outputMin, outputMax } };

  registerPackage(built.pkg);
  return { pkg: built.pkg, diagnostics, metrics: { medianFrameMs, samples, outputMin, outputMax } };
}

// ── Template ─────────────────────────────────────

/**
 * Starting manifest for new modifiers (ABI 1.1, plan M11.4): scale output,
 * the shared distribution, recipes and param tiers — see
 * architecture/guides/modifier-design-principles.md.
 */
export const TEMPLATE_MANIFEST: ContentPluginManifest = {
  schema: 1,
  kind: 'modifier',
  alias: '@me/pulse-train',
  name: 'Pulse Train',
  version: '1.0.0',
  apiVersion: '^1.1.0',
  description: 'Short pulses that travel across fixtures along the distribution. Width sets the pulse length within a pass.',
  purpose: 'Short pulses run across your fixtures.',
  speedUnit: 'per pass',
  signatures: ['scalar'],
  output: 'scale',
  distribution: { modes: ['none', 'linear', 'radial', 'order'], scopes: ['across', 'within'], default: { mode: 'order' } },
  params: [
    { key: 'width', type: 'number', min: 0.01, max: 1, default: 0.2, label: 'Width', tier: 'primary' },
    { key: 'soft', type: 'bool', default: true, label: 'Soft edges', tier: 'advanced' },
  ],
  presets: [
    {
      id: 'short', label: 'Short', description: 'Quick blips along the row.', default: true,
      params: { width: 0.1, soft: false }, speed: { mode: 'beat', beatValue: 2 }, distribution: { mode: 'order' }, strength: 1,
    },
    {
      id: 'swell', label: 'Swell', description: 'Slow, soft swells.',
      params: { width: 0.5, soft: true }, speed: { mode: 'beat', beatValue: 8 }, distribution: { mode: 'linear' }, strength: 1,
    },
  ],
};

/** Starting `modifier.ts` matching `TEMPLATE_MANIFEST`. */
export const TEMPLATE_SOURCE = `import { Modifier, Frame, Sample, Out, Params, register, fract, clamp } from "@pixelmapper/plugin-sdk";

class PulseTrain extends Modifier {
  width: f32 = 0.2;
  soft: bool = true;

  /** Called when params change. Read slots in manifest order. */
  prepare(p: Params): void {
    this.width = p.get(0);
    this.soft = p.bool(1);
  }

  /**
   * Called per sample per frame. Must be pure. \`s.spatial\` is the position
   * along the shared distribution (0 → 1), \`ctx.timePhase\` the time in passes.
   * Output "scale": 1 = programmed value, 0 = dark.
   */
  render(ctx: Frame, s: Sample, out: Out): void {
    const t = fract(s.spatial - fract(ctx.timePhase));
    let v: f32 = t < this.width ? 1.0 : 0.0;
    if (this.soft && t < this.width) v = Mathf.sin((t / this.width) * Mathf.PI);
    out.setScalar(clamp(v, 0.0, 1.0));
  }
}

register(new PulseTrain());
`;
