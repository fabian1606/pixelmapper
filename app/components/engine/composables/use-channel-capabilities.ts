import { computed, type Ref } from 'vue';
import type { OflCapability, OflWheel, OflWheelSlot } from '~/utils/ofl/types';
import type { ChannelType } from '~/utils/engine/types';

export function useChannelCapabilities(
  representativeChannel: Ref<any>,
  rawValue: Ref<number>,
  type: ChannelType
) {
  // ─── Wheel slot resolution ─────────────────────────────────────────────────────
  const oflWheels = computed<Record<string, OflWheel>>(
    () => representativeChannel.value?.oflWheels ?? {}
  );

  function resolveSlot(cap: OflCapability): OflWheelSlot | null {
    const wheelName = cap.wheel;
    if (!wheelName) return null;
    const wheel = oflWheels.value[wheelName];
    if (!wheel) return null;
    const slotIdx = (cap.slotNumber ?? 1) - 1;
    return wheel.slots[slotIdx] ?? null;
  }

  // ─── OFL Capabilities ─────────────────────────────────────────────────────────
  const capabilities = computed<OflCapability[]>(() =>
    representativeChannel.value?.oflCapabilities ?? []
  );

  const activeCapability = computed<OflCapability | null>(() => {
    const caps = capabilities.value;
    if (caps.length === 0) return null;
    if (caps.length === 1) return caps[0] ?? null;
    return caps.find(cap => {
      if (!cap.dmxRange) return false;
      return rawValue.value >= cap.dmxRange[0] && rawValue.value <= cap.dmxRange[1];
    }) ?? caps[0] ?? null;
  });

  function capabilityLabel(cap: OflCapability): string {
    if (cap.comment) return cap.comment;
    if (cap.shutterEffect) return cap.shutterEffect;
    if (cap.effectName) return cap.effectName;
    if (cap.effectPreset) return cap.effectPreset;

    if (cap.type === 'WheelSlot' || cap.type === 'WheelShake') {
      if (cap.slotNumberStart !== undefined && cap.slotNumberEnd !== undefined) {
        const wheelName = cap.wheel ?? '';
        const wheel = oflWheels.value[wheelName];
        if (wheel) {
          const a = wheel.slots[(cap.slotNumberStart - 1)]?.name ?? `Slot ${cap.slotNumberStart}`;
          const b = wheel.slots[(cap.slotNumberEnd - 1)]?.name ?? `Slot ${cap.slotNumberEnd}`;
          return `${a} → ${b}`;
        }
        return `Slot ${cap.slotNumberStart}–${cap.slotNumberEnd}`;
      }
      const slot = resolveSlot(cap);
      if (slot) return slot.name ?? slot.type;
      if (cap.slotNumber !== undefined) return `Slot ${cap.slotNumber}`;
    }

    if (cap.type === 'WheelRotation' || cap.type === 'WheelSlotRotation') {
      const dir = cap.speedStart?.includes('CW') ? 'CW' : cap.speedStart?.includes('CCW') ? 'CCW' : '';
      return dir ? `Rotation ${dir}` : 'Rotation';
    }

    if (cap.speedStart && cap.speedEnd) return `${cap.speedStart} → ${cap.speedEnd}`;
    return cap.type;
  }

  const activeSlotColor = computed<string | null>(() => {
    if (type !== 'COLOR_WHEEL') return null;
    const cap = activeCapability.value;
    if (!cap) return null;
    const slot = resolveSlot(cap);
    return slot?.colors?.[0] ?? null;
  });

  const activeCapabilityLabel = computed(() =>
    activeCapability.value ? capabilityLabel(activeCapability.value) : type.toLowerCase()
  );

  return {
    capabilities,
    activeCapability,
    resolveSlot,
    capabilityLabel,
    activeSlotColor,
    activeCapabilityLabel
  };
}
