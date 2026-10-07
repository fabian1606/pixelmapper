/**
 * Content-plugin package types (ADR §6.1–6.2).
 */
import type { ParamSchema, ParamValue, Signature } from '@pixelmapper/extension-api';

/** How the host combines a modifier's output with the base value. */
export type ModifierOutputMode = 'bipolar' | 'absolute';

/** Plugin kinds; only `modifier` is implemented (`shader`/`visual` reserved). */
export type ContentPluginKind = 'modifier' | 'shader' | 'visual';

/** Optional custom panel declaration. */
export interface ContentPluginUi {
  /** Source file of the panel (`ui.ts`). */
  panel: string;
  /** Where the panel renders relative to the generated params. */
  placement?: 'below-params' | 'above-params' | 'replace-params';
}

/** `manifest.json` of a content plugin. */
export interface ContentPluginManifest {
  schema: 1;
  kind: ContentPluginKind;
  /** Human alias, e.g. `@pixelmapper/waveform`. */
  alias: string;
  name: string;
  /** Semver (metadata; identity is the hash). */
  version: string;
  /** Semver range of the plugin ABI/SDK. */
  apiVersion: string;
  /** Read by humans and AI. */
  description: string;
  signatures: Signature[];
  output: ModifierOutputMode;
  params: ParamSchema;
  ui?: ContentPluginUi;
}

/** A built, content-addressed plugin package. */
export interface ContentPluginPackage {
  /** `sha256:<hex>` over canonical(manifest) ‖ wasm ‖ uiJs. */
  hash: string;
  manifest: ContentPluginManifest;
  wasm: Uint8Array;
  /** Transpiled `ui.ts`, if the plugin has a custom panel. */
  uiJs?: string;
  /** Sources (`modifier.ts`, `ui.ts`) for editing and recompile-verification; not hashed. */
  source: Record<string, string>;
  /** Exact toolchain identity, e.g. `pm-toolchain@1.0.0+asc@0.28.20`. */
  toolchain: string;
}

/** Param values of an instance, keyed by param key. */
export type ParamValues = Record<string, ParamValue>;
