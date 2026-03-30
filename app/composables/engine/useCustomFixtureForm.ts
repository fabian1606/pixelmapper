import { ref, reactive, computed, watch } from 'vue';
import {
  FIXTURE_CATEGORIES,
  WHEEL_CAPABILITY_TYPES,
  type OflCategory,
  type CustomFixtureFormState,
  type ChannelDraft,
  type ModeDraft,
  type WheelDraft,
} from '~/utils/engine/custom-fixture-types';

export function useCustomFixtureForm() {
  const formState = reactive<CustomFixtureFormState>({
    fixtureName: '',
    shortName: '',
    manufacturer: '',
    comment: '',
    fixtureWidth: 30,
    fixtureHeight: 30,
    fixtureDepth: 30,
    weight: 0,
    power: 0,
    dmxConnector: '',
    bulbType: '',
    colorTemperature: 0,
    beamAngleMin: 0,
    beamAngleMax: 0,
  });

  const channels = ref<ChannelDraft[]>([]);
  const modes = ref<ModeDraft[]>([{ id: 'default', name: 'Default', entries: [] }]);
  const selectedChannelId = ref<string | null>(null);
  const wheels = ref<WheelDraft[]>([]);

  const channelsRaw = ref('1');
  const fixtureCategory = ref<OflCategory>('Moving Head');
  const pixelColumns = ref(8);
  const pixelRows = ref(4);
  const customSvgData = ref<string | null>(null);
  const headSelections = ref<string[]>([]);

  const headCount = computed(() => {
    const mode = FIXTURE_CATEGORIES[fixtureCategory.value].renderMode;
    if (mode === 'bar') return pixelColumns.value;
    if (mode === 'matrix') return pixelColumns.value * pixelRows.value;
    return 1;
  });

  // ─── Auto-manage Wheels ───────────────────────────────────────────────────
  watch(
    () => channels.value.filter(c => WHEEL_CAPABILITY_TYPES.has(c.capabilityType)),
    (wheelChannels) => {
      const existingIds = new Set(wheels.value.map(w => w.channelId));
      for (const ch of wheelChannels) {
        if (!existingIds.has(ch.id)) {
          wheels.value.push({
            wheelId: crypto.randomUUID(),
            channelId: ch.id,
            name: ch.name,
            direction: undefined,
            slots: [{ slotId: crypto.randomUUID(), type: 'Open', name: 'Open', colors: [] }],
          });
        }
      }
      const activeIds = new Set(wheelChannels.map(c => c.id));
      wheels.value = wheels.value.filter(w => activeIds.has(w.channelId));
    },
    { deep: true }
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────
  function handleUploadSvg(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');
        const shapes = doc.querySelectorAll('path, circle, rect, polygon, ellipse, g');
        let counter = 0;
        shapes.forEach(shape => {
          if (!shape.id) shape.id = `svg-shape-${counter++}-${Math.random().toString(36).slice(2, 7)}`;
        });
        customSvgData.value = new XMLSerializer().serializeToString(doc.documentElement);
        headSelections.value = [];
      } catch (err) {
        console.error('Error parsing uploaded SVG:', err);
        customSvgData.value = result;
      }
    };
    reader.readAsText(file);
  }

  function handleToggleHeadSelection(id: string) {
    const idx = headSelections.value.indexOf(id);
    if (idx >= 0) headSelections.value.splice(idx, 1);
    else headSelections.value.push(id);
  }

  return {
    formState,
    channels,
    modes,
    selectedChannelId,
    wheels,
    channelsRaw,
    fixtureCategory,
    pixelColumns,
    pixelRows,
    customSvgData,
    headSelections,
    headCount,
    handleUploadSvg,
    handleToggleHeadSelection,
  };
}
