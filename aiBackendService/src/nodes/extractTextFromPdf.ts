import type { ExtractionState } from "../state.js";
import { extractTextWithMistralOcr } from "../utils/mistralOcr.js";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

/**
 * Node to extract text from a PDF file using Mistral OCR.
 */
export async function extractTextFromPdf(state: ExtractionState, config?: LangGraphRunnableConfig): Promise<Partial<ExtractionState>> {
  if (!state.pdfFile) {
    return {};
  }

  config?.writer?.({ message: "Converting PDF to text via Mistral OCR..." });

  const { name, buffer } = state.pdfFile;
  const manualText = await extractTextWithMistralOcr(name, buffer);

  return {
    manualText,
  };
}
