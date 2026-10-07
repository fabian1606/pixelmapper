import express from "express";
import cors from "cors";
import multer from "multer";
import { extractionGraph } from "./graph.js";
import { extractTextWithMistralOcr } from "./utils/mistralOcr.js";
import { enrichFixtureFromManual } from "./nodes/enrichFixture/index.js";

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

// Enrichment endpoint: given an existing fixture definition (as OFL JSON) and
// its manual PDF, propose corrections to shutter/dimmer/wheel-slot behavior
// for the user to review and accept in the custom fixture editor.
app.post("/enrich-fixture-pdf", upload.single('manualPdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "manualPdf file is required." });
  }
  let existingFixture;
  try {
    existingFixture = JSON.parse(req.body.existingOfl);
  } catch {
    return res.status(400).json({ error: "existingOfl must be a valid JSON string." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    res.write(`data: ${JSON.stringify({ status: "Starting Mistral OCR processing..." })}\n\n`);
    const manualText = await extractTextWithMistralOcr(req.file.originalname, req.file.buffer);

    const proposals = await enrichFixtureFromManual(existingFixture, manualText, (message) => {
      res.write(`data: ${JSON.stringify({ status: message })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ success: true, data: { proposals } })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Error during fixture enrichment:", error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred during enrichment.", details: error.message })}\n\n`);
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
