import type { ExtractionState } from "../state.js";
import { extractTextWithMistralOcr } from "../utils/mistralOcr.js";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { RunnableConfig } from "@langchain/core/runnables";

/**
 * Node to extract text from a PDF file using Mistral OCR.
 */
export async function extractTextFromPdf(state: ExtractionState, config?: RunnableConfig): Promise<Partial<ExtractionState>> {
  if (!state.pdfFile) {
    return {};
  }

  await dispatchCustomEvent("status", { message: "Converting PDF to text via Mistral OCR..." }, config);

  const { name, buffer } = state.pdfFile;
  const manualText = await extractTextWithMistralOcr(name, buffer);

  return {
    manualText,
  };
}
