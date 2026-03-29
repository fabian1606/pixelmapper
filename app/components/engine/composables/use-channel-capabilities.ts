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
    const c = cap as Record<string, unknown>;
    const wheelName = c.wheel as string | undefined;
    if (!wheelName) return null;
    const wheel = oflWheels.value[wheelName];
    if (!wheel) return null;
    const slotIdx = ((c.slotNumber as number | undefined) ?? 1) - 1;
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
    const c = cap as Record<string, unknown>;
    if (cap.comment) return cap.comment;
    if (c.shutterEffect) return c.shutterEffect as string;
    if (c.effectName) return c.effectName as string;
    if (c.effectPreset) return c.effectPreset as string;

    if (cap.type === 'WheelSlot' || cap.type === 'WheelShake') {
      const slotNumberStart = c.slotNumberStart as number | undefined;
      const slotNumberEnd = c.slotNumberEnd as number | undefined;
      if (slotNumberStart !== undefined && slotNumberEnd !== undefined) {
        const wheelName = (c.wheel as string | undefined) ?? '';
        const wheel = oflWheels.value[wheelName];
        if (wheel) {
          const a = wheel.slots[(slotNumberStart - 1)]?.name ?? `Slot ${slotNumberStart}`;
          const b = wheel.slots[(slotNumberEnd - 1)]?.name ?? `Slot ${slotNumberEnd}`;
          return `${a} → ${b}`;
        }
        return `Slot ${slotNumberStart}–${slotNumberEnd}`;
      }
      const slot = resolveSlot(cap);
      if (slot) return slot.name ?? slot.type;
      const slotNumber = c.slotNumber as number | undefined;
      if (slotNumber !== undefined) return `Slot ${slotNumber}`;
    }

    if (cap.type === 'WheelRotation' || cap.type === 'WheelSlotRotation') {
      const speedStart = c.speedStart as string | undefined;
      const dir = speedStart?.includes('CW') ? 'CW' : speedStart?.includes('CCW') ? 'CCW' : '';
      return dir ? `Rotation ${dir}` : 'Rotation';
    }

    const speedStart = c.speedStart as string | undefined;
    const speedEnd = c.speedEnd as string | undefined;
    if (speedStart && speedEnd) return `${speedStart} → ${speedEnd}`;
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
