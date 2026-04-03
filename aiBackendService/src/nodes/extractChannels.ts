import { tool } from "@langchain/core/tools";
import { getHaikuModel } from "../model.js";
import type { ExtractionState } from "../state.js";
import { OflChannelSchema } from "../../../app/utils/ofl/schemas.js";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

// A system prompt explaining the task
const systemPrompt = `You are an expert at extracting DMX channel configurations from lighting fixture manuals.
Your task is to analyze the provided DMX charts and extract every single channel into a structured format.

IMPORTANT INSTRUCTIONS FOR REASONING AND LOGICAL DEDUCTION:
1. Before calling any tools, write a <thinking> block to carefully analyze the DMX chart. List all the channels you've found (e.g., 1. Dimmer, 2. Pan, 3. Tilt).
2. For each channel, check its capabilities (like Dimmer: 0-255, Strobe: 10-20) and properly plan the mapping.
3. CRITICAL: When extracting multiple ranges (capabilities) for a single channel (e.g., "Color Macros", "Internal Programs", "Built-in Effects", "Macros", "Strobe"), you MUST provide a descriptive label in the 'comment' or 'effectName' fields for EVERY capability. DO NOT leave the labels empty.
4. CRITICAL TYPE MAPPING:
   - For individual color channels like "Red", "Green", "Blue", "Amber", "White", "Cyan", etc., you MUST use the "ColorIntensity" type. DO NOT use "Custom".
   - For "Color Macro", "Static Color", or "Color Wheel" channels, you MUST use "ColorPreset" and try to provide HEX values in the 'colors' array.
   - For "Internal Programs", "Macros", "Built-in Effects", or "Auto Modes", you MUST use the "Effect" type and provide an 'effectName'.
5. Make logical choices if details are incomplete. Ensure standard names are used.
6. After you finish your <thinking> block, use the tool 'add_channel' to add your deduced channels. Call the tool ONCE for EACH identified channel.
Do not miss any channels or fine-grained capabilities.`;

export async function extractChannels(state: ExtractionState, config?: RunnableConfig): Promise<Partial<ExtractionState>> {
  await dispatchCustomEvent("status", { message: "Extracting DMX Channels..." }, config);

  const addChannelTool = tool(
    async (input) => JSON.stringify(input),
    {
      name: "add_channel",
      description: "Appends a DMX channel to the fixture. Call this tool multiple times (once for every channel in the DMX chart).",
      schema: OflChannelSchema
    }
  );

  const model = getHaikuModel().bindTools([addChannelTool]);

  const messages: (BaseMessage | { role: string; content: string })[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Please find all DMX channels in the following manual text and extract them by calling the 'add_channel' tool for every channel:\n\n${state.manualText}` }
  ];

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = (await model.invoke(messages)) as AIMessage;
    messages.push(response);

    const channels: any[] = [];
    let hasValidationErrors = false;

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        if (tc.name === "add_channel") {
          const parsed = OflChannelSchema.safeParse(tc.args);
          if (parsed.success) {
            channels.push(parsed.data);
            messages.push(new ToolMessage({
              tool_call_id: tc.id as string,
              name: tc.name,
              content: "Channel added successfully."
            }));
          } else {
            hasValidationErrors = true;
            messages.push(new ToolMessage({
              tool_call_id: tc.id as string,
              name: tc.name,
              content: `Validation Failed for channel. Please fix these issues and re-submit:\n${JSON.stringify(parsed.error.issues, null, 2)}`
            }));
          }
        }
      }

      if (!hasValidationErrors && channels.length > 0) {
        return { channels };
      }
    } else {
       messages.push({
        role: "user",
        content: "Please provide the DMX channels by calling the 'add_channel' tool for every channel found in the manual."
      });
    }
  }

  throw new Error("Failed to extract channels after 3 retries because of validation errors or missing tool calls.");
}
