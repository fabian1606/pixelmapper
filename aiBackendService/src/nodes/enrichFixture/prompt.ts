// Builds the LLM prompt for the enrichment pass: summarizes only the
// render-relevant parts of the existing OFL fixture (shutter/strobe channels,
// dimmer channels, color wheels) so the model can compare them against the
// manual and propose corrections, without needing the full fixture JSON.
import type { OflFixture, OflChannel } from "../../../../app/utils/ofl/types.js";

function summarizeChannel(name: string, ch: OflChannel): string | null {
  const caps = ch.capabilities ?? (ch.capability ? [ch.capability] : []);
  const relevant = caps.filter((c: any) =>
    c.type === "ShutterStrobe" || c.type === "Intensity" || c.type === "WheelSlot" || c.type === "WheelRotation"
  );
  if (relevant.length === 0) return null;
  return `- "${name}": ${JSON.stringify(relevant)}`;
}

export function buildEnrichmentPrompt(existingFixture: OflFixture, manualText: string): string {
  const channelLines: string[] = [];
  for (const [name, ch] of Object.entries(existingFixture.availableChannels ?? {})) {
    const line = summarizeChannel(name, ch as OflChannel);
    if (line) channelLines.push(line);
  }
  for (const [name, ch] of Object.entries(existingFixture.templateChannels ?? {})) {
    const line = summarizeChannel(name, ch as OflChannel);
    if (line) channelLines.push(line);
  }

  const wheelLines = Object.entries(existingFixture.wheels ?? {}).map(
    ([name, wheel]) => `- "${name}": ${JSON.stringify(wheel)}`
  );

  return [
    "You are a DMX lighting expert reviewing an existing fixture definition against its manual.",
    "Only the render-relevant behavior matters: shutter/strobe DMX ranges, dimmer DMX ranges, and color wheel slot colors.",
    "",
    "Current shutter/dimmer/wheel-slot channels in the fixture definition:",
    channelLines.length > 0 ? channelLines.join("\n") : "(none found)",
    "",
    "Current wheel definitions:",
    wheelLines.length > 0 ? wheelLines.join("\n") : "(none found)",
    "",
    "Manual text:",
    manualText,
    "",
    "Compare the current definition against the manual. Propose a correction ONLY when the manual",
    "clearly contradicts or refines the current value (e.g. the manual states the shutter opens at",
    "DMX 8-127 but the definition has it open at 0-255, or the manual lists color wheel slot colors",
    "that are missing or wrong). Do not propose a change you cannot justify with a specific reason",
    "from the manual. If the current definition already matches the manual, return an empty array.",
  ].join("\n");
}
