import type { ExtractionState } from "../state.js";
import { getHaikuModel } from "../model.js";
import { CustomFixtureFormSchema } from "../../../app/utils/engine/custom-fixture-types.ts";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

// A system prompt explaining the task
const systemPrompt = `You are an expert at extracting lighting fixture definitions from user manuals.
Your task is to extract all the required general and physical information of the fixture according to the provided schema.

IMPORTANT INSTRUCTIONS FOR CATEGORIZATION:
1. Carefully read the manual to determine the fixture's primary classification.
2. If the fixture is an LED wash/PAR/bar that can change color but does NOT move (no Pan/Tilt), you MUST select "Color Changer". 
3. If the fixture has motorized Pan/Tilt, it is a "Moving Head". 
4. Read the descriptions for every category in the 'extract_general_info' tool's schema before choosing.

IMPORTANT INSTRUCTIONS FOR REASONING AND LOGICAL DEDUCTION:
1. Before calling the extraction tool, you MUST write a <thinking> block to analyze the given manual text step-by-step.
2. In your <thinking> block, outline what values are explicitly stated, and which are missing.
3. For missing values, DO NOT simply output 0 or invalid numbers. You MUST deduce reasonable and logical fallback values based on the fixture type, or omit them entirely if the schema allows.
   - Example: A "colorTemperature" of 0 is physically impossible and invalid (schema usually expects >= 1000). For an LED wash without a stated color temperature, either omit it entirely or use a logical default like 6000.
   - Example: A fixture width cannot be less than 1mm. Provide logical dimensions.
4. After deducing the valid logical values in your <thinking> block, call the 'extract_general_info' tool with those exact formulated values.`;

/**
 * Node to extract general information using Claude Haiku.
 */
export async function extractGeneralInfo(state: ExtractionState, config?: RunnableConfig): Promise<Partial<ExtractionState>> {
  await dispatchCustomEvent("status", { message: "Extracting General Info..." }, config);

  const extractTool = tool(
    async (input) => JSON.stringify(input),
    {
      name: "extract_general_info",
      description: "Extract the required general and physical information of the fixture.",
      schema: CustomFixtureFormSchema
    }
  );

  const model = getHaikuModel().bindTools([extractTool]);

  const messages: (BaseMessage | { role: string; content: string })[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Please extract the general info from the following manual text:\n\n${state.manualText}` }
  ];

  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = (await model.invoke(messages)) as AIMessage;
    messages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      const tc = response.tool_calls.find(t => t.name === "extract_general_info");
      if (tc) {
        const parsed = CustomFixtureFormSchema.safeParse(tc.args);
        if (parsed.success) {
          return { generalInfo: parsed.data };
        } else {
          lastError = parsed.error;
          messages.push(new ToolMessage({
            tool_call_id: tc.id as string,
            name: tc.name,
            content: `Validation Failed. Please fix these issues and re-submit:\n${JSON.stringify(parsed.error.issues, null, 2)}`
          }));
          continue; // retry
        }
      }
    }

    // In case model didn't use the tool at all
    messages.push({
      role: "user",
      content: "Please provide the information by calling the 'extract_general_info' tool."
    });
  }

  throw new Error(`Failed to extract general info after 3 retries. Last error: ${JSON.stringify(lastError?.issues)}`);
}
