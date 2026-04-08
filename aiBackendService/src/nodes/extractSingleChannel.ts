import { z } from "zod";
import { OflChannelSchema, OflCapabilitySchema, type OflCapabilityType } from "../../../app/utils/ofl/schemas.js";
import { toGeminiJsonSchema } from "../utils/gemini-schema.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { getHaikuModel } from "../model.js";
import { BaseMessage, ToolMessage, type AIMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { ExtractionState } from "../state.js";

// ─── Capability base fields shared by all variants ───────────────────────────

const CapabilityBase = {
  dmxRange: z.tuple([z.number().int(), z.number().int()])
    .describe("REQUIRED when using capabilities array. [startDMX, endDMX], e.g. [0, 127]. Must cover 0–255 without gaps."),
  comment: z.string().optional(),
};

/**
 * Builds a simplified, type-specific channel schema for Gemini.
 *
 * Instead of sending the full 43-option discriminated union (which Gemini
 * Flash-Lite misinterprets), we build a schema that contains only the single
 * capability variant relevant to this channel. This eliminates ambiguity and
 * produces reliable, valid outputs.
 */
function buildChannelSchemaForType(capabilityType: OflCapabilityType): z.ZodTypeAny {
  // Select the single capability schema for this channel type
  const capabilitySchema = buildCapabilitySchemaForType(capabilityType);

  return z.object({
    capability: capabilitySchema.optional()
      .describe("Use this (singular) ONLY when the entire 0–255 range is one single function."),
    capabilities: z.array(capabilitySchema)
      .optional()
      .describe("Use this (array) when the channel has multiple DMX sub-ranges. Each item MUST have a dmxRange covering its slice of 0–255."),
  });
}

function buildCapabilitySchemaForType(capabilityType: OflCapabilityType): z.ZodTypeAny {
  switch (capabilityType) {
    case "NoFunction":
      return z.object({
        type: z.literal("NoFunction").describe('MUST be exactly "NoFunction"'),
        ...CapabilityBase,
      });

    case "Intensity":
      return z.object({
        type: z.literal("Intensity").describe('MUST be exactly "Intensity". For master dimmer / brightness channels.'),
        brightness: z.string().optional().describe('e.g. "0%", "100%"'),
        brightnessStart: z.string().optional(),
        brightnessEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "ColorIntensity":
      return z.object({
        type: z.literal("ColorIntensity").describe('MUST be exactly "ColorIntensity"'),
        color: z.enum(["Red", "Green", "Blue", "Cyan", "Magenta", "Yellow", "Amber", "White", "Warm White", "Cold White", "UV", "Lime", "Indigo"])
          .describe('MUST be exactly one of: "Red", "Green", "Blue", "Cyan", "Magenta", "Yellow", "Amber", "White", "Warm White", "Cold White", "UV", "Lime", "Indigo". Case-sensitive.'),
        brightness: z.string().optional(),
        brightnessStart: z.string().optional(),
        brightnessEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "ShutterStrobe":
      return z.object({
        type: z.literal("ShutterStrobe").describe('MUST be exactly "ShutterStrobe"'),
        shutterEffect: z.enum(["Open", "Closed", "Strobe", "Pulse", "RampUp", "RampDown", "RampUpDown", "Lightning", "Spikes", "Burst"])
          .describe('MUST be exactly one of: "Open", "Closed", "Strobe", "Pulse", "RampUp", "RampDown", "RampUpDown", "Lightning", "Spikes", "Burst". Use "Open" for lamp-on, "Closed" for blackout, "Strobe" for blinking.'),
        speed: z.string().optional(),
        speedStart: z.string().optional(),
        speedEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "ColorPreset":
      return z.object({
        type: z.literal("ColorPreset").describe('MUST be exactly "ColorPreset". For color macro / color wheel / static color preset channels.'),
        comment: z.string().optional().describe("Name of the color preset, e.g. \"Red\", \"Ocean Blue\""),
        colors: z.array(z.string()).optional().describe("HEX colors for this preset, e.g. [\"#FF0000\"]"),
        colorsStart: z.array(z.string()).optional(),
        colorsEnd: z.array(z.string()).optional(),
        dmxRange: z.tuple([z.number().int(), z.number().int()])
          .describe("REQUIRED when using capabilities array."),
      });

    case "Effect":
      return z.object({
        type: z.literal("Effect").describe('MUST be exactly "Effect". For internal programs, built-in effects, macros.'),
        effectName: z.string().optional().describe("Descriptive name of the effect/program, e.g. \"Color Jump\", \"Program 1\""),
        effectPreset: z.enum(["ColorJump", "ColorFade"]).optional(),
        speed: z.string().optional(),
        speedStart: z.string().optional(),
        speedEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "Pan":
      return z.object({
        type: z.literal("Pan").describe('MUST be exactly "Pan"'),
        angle: z.string().optional(),
        angleStart: z.string().optional(),
        angleEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "Tilt":
      return z.object({
        type: z.literal("Tilt").describe('MUST be exactly "Tilt"'),
        angle: z.string().optional(),
        angleStart: z.string().optional(),
        angleEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "Zoom":
      return z.object({
        type: z.literal("Zoom").describe('MUST be exactly "Zoom"'),
        angle: z.string().optional(),
        angleStart: z.string().optional(),
        angleEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "Focus":
      return z.object({
        type: z.literal("Focus").describe('MUST be exactly "Focus"'),
        distance: z.string().optional(),
        distanceStart: z.string().optional(),
        distanceEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "Rotation":
      return z.object({
        type: z.literal("Rotation").describe('MUST be exactly "Rotation"'),
        speed: z.string().optional(),
        speedStart: z.string().optional(),
        speedEnd: z.string().optional(),
        angle: z.string().optional(),
        angleStart: z.string().optional(),
        angleEnd: z.string().optional(),
        ...CapabilityBase,
      });

    case "Generic":
      return z.object({
        type: z.literal("Generic").describe('MUST be exactly "Generic"'),
        ...CapabilityBase,
      });

    case "Maintenance":
      return z.object({
        type: z.literal("Maintenance").describe('MUST be exactly "Maintenance"'),
        parameter: z.string().optional(),
        hold: z.string().optional(),
        ...CapabilityBase,
      });

    default: {
      // Fallback: extract the matching option from the full discriminated union.
      // In Zod v4, _def.shape is a plain object (not a function).
      const options = OflCapabilitySchema.options as z.ZodTypeAny[];
      const match = options.find((opt: any) => {
        const shape = opt._def?.shape ?? opt._def?.shape;
        const typeField = shape?.type;
        return typeField?._def?.value === capabilityType;
      });
      return match ?? z.object({ type: z.literal(capabilityType as any), ...CapabilityBase });
    }
  }
}

export interface SingleChannelExtractionState {
  channelToExtract: { name: string; type: string };
  manualText: string;
}

// Global semaphore for map-reduce limits natively inside JS engine
class Semaphore {
  private tasks: (() => void)[] = [];
  private count: number;

  constructor(count: number) {
    this.count = count;
  }

  async acquire() {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }

  release() {
    if (this.tasks.length > 0) {
      const next = this.tasks.shift();
      if (next) next();
    } else {
      this.count++;
    }
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Limit concurrency to avoid exhausting the 4M token/min quota on large fixtures
const concurrencyLimit = new Semaphore(4);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Extracts the retry delay in ms from a Gemini 429 error message, e.g. "retry in 4.049s" */
function parseRetryDelay(message?: string): number | null {
  const match = message?.match(/retry[^0-9]*(\d+(?:\.\d+)?)\s*s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : null;
}


export async function extractSingleChannel(state: SingleChannelExtractionState, config?: LangGraphRunnableConfig): Promise<Partial<ExtractionState>> {
  const channel = state.channelToExtract;

  config?.writer?.({ message: `Queued: ${channel.name} (${channel.type})` });
  console.log(`[extractSingleChannel] Queuing: ${channel.name}`);

  return await concurrencyLimit.use(async () => {
    config?.writer?.({ message: `Extracting: ${channel.name}...` });
    console.log(`[extractSingleChannel] Extracting: ${channel.name}`);

    // Build a type-specific schema to avoid sending all 43 union options to Gemini.
    // Flash-Lite gets confused by large discriminated unions and returns invalid type values.
    const channelType = channel.type as OflCapabilityType;
    const targetedSchema = buildChannelSchemaForType(channelType);
    const geminiSchema = toGeminiJsonSchema(targetedSchema);

    const extractTool = new DynamicStructuredTool({
      name: "extract_single_channel",
      description: `Extract capabilities for the DMX channel "${channel.name}" (capability type: ${channel.type}).`,
      schema: geminiSchema as any,
      func: async (input: any) => JSON.stringify(input),
    });

    const singleModel = getHaikuModel().bindTools([extractTool]);

    const singleMessages: BaseMessage[] = [
      {
        role: "system",
        content: `You are a DMX lighting expert. Extract the channel configuration for the '${channel.name}' channel.

CRITICAL RULES:
1. LANGUAGE: All text fields (names, comments, effectName, etc.) MUST be in English.
2. FULL RANGE COVERAGE: The 'capabilities' array MUST cover the ENTIRE 0–255 DMX range without gaps.
   - Every value from 0 to 255 must be covered by a capability's dmxRange.
   - If the manual says a range is "no function" or unused, you MUST still include it as a capability with type "${channel.type}" (use a neutral/default value).
   - Example of correct: [{type:'${channel.type}',dmxRange:[0,9],...}, {type:'${channel.type}',dmxRange:[10,255],...}]
   - Example of WRONG (gap at start): [{type:'${channel.type}',dmxRange:[10,255]}]
3. CAPABILITY TYPE: The type field MUST be exactly "${channel.type}" for ALL capabilities — no other value.
4. Use single capability (not array) only if the entire 0-255 range is one single function.`
      } as any,
      {
        role: "user",
        content: `Extract channel '${channel.name}' (type: ${channel.type}) from this manual. Call 'extract_single_channel':\n\n${state.manualText}`
      } as any
    ];

    for (let attempt = 0; attempt < 3; attempt++) {
      let response: AIMessage;
      try {
        response = await singleModel.invoke(singleMessages) as AIMessage;
      } catch (err: any) {
        // Retry after rate-limit with the suggested delay (or 10s fallback)
        if (err?.status === 429 || err?.message?.includes("429")) {
          const retryMs = parseRetryDelay(err?.message) ?? 10_000;
          console.warn(`[extractSingleChannel] Rate limited on ${channel.name}, retrying in ${retryMs}ms...`);
          await sleep(retryMs);
          attempt--; // don't consume the attempt slot
          continue;
        }
        throw err;
      }
      singleMessages.push(response);

      if (response.tool_calls && response.tool_calls.length > 0) {
        const tc = response.tool_calls.find(t => t.name === "extract_single_channel");
        if (tc) {
          // Validate against the full OflChannelSchema for correctness guarantees
          const parsed = OflChannelSchema.safeParse(tc.args);
          if (parsed.success) {
            const data = parsed.data as any;
            if (!data.name) data.name = channel.name;
            console.log(`[extractSingleChannel] Done: ${channel.name}`);
            return { channels: [data] };
          } else {
            console.error(`[extractSingleChannel] Validation error for ${channel.name}:`, JSON.stringify(parsed.error.issues, null, 2));
            singleMessages.push(new ToolMessage({
              tool_call_id: tc.id as string,
              name: tc.name,
              content: `Validation Failed. Fix these issues: ${JSON.stringify(parsed.error.issues)}`
            }));
          }
        }
      } else {
        singleMessages.push({ role: "user", content: "Please call 'extract_single_channel' with the extracted details." } as any);
      }
    }

    console.warn(`[AI Backend] Failed to extract channel ${channel.name} after retries.`);
    return { channels: [] };
  });
}
