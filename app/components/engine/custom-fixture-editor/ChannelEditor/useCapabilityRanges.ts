import { type Ref } from 'vue';
import {
  type ChannelDraft,
  type CapabilityRange,
} from '~/utils/engine/custom-fixture-types';

export function useCapabilityRanges(
  channels: Ref<ChannelDraft[]>,
  patchChannel: (id: string, patch: Partial<ChannelDraft>) => void
) {
  function addCapabilityRange(channelId: string, isSingleFullRange: boolean) {
    const channel = channels.value.find(c => c.id === channelId);
    if (!channel) return;
    
    const existing = channel.capabilities;
    const splitAt = Math.round(255 / 2);
    const lastMax = existing.length > 0 ? existing[existing.length - 1]!.dmxMax : -1;
    const newMin = isSingleFullRange ? splitAt : Math.min(lastMax + 1, 255);
    
    const newRange = {
      rangeId: crypto.randomUUID(), dmxMin: newMin, dmxMax: 255,
      type: channel.capabilityType, label: '',
    } as CapabilityRange;

    const updated = existing.map((r, i) =>
      i === existing.length - 1 ? { ...r, dmxMax: Math.max(newMin - 1, r.dmxMin) } : r
    );
    patchChannel(channelId, { capabilities: [...updated, newRange] });
  }

  function removeCapabilityRange(channelId: string, rangeId: string) {
    const channel = channels.value.find(c => c.id === channelId);
    if (!channel) return;

    const caps = channel.capabilities.filter(r => r.rangeId !== rangeId);
    if (caps.length === 0) {
      patchChannel(channelId, { 
        capabilities: [{ rangeId: crypto.randomUUID(), dmxMin: 0, dmxMax: 255, type: channel.capabilityType, label: '' } as CapabilityRange] 
      });
    } else if (caps.length === 1) {
      patchChannel(channelId, { capabilities: [{ ...caps[0]!, dmxMin: 0, dmxMax: 255 }] });
    } else {
      patchChannel(channelId, { capabilities: caps });
    }
  }

  function patchRange(channelId: string, rangeId: string, patch: Record<string, unknown>) {
    const channel = channels.value.find(c => c.id === channelId);
    if (!channel) return;
    patchChannel(channelId, {
      capabilities: channel.capabilities.map(r =>
        r.rangeId === rangeId ? { ...r, ...patch } as CapabilityRange : r
      ),
    });
  }

  function onRangeMaxChange(channelId: string, rangeId: string, newMax: number) {
    const channel = channels.value.find(c => c.id === channelId);
    if (!channel) return;
    const caps = [...channel.capabilities];
    const idx = caps.findIndex(r => r.rangeId === rangeId);
    if (idx < 0) return;
    caps[idx] = { ...caps[idx]!, dmxMax: newMax };
    if (idx + 1 < caps.length) {
      caps[idx + 1] = { ...caps[idx + 1]!, dmxMin: Math.min(newMax + 1, 255) };
    }
    patchChannel(channelId, { capabilities: caps });
  }

  return { addCapabilityRange, removeCapabilityRange, patchRange, onRangeMaxChange };
}
