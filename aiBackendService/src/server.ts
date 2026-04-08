import express from "express";
import cors from "cors";
import multer from "multer";
import { extractionGraph } from "./graph.js";
import { extractTextWithMistralOcr } from "./utils/mistralOcr.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "50mb" })); // Increased limit for larger manuals

// New endpoint: Upload a PDF and run the extraction
app.post("/extract-fixture-pdf", upload.single('manualPdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "manualPdf file is required." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    console.log("Starting LangGraph pipeline with PDF upload...");
    res.write(`data: ${JSON.stringify({ status: "Starting Mistral OCR processing..." })}\n\n`);
    
    const initialState = {
      pdfFile: {
        name: req.file.originalname,
        buffer: req.file.buffer
      },
      manualText: "",
      generalInfo: null,
    };

    const stream = await extractionGraph.stream(initialState, {
      streamMode: ["updates", "custom"]
    });
    let finalDoc = null;

    for await (const [mode, chunk] of stream) {
      if (mode === "custom") {
        // config.writer(payload) sends payload directly as chunk
        if (chunk?.message) {
          res.write(`data: ${JSON.stringify({ status: chunk.message })}\n\n`);
        }
      } else if (mode === "updates") {
        if (chunk.assembleOflDocument) {
          finalDoc = chunk.assembleOflDocument.oflDocument;
        }
      }
    }

    console.log("Pipeline finished successfully.");
    res.write(`data: ${JSON.stringify({ success: true, data: finalDoc })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Error during PDF extraction:", error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred during extraction.", details: error.message })}\n\n`);
    res.end();
  }
});

app.post("/extract-fixture", async (req, res) => {
  const { manualText } = req.body;

  if (!manualText || typeof manualText !== "string") {
    return res.status(400).json({ error: "manualText is required and must be a string." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    console.log("Starting fixture extraction pipeline...");
    res.write(`data: ${JSON.stringify({ status: "Extracting General Info..." })}\n\n`);

    const initialState = {
      pdfFile: null,
      manualText,
      generalInfo: null,
    };

    const stream = await extractionGraph.stream(initialState, {
      streamMode: ["updates", "custom"]
    });
    let finalDoc = null;

    for await (const [mode, chunk] of stream) {
      if (mode === "custom") {
        // config.writer(payload) sends payload directly as chunk
        if (chunk?.message) {
          res.write(`data: ${JSON.stringify({ status: chunk.message })}\n\n`);
        }
      } else if (mode === "updates") {
        if (chunk.assembleOflDocument) {
          finalDoc = chunk.assembleOflDocument.oflDocument;
        }
      }
    }

    console.log("Extraction finished successfully.");
    res.write(`data: ${JSON.stringify({ success: true, data: finalDoc })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Error during extraction:", error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred during extraction.", details: error.message })}\n\n`);
    res.end();
  }
});

export default app;
