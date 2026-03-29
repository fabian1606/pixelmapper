import { StateGraph, START, END } from "@langchain/langgraph";
import { ExtractionStateAnnotation, type ExtractionState } from "./state.js";
import { extractGeneralInfo } from "./nodes/extractGeneralInfo.js";
import { extractTextFromPdf } from "./nodes/extractTextFromPdf.js";

// Determine where to start based on the state
const routeBasedOnInput = (state: ExtractionState) => {
  if (state.pdfFile) {
    return "extractTextFromPdf";
  }
  return "extractGeneralInfo";
};

// Initialize the state graph
const builder = new StateGraph(ExtractionStateAnnotation)
  // Add nodes
  .addNode("extractTextFromPdf", extractTextFromPdf)
  .addNode("extractGeneralInfo", extractGeneralInfo)
  
  // Define edges
  .addConditionalEdges(START, routeBasedOnInput)
  .addEdge("extractTextFromPdf", "extractGeneralInfo")
  .addEdge("extractGeneralInfo", END);

// Compile the graph into a runnable
export const extractionGraph = builder.compile();
