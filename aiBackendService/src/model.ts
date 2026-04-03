import { ChatAnthropic } from "@langchain/anthropic";
import dotenv from "dotenv";

// Ensure environment variables are loaded
dotenv.config();

/**
 * Returns a configured instance of Claude 3 Haiku for the extraction nodes.
 * Explicitly passes the API key from the environment.
 */
export const getHaikuModel = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not defined in the environment variables. Please check your .env file.");
  }

  return new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
    anthropicApiKey: apiKey,
  });
};
