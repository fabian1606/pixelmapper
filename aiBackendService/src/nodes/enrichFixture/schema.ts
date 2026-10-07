// Zod schema for a single "photometric enrichment" proposal — a targeted
// correction to the render-relevant parts of an existing OFL fixture
// definition (shutter/strobe ranges, wheel slot colors, dimmer ranges).
// Kept to 3 variants (not the full 43-type OflCapabilitySchema union) so
// Gemini's function-calling reliably fills it in — see extractSingleChannel.ts
// for the precedent of narrowing large unions for this model.
import { z } from "zod";

const ShutterProposalSchema = z.object({
  kind: z.literal("shutter"),
  channelName: z.string().describe("Exact channel name as it appears in the fixture definition, e.g. 'Shutter / Strobe'"),
  dmxMin: z.number().int().min(0).max(255),
  dmxMax: z.number().int().min(0).max(255),
  shutterEffect: z.enum(["Open", "Closed", "Strobe", "Pulse", "RampUp", "RampDown", "RampUpDown"])
    .describe("'Open' = shutter open / lamp on. 'Closed' = blackout. 'Strobe' = standard blinking."),
  speed: z.string().optional().describe("Strobe rate for this range, e.g. '1Hz to 10Hz' or 'slow to fast'"),
  reason: z.string().describe("One sentence citing what in the manual justifies this range"),
});

const WheelSlotProposalSchema = z.object({
  kind: z.literal("wheelSlotColor"),
  wheelName: z.string().describe("Exact wheel name as it appears in the fixture definition, e.g. 'Color Wheel'"),
  slotNumber: z.number().int().min(1).describe("1-based slot position on the wheel"),
  slotType: z.enum(["Open", "Closed", "Color", "Gobo"]),
  colors: z.array(z.string()).optional().describe("Hex color(s) for Color-type slots, e.g. ['#FF0000']"),
  reason: z.string(),
});

const DimmerProposalSchema = z.object({
  kind: z.literal("dimmerDefault"),
  channelName: z.string(),
  dmxMin: z.number().int().min(0).max(255),
  dmxMax: z.number().int().min(0).max(255),
  reason: z.string(),
});

export const EnrichmentProposalSchema = z.discriminatedUnion("kind", [
  ShutterProposalSchema,
  WheelSlotProposalSchema,
  DimmerProposalSchema,
]);

export const EnrichmentProposalsSchema = z.object({
  proposals: z.array(EnrichmentProposalSchema)
    .describe("Corrections to the fixture's shutter/strobe, color wheel, or dimmer behavior. Empty array if the existing definition is already accurate."),
});

export type EnrichmentProposal = z.infer<typeof EnrichmentProposalSchema>;
