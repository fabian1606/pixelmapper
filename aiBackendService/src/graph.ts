import { StateGraph, START, END, Send } from "@langchain/langgraph";
import { ExtractionStateAnnotation, type ExtractionState } from "./state.js";
import { extractGeneralInfo } from "./nodes/extractGeneralInfo.js";
import { extractTextFromPdf } from "./nodes/extractTextFromPdf.js";
import { identifyChannels } from "./nodes/identifyChannels.js";
import { extractSingleChannel } from "./nodes/extractSingleChannel.js";
import { extractModes } from "./nodes/extractModes.js";
import { assembleOflDocument } from "./nodes/assembleOflDocument.js";

// Determine where to start based on the state
const routeBasedOnInput = (state: ExtractionState) => {
  if (state.pdfFile) {
    return "extractTextFromPdf";
  }
  return "extractGeneralInfo";
};

// Route identify to extract single via Send API map-reduce
const continueToExtractChannels = (state: ExtractionState) => {
  return state.identifiedChannels.map((channel) => 
    new Send("extractSingleChannel", { channelToExtract: channel, manualText: state.manualText })
  );
};

// Initialize the state graph
const builder = new StateGraph(ExtractionStateAnnotation)
  // Add nodes
  .addNode("extractTextFromPdf", extractTextFromPdf)
  .addNode("extractGeneralInfo", extractGeneralInfo)
  .addNode("identifyChannels", identifyChannels)
  .addNode("extractSingleChannel", extractSingleChannel)
  .addNode("extractModes", extractModes)
  .addNode("assembleOflDocument", assembleOflDocument)
  
  // Define edges
  .addConditionalEdges(START, routeBasedOnInput)
  .addEdge("extractTextFromPdf", "extractGeneralInfo")
  .addEdge("extractGeneralInfo", "identifyChannels")
  .addConditionalEdges("identifyChannels", continueToExtractChannels)
  .addEdge("extractSingleChannel", "extractModes")
  .addEdge("extractModes", "assembleOflDocument")
  .addEdge("assembleOflDocument", END);

// Compile the graph into a runnable
export const extractionGraph = builder.compile();
