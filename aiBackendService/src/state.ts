import { Annotation } from "@langchain/langgraph";

export const ExtractionStateAnnotation = Annotation.Root({
  // The uploaded PDF file buffer and name
  pdfFile: Annotation<{ name: string; buffer: Buffer } | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  // The raw text of the manual that should be analyzed
  manualText: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  // Extracted general information (e.g. name, manufacturer, modes)
  generalInfo: Annotation<any | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
});

export type ExtractionState = typeof ExtractionStateAnnotation.State;
