import { type Ref } from 'vue';
import {
  CHANNEL_CAPABILITY_META,
  type ChannelDraft,
  type ModeDraft,
  type CapabilityRange,
} from '~/utils/engine/custom-fixture-types';
import type { ChannelType } from '~/utils/engine/types';

export function useChannelManagement(
  channels: Ref<ChannelDraft[]>,
  modes: Ref<ModeDraft[]>,
  selectedChannelId: Ref<string|null>
) {
  function addChannel() {
    const id = crypto.randomUUID();
    const ch: ChannelDraft = {
      id,
      name: `Channel ${channels.value.length + 1}`,
      capabilityType: 'DIMMER',
      resolution: '8bit',
      defaultValue: 0,
      capabilities: [{ rangeId: crypto.randomUUID(), dmxMin: 0, dmxMax: 255, type: 'DIMMER', label: '' } as CapabilityRange],
    };
    channels.value = [...channels.value, ch];
    selectedChannelId.value = id;
  }

  function deleteChannel(id: string) {
    channels.value = channels.value.filter(c => c.id !== id);
    modes.value = modes.value.map(m => ({
      ...m,
      entries: m.entries.filter(e => e.channelId !== id),
    }));
    if (selectedChannelId.value === id) selectedChannelId.value = null;
  }

  function patchChannel(id: string, patch: Partial<ChannelDraft>) {
    channels.value = channels.value.map(c => c.id === id ? { ...c, ...patch } : c);
  }

  function changeChannelType(id: string, newType: string, isSingleFullRange: boolean) {
    const ch = channels.value.find(c => c.id === id);
    if (!ch) return;
    const oldLabel = CHANNEL_CAPABILITY_META[ch.capabilityType]?.label ?? '';
    const newLabel = CHANNEL_CAPABILITY_META[newType as ChannelType]?.label ?? newType;
    const isAutoName = ch.name === oldLabel || /^Channel \d+$/.test(ch.name);
    
    const newCaps = isSingleFullRange
      ? [{ ...ch.capabilities[0]!, type: newType } as CapabilityRange]
      : ch.capabilities;

    patchChannel(id, {
      capabilityType: newType as any,
      capabilities: newCaps,
      ...(isAutoName ? { name: newLabel } : {}),
    });
  }

  return { addChannel, deleteChannel, patchChannel, changeChannelType };
}
