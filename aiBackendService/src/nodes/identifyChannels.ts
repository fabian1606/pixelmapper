import { tool } from "@langchain/core/tools";
import { getHaikuModel } from "../model.js";
import type { ExtractionState } from "../state.js";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ToolMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { toGeminiJsonSchema } from "../utils/gemini-schema.js";
import { DynamicStructuredTool } from "@langchain/core/tools";

const IDENTIFIED_CAPABILITY_TYPES = [
  'NoFunction', 'ShutterStrobe', 'StrobeSpeed', 'StrobeDuration', 'Intensity', 'ColorIntensity',
  'ColorPreset', 'ColorTemperature', 'Pan', 'PanContinuous', 'Tilt', 'TiltContinuous', 'PanTiltSpeed',
  'WheelSlot', 'WheelShake', 'WheelSlotRotation', 'WheelRotation', 'Effect', 'EffectSpeed',
  'EffectDuration', 'EffectParameter', 'SoundSensitivity', 'BeamAngle', 'BeamPosition', 'Focus',
  'Zoom', 'Iris', 'IrisEffect', 'Frost', 'FrostEffect', 'Prism', 'PrismRotation', 'BladeInsertion',
  'BladeRotation', 'BladeSystemRotation', 'Fog', 'FogOutput', 'FogType', 'Rotation', 'Speed', 'Time',
  'Maintenance', 'Generic'
] as const;

const identifiedChannelSchema = z.object({
  name: z.string().describe("The name of the channel, e.g. 'Red', 'Dimmer', 'Pan'"),
  type: z.enum(IDENTIFIED_CAPABILITY_TYPES).describe("The exact Open Fixture Library capability type this channel represents.")
});

const IdentifyChannelsSchema = z.object({
  channels: z.array(identifiedChannelSchema).describe("List of identified channels and their exact capabilities")
});

export async function identifyChannels(state: ExtractionState, config?: LangGraphRunnableConfig): Promise<Partial<ExtractionState>> {
  config?.writer?.({ message: "Identifying DMX Channels..." });

  const geminiIdentifyJsonSchema = toGeminiJsonSchema(IdentifyChannelsSchema);

  const identifyTool = new DynamicStructuredTool({
    name: "identify_channels",
    description: "Identify all DMX channels and their specific capability types from the manual.",
    schema: geminiIdentifyJsonSchema as any,
    func: async (input: any) => JSON.stringify(input),
  });

  const IdentifyModel = getHaikuModel().bindTools([identifyTool]);
  
  const identifyMessages: BaseMessage[] = [
    { role: "system", content: "You are a DMX lighting expert. Analyze the manual and identify ALL DMX channels with their exact OFL capability types. Channel names MUST be in English (e.g. 'Master Dimmer', 'Red', 'Strobe', not German). Call 'identify_channels' ONCE with your complete findings. return all channels you found across all modes. dont leave any channels out." } as any,
    { role: "user", content: `Manual text:\n\n${state.manualText}` } as any
  ];

  let identifiedChannels: { name: string, type: string }[] = [];
  
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = (await IdentifyModel.invoke(identifyMessages)) as AIMessage;
    identifyMessages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      const tc = response.tool_calls.find(t => t.name === "identify_channels");
      if (tc) {
        const parsed = IdentifyChannelsSchema.safeParse(tc.args);
        if (parsed.success) {
          identifiedChannels = parsed.data.channels;
          break;
        } else {
          identifyMessages.push(new ToolMessage({
            tool_call_id: tc.id as string,
            name: tc.name,
            content: `Validation Failed. Fix these issues: ${JSON.stringify(parsed.error.issues)}`
          }));
        }
      }
    } else {
      identifyMessages.push({ role: "user", content: "Please call 'identify_channels'." } as any);
    }
  }

  if (identifiedChannels.length === 0) {
    throw new Error("Failed to identify any channels from the manual.");
  }

  return { identifiedChannels };
}
