import type { ControllerControl, ControllerDefinition } from '~/utils/controllers/types';
import type { InputBinding } from '~/utils/live/types';
import type { InputSource } from './types';
import { keyInputSource } from './key-source';
import { midiInputSource } from './midi-source';

/**
 * Registry of input sources and the source-independent binding helpers.
 * A new source (Stream Deck, OSC, …) implements `InputSource` and is
 * registered here; the panel's Learn and play mode pick it up unchanged.
 */

const sources = new Map<string, InputSource>();

/** Adds (or replaces) a source. */
export function registerInputSource(source: InputSource): void {
  sources.set(source.id, source);
}

registerInputSource(keyInputSource);
registerInputSource(midiInputSource);

/** All registered sources. */
export function listInputSources(): InputSource[] {
  return [...sources.values()];
}

/** A source by id (null when it is not registered, e.g. extension missing). */
export function getInputSource(id: string): InputSource | null {
  return sources.get(id) ?? null;
}

// ── Bindings ────────────────────────────────────

/** JSON with sorted object keys, so equal addresses give equal strings. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Identity of a binding: equal for the same source + address. */
export function bindingKey(binding: InputBinding): string {
  return `${binding.source}:${stableJson(binding.address)}`;
}

/** Display text, e.g. "Key · B" or "MIDI · Note 36 · Ch 1". */
export function bindingLabel(binding: InputBinding): string {
  const source = getInputSource(binding.source);
  if (!source) return `${binding.source} (unavailable)`;
  return `${source.title} · ${source.format(binding.address)}`;
}

/** Learn prompt from the sources usable here, e.g. "Press a key or play a note…". */
export function learnPrompt(): string {
  const hints = listInputSources().filter(s => s.isAvailable()).map(s => s.learnHint);
  const text = hints.length > 1 ? `${hints.slice(0, -1).join(', ')} or ${hints.at(-1)}` : (hints[0] ?? 'no input available');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}…`;
}

/**
 * What a control on a controller twin already is in hardware, e.g. "AKAI
 * APC Mini mk2 · Note 3 · Ch 1". Shown read-only above the bindings.
 */
export function nativeInputLabel(def: ControllerDefinition | null | undefined, control: ControllerControl | null | undefined): string | null {
  if (!def) return null;
  if (!control?.input) return def.label;
  const source = getInputSource(control.input.source);
  return source ? `${def.label} · ${source.format(control.input.address)}` : def.label;
}
