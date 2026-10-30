/**
 * Open/closed state of the collapsible blocks of one Art-Net connector card
 * (WP13): ports, their Advanced parts, Failsafe, Network, Device, Advanced.
 * Remembered per connector and device in localStorage
 * (`pm:artnet:card:<connectorId>`); a block the user never toggled uses
 * its default (ports open when the node has at most two, everything else
 * closed). Storage failures (private mode, blocked site data) are ignored:
 * the card then just starts with the defaults.
 */
import { inject, provide, reactive, type InjectionKey } from 'vue';

/** Prefix of the storage key; the connector id follows. */
export const CARD_COLLAPSE_KEY_PREFIX = 'pm:artnet:card:';

/** Ports are open by default up to this many ports. */
export const PORTS_OPEN_BY_DEFAULT_MAX = 2;

/** Collapse state of one card. */
export interface CardCollapse {
  /** Whether block `id` is open; `fallback` when the user never toggled it. */
  isOpen: (id: string, fallback: boolean) => boolean;
  /** Opens or closes block `id` and remembers it. */
  setOpen: (id: string, open: boolean) => void;
}

/** Reads the stored states of a connector (empty on any failure). */
function load(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  }
  catch {
    return {};
  }
}

/** Creates the collapse state of the card of connector `connectorId`. */
export function createCardCollapse(connectorId: string): CardCollapse {
  const key = `${CARD_COLLAPSE_KEY_PREFIX}${connectorId}`;
  const state = reactive<Record<string, boolean>>(load(key));
  return {
    isOpen: (id, fallback) => state[id] ?? fallback,
    setOpen(id, open) {
      state[id] = open;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      }
      catch (err) {
        console.warn('[artnet] cannot remember the card layout:', err);
      }
    },
  };
}

const CARD_COLLAPSE: InjectionKey<CardCollapse> = Symbol('artnet-card-collapse');

/** Creates and provides the collapse state of a card (call in the card's root). */
export function provideCardCollapse(connectorId: string): CardCollapse {
  const collapse = createCardCollapse(connectorId);
  provide(CARD_COLLAPSE, collapse);
  return collapse;
}

/** The card's collapse state; an in-memory one when no card provides it (components mounted alone). */
export function useCardCollapse(): CardCollapse {
  const provided = inject(CARD_COLLAPSE, null);
  if (provided) return provided;
  const state = reactive<Record<string, boolean>>({});
  return { isOpen: (id, fallback) => state[id] ?? fallback, setOpen: (id, open) => { state[id] = open; } };
}
