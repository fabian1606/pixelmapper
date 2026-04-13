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
  const headCountManual = ref(1);
  const useCustomSvg = ref(false);
  const customSvgData = ref<string | null>(null);
  const customSvgError = ref<string | null>(null);
  const activeHeadKey = ref('head-1');
  const headToElementMap = ref<Record<string, string>>({});

  const suggestedMapping = ref<Record<string, string>>({});
  const isPreviewingMapping = ref(false);
  const hoveredElementId = ref<string | null>(null);
  const hoveredHeadKey = ref<string | null>(null);

  const headCount = computed(() => Math.max(1, Math.floor(headCountManual.value)));

  const suggestedMappingIds = computed(() => Object.values(suggestedMapping.value));

  const highlightedElementIds = computed(() => Object.values(headToElementMap.value));
  const headKeys = computed(() =>
    Array.from({ length: headCount.value }, (_, i) => `head-${i + 1}`),
  );

  watch(headCount, (count) => {
    const nextMap: Record<string, string> = {};
    for (let i = 1; i <= count; i++) {
      const key = `head-${i}`;
      if (headToElementMap.value[key]) nextMap[key] = headToElementMap.value[key]!;
    }
    headToElementMap.value = nextMap;
    if (Number.parseInt(activeHeadKey.value.replace('head-', ''), 10) > count) {
      activeHeadKey.value = 'head-1';
    }

    // New: Trigger auto-map calculation on headCount change if SVG is loaded
    if (customSvgData.value) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(customSvgData.value, 'image/svg+xml');
        autoMapHeadsFromSvg(doc);
    }
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
  function parseSvgLength(raw: string | null): number | null {
    if (!raw) return null;
    const parsed = Number.parseFloat(raw.replace(/[a-z%]+$/i, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function normalizeSvgDocument(doc: Document) {
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error('Invalid SVG format.');

    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
      throw new Error('File is not a valid SVG root element.');
    }

    // Remove script tags and inline event handlers for safer rendering.
    for (const script of Array.from(svgEl.querySelectorAll('script'))) script.remove();
    for (const node of Array.from(svgEl.querySelectorAll('*'))) {
      for (const attr of Array.from(node.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
      }
    }

    if (!svgEl.getAttribute('viewBox')) {
      const width = parseSvgLength(svgEl.getAttribute('width'));
      const height = parseSvgLength(svgEl.getAttribute('height'));
      if (width && height) svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    const shapes = svgEl.querySelectorAll('path, circle, rect, polygon, ellipse, line, polyline');
    let counter = 0;
    shapes.forEach((shape) => {
      if (!shape.id) shape.id = `svg-shape-${counter++}-${Math.random().toString(36).slice(2, 7)}`;
    });
  }

  function autoMapHeadsFromSvg(doc: Document) {
    const shapes = Array.from(
      doc.querySelectorAll('path, circle, rect, polygon, ellipse, line, polyline'),
    );
    const shapeIds = shapes.map(el => el.id).filter(Boolean);
    const targetCount = headCount.value;

    if (shapeIds.length === 0) {
      suggestedMapping.value = {};
      return;
    }

    interface Pattern {
      ids: string[];
      score: number; // Higher is better
    }

    const candidates: Pattern[] = [];

    // --- Heuristic 1: Sequential IDs (Enhanced) ---
    const parsedIds = shapeIds.map(id => {
      const match = id.match(/\d+$/) || id.match(/\d+/);
      const num = match ? parseInt(match[0], 10) : Infinity;
      return { id, num };
    });

    // Find groups of IDs sharing the same non-numeric prefix
    const prefixedGroups: Record<string, string[]> = {};
    shapeIds.forEach(id => {
      const prefix = id.replace(/\d+$/, '');
      if (!prefixedGroups[prefix]) prefixedGroups[prefix] = [];
      prefixedGroups[prefix].push(id);
    });

    for (const [prefix, ids] of Object.entries(prefixedGroups)) {
      if (ids.length >= 2) {
        // Sort these IDs numerically
        const sorted = [...ids].sort((a, b) => {
          const na = parseInt(a.match(/\d+$/)?.[0] || '0', 10);
          const nb = parseInt(b.match(/\d+$/)?.[0] || '0', 10);
          return na - nb;
        });
        candidates.push({
          ids: sorted,
          score: (sorted.length === targetCount ? 100 : 50) + (sorted.length > 5 ? 20 : 0)
        });
      }
    }

    // --- Heuristic 2: Group Structure analysis ---
    const groups = Array.from(doc.querySelectorAll('g'));
    groups.forEach(g => {
      const gShapes = Array.from(g.querySelectorAll('path, circle, rect, polygon, ellipse, line, polyline'));
      const ids = gShapes.map(s => s.id).filter(Boolean);
      if (ids.length >= 2) {
        candidates.push({
          ids,
          score: (ids.length === targetCount ? 90 : 40) + (ids.length > 5 ? 30 : 0)
        });
      }
    });

    // --- Heuristic 3: Dominant Shape analysis ---
    const tags = ['path', 'circle', 'rect', 'polygon', 'ellipse', 'line', 'polyline'];
    tags.forEach(tag => {
      const taggedIds = shapes.filter(s => s.tagName.toLowerCase() === tag).map(s => s.id).filter(Boolean);
      if (taggedIds.length >= 2) {
        candidates.push({
          ids: taggedIds,
          score: (taggedIds.length === targetCount ? 80 : 30) + (taggedIds.length > 5 ? 10 : 0)
        });
      }
    });

    // --- Pattern Picker & Filtering ---
    // Filter by user rule: pattern > 5 OR pattern === headCount
    const validCandidates = candidates.filter(c => c.ids.length > 5 || c.ids.length === targetCount);

    if (validCandidates.length === 0) {
      suggestedMapping.value = {};
      return;
    }

    // Pick top candidate
    validCandidates.sort((a, b) => {
      // Preference: exact match > size difference > raw score
      const diffA = Math.abs(a.ids.length - targetCount);
      const diffB = Math.abs(b.ids.length - targetCount);
      if (diffA !== diffB) return diffA - diffB;
      return b.score - a.score;
    });

    const best = validCandidates[0];
    const nextMap: Record<string, string> = {};
    // Map ONLY up to either targetCount or the best pattern length
    const mapLimit = Math.min(best.ids.length, targetCount);

    for (let i = 0; i < mapLimit; i++) {
      const headKey = `head-${i + 1}`;
      nextMap[headKey] = best.ids[i]!;
    }

    suggestedMapping.value = nextMap;
  }

  function applySuggestedMapping() {
    headToElementMap.value = { ...suggestedMapping.value };
    suggestedMapping.value = {};
    activeHeadKey.value = 'head-1';
  }

  function clearSuggestedMapping() {
    suggestedMapping.value = {};
  }

  function handleUploadSvg(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');
        normalizeSvgDocument(doc);
        autoMapHeadsFromSvg(doc);
        customSvgData.value = new XMLSerializer().serializeToString(doc.documentElement);
        customSvgError.value = null;
        useCustomSvg.value = true;
        activeHeadKey.value = 'head-1';
      } catch (err) {
        console.error('Error parsing uploaded SVG:', err);
        customSvgData.value = null;
        customSvgError.value = err instanceof Error ? err.message : 'SVG could not be parsed.';
      }
    };
    reader.readAsText(file);
  }

  function assignElementToActiveHead(elementId: string) {
    const currentHead = activeHeadKey.value;
    if (!currentHead) return;
    if (!elementId) return;

    // If the current head already points to this element, keep state unchanged.
    if (headToElementMap.value[currentHead] === elementId) return;

    // Do not steal assignments from other heads.
    const alreadyAssignedTo = Object.entries(headToElementMap.value).find(
      ([headKey, mappedElementId]) => headKey !== currentHead && mappedElementId === elementId,
    )?.[0];
    if (alreadyAssignedTo) return;

    const nextMap: Record<string, string> = { ...headToElementMap.value };
    nextMap[currentHead] = elementId;
    headToElementMap.value = nextMap;

    // Auto-advance to the next head after assignment.
    const currentIndex = headKeys.value.indexOf(currentHead);
    if (currentIndex >= 0 && currentIndex < headKeys.value.length - 1) {
      activeHeadKey.value = headKeys.value[currentIndex + 1]!;
    }
  }

  function clearHeadAssignment(headKey: string) {
    if (!headToElementMap.value[headKey]) return;
    const nextMap: Record<string, string> = { ...headToElementMap.value };
    delete nextMap[headKey];
    headToElementMap.value = nextMap;
  }

  function setUseCustomSvg(enabled: boolean) {
    useCustomSvg.value = enabled;
    if (!enabled) {
      activeHeadKey.value = 'head-1';
    }
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
    headCountManual,
    useCustomSvg,
    customSvgData,
    customSvgError,
    activeHeadKey,
    headToElementMap,
    suggestedMapping,
    suggestedMappingIds,
    isPreviewingMapping,
    hoveredElementId,
    hoveredHeadKey,
    headKeys,
    highlightedElementIds,
    headCount,
    handleUploadSvg,
    assignElementToActiveHead,
    clearHeadAssignment,
    setUseCustomSvg,
    applySuggestedMapping,
    clearSuggestedMapping,
  };
}
