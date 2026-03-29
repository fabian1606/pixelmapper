import { ChatAnthropic } from "@langchain/anthropic";
import type { ExtractionState } from "../state.js";
import { CustomFixtureFormSchema } from "../../../app/utils/engine/custom-fixture-types.ts";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { RunnableConfig } from "@langchain/core/runnables";

// A system prompt explaining the task
const systemPrompt = `You are an expert at extracting lighting fixture definitions from user manuals.
Your task is to extract all the required general and physical information of the fixture according to the provided schema.
Extract information such as name, short name, manufacturer, weight, dimensions, power, connector types, bulb type, color temperature, and beam angles if available in the text.
If any information is not explicitly mentioned, omit it or use a reasonable default. Output MUST be strictly matching the schema.`;

/**
 * Node to extract general information using Claude Haiku.
 */
export async function extractGeneralInfo(state: ExtractionState, config?: RunnableConfig): Promise<Partial<ExtractionState>> {
  await dispatchCustomEvent("status", { message: "Extrahiere General Info mit Claude..." }, config);

  const model = new ChatAnthropic({
    model: "claude-3-haiku-20240307",
    temperature: 0,
  }).withStructuredOutput(CustomFixtureFormSchema);

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Please extract the general info from the following manual text:\n\n${state.manualText}` }
  ]);

  return {
    generalInfo: response,
  };
}
