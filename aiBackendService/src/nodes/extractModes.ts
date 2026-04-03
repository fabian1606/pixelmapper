import { tool } from "@langchain/core/tools";
import { getHaikuModel } from "../model.js";
import type { ExtractionState } from "../state.js";
import { OflModeSchema } from "../../../app/utils/ofl/schemas.js";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { RunnableConfig } from "@langchain/core/runnables";

const systemPrompt = `You are an expert at extracting DMX mode configurations from lighting fixture manuals.
Your task is to analyze the provided manual text and extract the available DMX Modes (e.g. '16 Channel Mode', '8 Channel Mode', 'Basic Mode', 'Extended Mode').

IMPORTANT INSTRUCTIONS FOR REASONING AND LOGICAL DEDUCTION:
1. Before calling any tool, you MUST write a <thinking> block to outline the distinct DMX Modes listed in the manual.
2. For each identified Mode, logically determine the exact sequence of channels it uses based on the text. Address any ambiguous parts logically.
3. Keep in mind: The channels array MUST contain strings that EXACTLY match the names of the channels you have previously extracted. 
4. If a channel within a mode is mapped to nothing or acts as a dummy/fine channel not present in your extracted list, simply omit it or use null (if allowed) to maintain the absolute channel offset order.
5. After your <thinking> analysis is complete, call the 'add_mode' tool ONCE for EACH mode found in the manual.`;

export async function extractModes(state: ExtractionState, config?: RunnableConfig): Promise<Partial<ExtractionState>> {
  await dispatchCustomEvent("status", { message: "Extracting DMX Modes..." }, config);

  const addModeTool = tool(
    async (input) => JSON.stringify(input),
    {
      name: "add_mode",
      description: "Appends a DMX Mode (e.g. '16 Channel Mode') to the fixture. Call this tool for every mode you find in the manual or tables.",
      schema: OflModeSchema
    }
  );

  const model = getHaikuModel().bindTools([addModeTool]);

  const channelNames = state.channels.map(c => c.name).filter(Boolean).join(", ");

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Available channels already extracted: [${channelNames}].\nPlease find all DMX Modes in this manual text and extract them by calling the add_mode tool:\n\n${state.manualText}` }
  ]);

  const modes: any[] = [];
  
  if (response.tool_calls && response.tool_calls.length > 0) {
    for (const tc of response.tool_calls) {
      if (tc.name === "add_mode") {
        modes.push(tc.args);
      }
    }
  }

  return {
    modes,
  };
}
