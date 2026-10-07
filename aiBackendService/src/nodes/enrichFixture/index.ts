// Single-shot enrichment pass: given an existing OFL fixture definition and
// the fixture's manual (already OCR'd to text), asks Gemini to propose
// corrections to the render-relevant behavior (shutter/strobe, dimmer, color
// wheel slots). Not a LangGraph node — this is a standalone call, since it
// doesn't need the multi-stage extraction pipeline (channels are already known).
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { OflFixture } from "../../../../app/utils/ofl/types.js";
import { getExtractionModel } from "../../model.js";
import { toGeminiJsonSchema } from "../../utils/gemini-schema.js";
import { buildEnrichmentPrompt } from "./prompt.js";
import { EnrichmentProposalsSchema, type EnrichmentProposal } from "./schema.js";

export async function enrichFixtureFromManual(
  existingFixture: OflFixture,
  manualText: string,
  onStatus?: (message: string) => void,
): Promise<EnrichmentProposal[]> {
  onStatus?.("Comparing fixture definition against the manual...");

  const proposeTool = new DynamicStructuredTool({
    name: "propose_corrections",
    description: "Propose corrections to the fixture's shutter/strobe, dimmer, or color wheel behavior based on the manual.",
    schema: toGeminiJsonSchema(EnrichmentProposalsSchema) as any,
    func: async (input: any) => JSON.stringify(input),
  });

  const model = getExtractionModel().bindTools([proposeTool]);
  const messages: BaseMessage[] = [
    { role: "system", content: "You are a meticulous DMX lighting technician. Call 'propose_corrections' exactly once." } as any,
    { role: "user", content: buildEnrichmentPrompt(existingFixture, manualText) } as any,
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = (await model.invoke(messages)) as AIMessage;
    messages.push(response);

    const tc = response.tool_calls?.find(t => t.name === "propose_corrections");
    if (!tc) {
      messages.push({ role: "user", content: "Please call 'propose_corrections'." } as any);
      continue;
    }

    const parsed = EnrichmentProposalsSchema.safeParse(tc.args);
    if (parsed.success) return parsed.data.proposals;

    messages.push(new ToolMessage({
      tool_call_id: tc.id as string,
      name: tc.name,
      content: `Validation failed. Fix these issues: ${JSON.stringify(parsed.error.issues)}`,
    }));
  }

  throw new Error("Failed to obtain valid enrichment proposals from the model.");
}
