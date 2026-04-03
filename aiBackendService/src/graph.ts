import { StateGraph, START, END } from "@langchain/langgraph";
import { ExtractionStateAnnotation, type ExtractionState } from "./state.js";
import { extractGeneralInfo } from "./nodes/extractGeneralInfo.js";
import { extractTextFromPdf } from "./nodes/extractTextFromPdf.js";
import { extractChannels } from "./nodes/extractChannels.js";
import { extractModes } from "./nodes/extractModes.js";
import { assembleOflDocument } from "./nodes/assembleOflDocument.js";

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
  .addNode("extractChannels", extractChannels)
  .addNode("extractModes", extractModes)
  .addNode("assembleOflDocument", assembleOflDocument)
  
  // Define edges
  .addConditionalEdges(START, routeBasedOnInput)
  .addEdge("extractTextFromPdf", "extractGeneralInfo")
  .addEdge("extractGeneralInfo", "extractChannels")
  .addEdge("extractChannels", "extractModes")
  .addEdge("extractModes", "assembleOflDocument")
  .addEdge("assembleOflDocument", END);

// Compile the graph into a runnable
export const extractionGraph = builder.compile();
