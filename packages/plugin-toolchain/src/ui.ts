/**
 * Custom panel transpilation (ADR §6.9): `ui.ts` → plain JS with sucrase.
 * No bundling and no imports: the panel only gets the `PanelApi` passed to
 * `mount(el, api)`.
 */
import { transform } from 'sucrase';

/** Result of `transpileUi`. */
export interface TranspileResult {
  js: string | null;
  errors: string[];
}

/** Patterns that would load code from elsewhere. */
const FORBIDDEN: { re: RegExp; message: string }[] = [
  { re: /^\s*import\s/m, message: 'ui.ts must not use import statements' },
  { re: /\bimport\s*\(/, message: 'ui.ts must not use dynamic import()' },
  { re: /^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/m, message: 'ui.ts must not re-export from other modules' },
  { re: /\brequire\s*\(/, message: 'ui.ts must not use require()' },
  { re: /\bimportScripts\s*\(/, message: 'ui.ts must not use importScripts()' },
];

/** Transpiles TypeScript to JS and checks the import rules and `mount` export. */
export function transpileUi(ts: string): TranspileResult {
  const errors: string[] = [];
  for (const f of FORBIDDEN) if (f.re.test(ts)) errors.push(f.message);
  if (!/\bexport\s+(?:async\s+)?function\s+mount\s*\(|\bexport\s+const\s+mount\s*=/.test(ts)) {
    errors.push('ui.ts must export a function mount(el, api)');
  }
  if (errors.length > 0) return { js: null, errors };
  try {
    const { code } = transform(ts, { transforms: ['typescript'], disableESTransforms: true });
    return { js: code, errors: [] };
  }
  catch (err) {
    return { js: null, errors: [`ui.ts does not compile: ${(err as Error).message}`] };
  }
}
