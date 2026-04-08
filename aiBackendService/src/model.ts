import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import dotenv from "dotenv";

// Ensure environment variables are loaded
dotenv.config();

/**
 * Returns a configured instance of Gemini 2.0 Flash-Lite for extraction nodes.
 * Gemini Flash-Lite has a very high rate limit (~1000 req/s), so concurrency
 * can be much higher than with Anthropic models.
 * Tool calling (bindTools) is used instead of structured output for better reliability.
 */
export const getExtractionModel = () => {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not defined in the environment variables. Please check your .env file.");
  }

  return new ChatGoogleGenerativeAI({
    model: "gemini-flash-lite-latest",
    temperature: 0,
    apiKey,
    maxRetries: 2,
  });
};

// Keep legacy alias so old imports don't break during migration
export const getHaikuModel = getExtractionModel;
