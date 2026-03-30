import type { OflFixture, OflChannel, OflMode, OflCapability, OflWheel } from '~/utils/ofl/types';
import type { 
  CustomFixtureFormState, 
  ChannelDraft, 
  ModeDraft, 
  WheelDraft, 
  CapabilityRange, 
  OflCategory 
} from '~/utils/engine/custom-fixture-types';
import { resolveOflChannel } from '~/utils/ofl/capability-map';

export function buildOflFixture(
  state: CustomFixtureFormState,
  channels: ChannelDraft[],
  modes: ModeDraft[],
  wheels: WheelDraft[],
  category: OflCategory,
  pixelCols: number,
  pixelRows: number,
  customSvgData?: string | null
): OflFixture {
  const availableChannels: Record<string, OflChannel> = {};

  for (const ch of channels) {
    const caps: OflCapability[] = ch.capabilities.map(r => {
      const cap = { ...r } as any;
      if (cap.rangeId) delete cap.rangeId;
      if (cap.label) { cap.comment = cap.label; delete cap.label; }
      cap.dmxRange = [cap.dmxMin, cap.dmxMax];
      delete cap.dmxMin; delete cap.dmxMax;
      return cap as OflCapability;
    });

    availableChannels[ch.name] = {
      name: ch.name,
      defaultValue: ch.defaultValue,
      dmxValueResolution: ch.resolution,
      capabilities: caps.length > 0 ? caps : undefined,
    };
  }

  const oflModes: OflMode[] = modes.map(m => ({
    name: m.name,
    channels: m.entries.map(e => {
        const c = channels.find(c => c.id === e.channelId);
        return c ? c.name : null;
    })
  }));

  const oflWheels: Record<string, OflWheel> = {};
  for (const w of wheels) {
    oflWheels[w.name] = {
      slots: w.slots.map(s => ({
        type: s.type as any,
        name: s.name,
        colors: s.colors.length > 0 ? s.colors : undefined
      }))
    };
  }

  return {
    $schema: 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json',
    name: state.fixtureName,
    shortName: state.shortName || undefined,
    categories: [category],
    meta: {
      authors: ['Pixelmapper Custom Fixture Editor'],
      createDate: new Date().toISOString().split('T')[0]!,
      lastModifyDate: new Date().toISOString().split('T')[0]!,
    },
    comment: state.comment || undefined,
    physical: {
      dimensions: [state.fixtureWidth, state.fixtureHeight, state.fixtureDepth],
      weight: state.weight || undefined,
      power: state.power || undefined,
      DMXconnector: state.dmxConnector ? (state.dmxConnector as any) : undefined,
      bulb: state.bulbType || state.colorTemperature ? {
        type: state.bulbType || undefined,
        colorTemperature: state.colorTemperature || undefined
      } : undefined,
      lens: state.beamAngleMin || state.beamAngleMax ? {
        degreesMinMax: [state.beamAngleMin, state.beamAngleMax]
      } : undefined
    },
    availableChannels,
    modes: oflModes,
    wheels: Object.keys(oflWheels).length > 0 ? oflWheels : undefined
  };
}

export function initFromOflFixture(ofl: OflFixture) {
  const state: CustomFixtureFormState = {
    fixtureName: ofl.name,
    shortName: ofl.shortName || '',
    manufacturer: '',
    comment: ofl.comment || '',
    fixtureWidth: ofl.physical?.dimensions?.[0] || 30,
    fixtureHeight: ofl.physical?.dimensions?.[1] || 30,
    fixtureDepth: ofl.physical?.dimensions?.[2] || 30,
    weight: ofl.physical?.weight || 0,
    power: ofl.physical?.power || 0,
    dmxConnector: (ofl.physical?.DMXconnector || '') as any,
    bulbType: ofl.physical?.bulb?.type || '',
    colorTemperature: ofl.physical?.bulb?.colorTemperature || 0,
    beamAngleMin: ofl.physical?.lens?.degreesMinMax?.[0] || 0,
    beamAngleMax: ofl.physical?.lens?.degreesMinMax?.[1] || 0,
  };

  const category = (ofl.categories?.[0] as OflCategory) || 'Other';
  
  const channels: ChannelDraft[] = [];
  if (ofl.availableChannels) {
    for (const [key, ch] of Object.entries(ofl.availableChannels)) {
      const id = crypto.randomUUID();
      const capabilities: CapabilityRange[] = (ch.capabilities || ch.capability ? (ch.capabilities || [ch.capability]) : []).map((c: any) => {
        const copy = { ...c };
        copy.rangeId = crypto.randomUUID();
        if (c.dmxRange) {
          copy.dmxMin = c.dmxRange[0];
          copy.dmxMax = c.dmxRange[1];
        } else {
          copy.dmxMin = 0; copy.dmxMax = 255;
        }
        copy.label = c.comment || '';
        if (!copy.type) copy.type = 'GENERIC';
        return copy;
      });

      const mapped = resolveOflChannel(ch, key);

      channels.push({
        id,
        name: ch.name || key,
        capabilityType: mapped.type,
        resolution: ch.dmxValueResolution || '8bit',
        defaultValue: (ch.defaultValue as number) || 0,
        capabilities
      });
    }
  }

  const modes: ModeDraft[] = (ofl.modes || []).map((m, i) => ({
    id: `mode-${crypto.randomUUID()}`,
    name: m.name || `Mode ${i + 1}`,
    entries: (m.channels || []).map((cName) => {
      // Find the channel draft name by matching the string
      // In OFL, matrix channels might have templates like "Red $pixelKey", but custom editor
      // currently mostly supports 1:1 simple names.
      const draftChannel = channels.find(c => c.name === cName || c.name === cName?.toString());
      return {
        entryId: crypto.randomUUID(),
        channelId: draftChannel ? draftChannel.id : '',
        perHead: false,
        order: 'perPixel' as const
      };
    }).filter(e => !!e.channelId)
  }));

  const wheels: WheelDraft[] = [];
  if (ofl.wheels) {
    for (const [name, w] of Object.entries(ofl.wheels)) {
      const channelId = channels.find(c => c.name === name || c.capabilityType === 'COLOR_WHEEL' || c.capabilityType === 'GOBO_WHEEL')?.id || crypto.randomUUID();
      wheels.push({
        wheelId: crypto.randomUUID(),
        channelId,
        name,
        direction: w.direction as any,
        slots: (w.slots || []).map(s => ({
          slotId: crypto.randomUUID(),
          type: s.type as any,
          name: s.name || '',
          colors: s.colors || []
        }))
      });
    }
  }

  return { state, channels, modes, wheels, category, pixelCols: 1, pixelRows: 1 };
}
