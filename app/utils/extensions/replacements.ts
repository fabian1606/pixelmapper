/**
 * Replacement resolution for `pm.*` inputs (ADR §5.4, D12).
 *
 * - No installed replacement → core default.
 * - Exactly one → that replacement.
 * - Several → the per-user choice `replacements[name] = extensionId`
 *   (localStorage; `'core'` selects the default). Without a choice the core
 *   default is used and the conflict is queued for a one-time choice dialog.
 */
import { markRaw, shallowRef, type Component } from 'vue';
import type { PmInputName } from '@pixelmapper/extension-api';
import { getContributions, registryVersion } from './registry';

/** localStorage key of the per-user choices. */
const STORAGE_KEY = 'pm.replacements';

/** Sentinel choice: use the core default even though replacements exist. */
export const CORE_CHOICE = 'core';

/** A replacement candidate. */
export interface ReplacementCandidate {
  extensionId: string;
  component: Component;
}

/** Reads the stored choices; tolerant of blocked/corrupt storage. */
function readChoices(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  }
  catch {
    return {};
  }
}

/** Reactive copy of the stored choices. */
export const replacementChoices = shallowRef<Record<string, string>>(readChoices());

/** Persists a user choice for one input. */
export function setReplacementChoice(name: PmInputName, extensionId: string): void {
  replacementChoices.value = { ...replacementChoices.value, [name]: extensionId };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(replacementChoices.value));
  }
  catch (err) {
    console.warn('[extensions] could not persist replacement choice:', err);
  }
  pendingConflicts.value = pendingConflicts.value.filter(n => n !== name);
}

/** Inputs with unresolved conflicts, awaiting the choice dialog. */
export const pendingConflicts = shallowRef<PmInputName[]>([]);

/** All installed replacements of one input, ordered by extension id. */
export function getReplacementCandidates(name: PmInputName): ReplacementCandidate[] {
  void registryVersion.value; // reactive dependency for computed callers
  return getContributions('replaces')
    .filter(c => c.contribution.replaces === name)
    .map(c => ({ extensionId: c.extensionId, component: markRaw(c.contribution.component) }));
}

/**
 * Resolves the component for an input. `fallback` is the core default.
 * Records an unresolved conflict in `pendingConflicts`.
 */
export function resolveReplacement(name: PmInputName, fallback: Component): Component {
  const candidates = getReplacementCandidates(name);
  if (candidates.length === 0) return fallback;
  if (candidates.length === 1) return candidates[0]!.component;

  const choice = replacementChoices.value[name];
  if (choice === CORE_CHOICE) return fallback;
  const chosen = candidates.find(c => c.extensionId === choice);
  if (chosen) return chosen.component;

  if (!pendingConflicts.value.includes(name)) {
    // Defer so a computed that resolves does not write state synchronously.
    queueMicrotask(() => {
      if (!pendingConflicts.value.includes(name)) pendingConflicts.value = [...pendingConflicts.value, name];
    });
  }
  return fallback;
}

/** Test helper: clears in-memory state (storage is left alone). */
export function resetReplacementState(): void {
  replacementChoices.value = readChoices();
  pendingConflicts.value = [];
}
