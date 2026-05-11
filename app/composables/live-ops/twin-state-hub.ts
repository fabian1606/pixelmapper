/**
 * In-process registry of mounted controller-twin widgets, so that on a peer
 * presence:join we can push the current visual state (pressed buttons + fader
 * positions) to the newcomer. Without this, a late-joining client sees the
 * twin in its default state until someone touches it again.
 */

export interface TwinStateProvider {
  pageId: string;
  widgetId: string;
  /** controlIds currently held down. */
  getPressed: () => string[];
  /** [controlId, value 0–1] for any fader that has been moved. */
  getFaderValues: () => Array<[string, number]>;
}

const providers = new Set<TwinStateProvider>();

export function registerTwinState(provider: TwinStateProvider): () => void {
  providers.add(provider);
  return () => { providers.delete(provider); };
}

export function snapshotTwinStates(): TwinStateProvider[] {
  return Array.from(providers);
}
