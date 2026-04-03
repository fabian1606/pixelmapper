import type { ExtractionState } from "../state.js";
import type { OflFixture, OflChannel, OflMode } from "../../../app/utils/ofl/types.js";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { RunnableConfig } from "@langchain/core/runnables";

export async function assembleOflDocument(state: ExtractionState, config?: RunnableConfig): Promise<Partial<ExtractionState>> {
  await dispatchCustomEvent("status", { message: "Assembling OFL Document..." }, config);

  const gen = state.generalInfo || {};
  
  // Create physical object
  const physical: any = {};
  
  if (gen.fixtureWidth !== undefined && gen.fixtureHeight !== undefined && gen.fixtureDepth !== undefined) {
    physical.dimensions = [gen.fixtureWidth, gen.fixtureHeight, gen.fixtureDepth];
  }
  if (gen.weight) physical.weight = gen.weight;
  if (gen.power) physical.power = gen.power;
  if (gen.dmxConnector) physical.DMXconnector = gen.dmxConnector;
  
  if (gen.bulbType || gen.colorTemperature) {
    physical.bulb = {};
    if (gen.bulbType) physical.bulb.type = gen.bulbType;
    if (gen.colorTemperature) physical.bulb.colorTemperature = gen.colorTemperature;
  }
  
  if (gen.beamAngleMin !== undefined || gen.beamAngleMax !== undefined) {
    physical.lens = {
      degreesMinMax: [gen.beamAngleMin || 0, gen.beamAngleMax || 0]
    };
  }

  // Convert channels to dictionary
  const availableChannels: Record<string, OflChannel> = {};
  state.channels.forEach((ch, idx) => {
    // LLM might specify name, if not, fallback
    const channelName = ch.name || `Channel ${idx + 1}`;
    availableChannels[channelName] = ch;
  });

  // Ensure mode channels refer to existing availableChannels
  const validModes = state.modes.map((mode) => {
    return {
      ...mode,
      channels: mode.channels.map((cName: string | null) => {
        if (!cName) return null;
        if (typeof cName === "string" && availableChannels[cName]) return cName;
        return null;
      }),
    };
  });

  const today = new Date().toISOString().split('T')[0] as string;

  const oflDocument: OflFixture = {
    $schema: "https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json",
    name: gen.fixtureName || "AI Extracted Fixture",
    shortName: gen.shortName || "AI_Fix",
    categories: gen.category ? [gen.category] : ["Other"],
    meta: {
      authors: ["AI Assistant"],
      createDate: today,
      lastModifyDate: today,
    },
    comment: gen.comment,
    physical: Object.keys(physical).length > 0 ? physical : undefined,
    availableChannels,
    modes: validModes.length > 0 ? validModes : [{ name: "Default Mode", channels: [] }],
  };

  return {
    ...state,
    // Add OFL Document to state using 'oflDocument' or 'generalInfo' overload?
    // Wait, let's just create an oflDocument in the state.
    // I should update state.ts to allow `oflDocument`
    oflDocument,
  } as Partial<ExtractionState>;
}
