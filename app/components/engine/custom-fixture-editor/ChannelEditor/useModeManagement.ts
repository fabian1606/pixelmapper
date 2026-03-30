import { type Ref } from 'vue';
import {
  type ModeDraft,
  type ModeEntry,
  type ChannelDraft,
} from '~/utils/engine/custom-fixture-types';

export function useModeManagement(
  modes: Ref<ModeDraft[]>,
  activeModeIdx: Ref<number>,
  channels: Ref<ChannelDraft[]>,
  headCount: Ref<number>
) {
  const currentMode = () => modes.value[activeModeIdx.value] ?? modes.value[0];

  function updateMode(patch: Partial<ModeDraft>) {
    const cm = currentMode();
    if (!cm) return;
    modes.value = modes.value.map((m, i) =>
      i === activeModeIdx.value ? { ...m, ...patch } : m
    );
  }

  function addMode() {
    const id = crypto.randomUUID();
    modes.value = [...modes.value, { id, name: `Mode ${modes.value.length + 1}`, entries: [] }];
    activeModeIdx.value = modes.value.length - 1;
  }

  function addSingleToMode(channelId: string) {
    const cm = currentMode();
    if (!cm) return;
    const entry: ModeEntry = { entryId: crypto.randomUUID(), channelId, perHead: false, order: 'perPixel' };
    updateMode({ entries: [...cm.entries, entry] });
  }

  function removeEntry(entryId: string) {
    const cm = currentMode();
    updateMode({ entries: cm?.entries.filter(e => e.entryId !== entryId) ?? [] });
  }

  function patchEntry(entryId: string, patch: Partial<ModeEntry>) {
    const cm = currentMode();
    updateMode({
      entries: cm?.entries.map(e => e.entryId === entryId ? { ...e, ...patch } : e) ?? [],
    });
  }

  // --- DMX Address Helpers ---
  const channelMap = () => new Map(channels.value.map(c => [c.id, c]));
  const addrOf = (id: string) => channelMap().get(id)?.resolution === '16bit' ? 2 : 1;

  function entryStartAddress(idx: number): number {
    const entries = currentMode()?.entries ?? [];
    let addr = 1;
    let i = 0;
    while (i < entries.length) {
      const e = entries[i]!;
      if (!e.perHead) {
        if (i >= idx) break;
        addr += addrOf(e.channelId);
        i++;
      } else {
        const groupStart = i;
        let groupEnd = i;
        while (groupEnd < entries.length && entries[groupEnd]!.perHead) groupEnd++;
        if (idx < groupEnd) {
          for (let j = groupStart; j < idx; j++) addr += addrOf(entries[j]!.channelId);
          return addr;
        }
        let groupSize = 0;
        for (let j = groupStart; j < groupEnd; j++) groupSize += addrOf(entries[j]!.channelId);
        addr += groupSize * headCount.value;
        i = groupEnd;
      }
    }
    return addr;
  }

  return { updateMode, addMode, addSingleToMode, removeEntry, patchEntry, entryStartAddress, addrOf };
}
