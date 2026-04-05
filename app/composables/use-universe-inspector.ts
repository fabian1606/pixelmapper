import { computed } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';

export interface ChannelInfo {
  dmxAddress: number;    // 1-based, global
  localAddress: number;  // 1-based within universe
  bufferIndex: number;   // (universe-1)*512 + (localAddress-1)
  fixture: Fixture | null;
  channel: Channel | null;
  isAssigned: boolean;
}

export interface ChannelGroup {
  label: string;         // Fixture name or "Unbelegt"
  isAssigned: boolean;
  channels: ChannelInfo[];
}

export function useUniverseInspector() {
  const engineStore = useEngineStore();

  /**
   * Build a flat 512-element channel map for a given universe,
   * then group contiguous assigned/unassigned runs.
   */
  function buildChannelGroups(universe: number): ChannelGroup[] {
    // Build reverse lookup: global dmxAddress (1-based) → { fixture, channel }
    const lookup = new Map<number, { fixture: Fixture; channel: Channel }>();
    for (const fixture of engineStore.flatFixtures) {
      for (const ch of fixture.channels) {
        const addr = fixture.startAddress + ch.addressOffset;
        lookup.set(addr, { fixture, channel: ch });
      }
    }

    // Build 512-element flat array for this universe
    const universeStart = (universe - 1) * 512 + 1; // first global dmxAddress in universe
    const infos: ChannelInfo[] = Array.from({ length: 512 }, (_, i) => {
      const dmxAddress = universeStart + i;
      const localAddress = i + 1;
      const bufferIndex = (universe - 1) * 512 + i;
      const entry = lookup.get(dmxAddress) ?? null;
      return {
        dmxAddress,
        localAddress,
        bufferIndex,
        fixture: entry?.fixture ?? null,
        channel: entry?.channel ?? null,
        isAssigned: entry !== null,
      };
    });

    // Group contiguous runs by fixture (or unassigned)
    const groups: ChannelGroup[] = [];
    let i = 0;
    while (i < infos.length) {
      const info = infos[i]!;
      const currentFixtureId = info.fixture?.id ?? null;
      const isAssigned = info.isAssigned;

      // Find end of this run
      let j = i + 1;
      while (j < infos.length) {
        const next = infos[j]!;
        if (next.isAssigned !== isAssigned) break;
        if (isAssigned && next.fixture?.id !== currentFixtureId) break;
        j++;
      }

      groups.push({
        label: isAssigned ? (info.fixture!.name || `Fixture ${info.fixture!.id}`) : 'Unbelegt',
        isAssigned,
        channels: infos.slice(i, j),
      });
      i = j;
    }

    return groups;
  }

  /** Get the live display value from the mixed output buffer (all layers combined). */
  function getLiveValue(bufferIndex: number): number {
    const buf = engineStore.getOutputBuffer();
    return bufferIndex < buf.length ? buf[bufferIndex]! : 0;
  }

  function setOverride(bufferIndex: number, value: number) {
    engineStore.setOverride(bufferIndex, value);
  }

  function clearOverride(bufferIndex: number) {
    engineStore.clearOverride(bufferIndex);
  }

  function clearUniverseOverrides(universe: number) {
    engineStore.clearUniverseOverrides(universe);
  }

  function isOverridden(bufferIndex: number): boolean {
    return engineStore.overrideMap?.has(bufferIndex) ?? false;
  }

  return {
    buildChannelGroups,
    getLiveValue,
    setOverride,
    clearOverride,
    clearUniverseOverrides,
    isOverridden,
  };
}
