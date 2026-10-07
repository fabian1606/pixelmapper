import type { OflFixture, OflChannel, OflCapability, OflWheelSlot } from '~/utils/ofl/types';
import type { EnrichmentProposal } from '~/composables/engine/useAiFixtureEnrichment';

function findChannel(fixture: OflFixture, name: string): OflChannel | undefined {
  return fixture.availableChannels?.[name] ?? fixture.templateChannels?.[name];
}

/** Replaces the channel's ShutterStrobe capability (or adds one if none exists). */
function applyShutter(fixture: OflFixture, p: Extract<EnrichmentProposal, { kind: 'shutter' }>): void {
  const channel = findChannel(fixture, p.channelName);
  if (!channel) return;

  const newCap: OflCapability = {
    type: 'ShutterStrobe',
    shutterEffect: p.shutterEffect,
    dmxRange: [p.dmxMin, p.dmxMax],
    ...(p.speed ? { speed: p.speed } : {}),
  } as OflCapability;

  const caps = channel.capabilities ?? (channel.capability ? [channel.capability] : []);
  const idx = caps.findIndex(c => c.type === 'ShutterStrobe');
  if (idx >= 0) caps[idx] = newCap;
  else caps.push(newCap);

  channel.capabilities = caps;
  delete channel.capability;
}

/** Replaces the channel's Intensity capability's DMX range. */
function applyDimmer(fixture: OflFixture, p: Extract<EnrichmentProposal, { kind: 'dimmerDefault' }>): void {
  const channel = findChannel(fixture, p.channelName);
  if (!channel) return;

  const caps = channel.capabilities ?? (channel.capability ? [channel.capability] : []);
  const idx = caps.findIndex(c => c.type === 'Intensity');
  const newCap: OflCapability = { type: 'Intensity', dmxRange: [p.dmxMin, p.dmxMax] } as OflCapability;
  if (idx >= 0) caps[idx] = newCap;
  else caps.push(newCap);

  channel.capabilities = caps;
  delete channel.capability;
}

/** Sets the color/type of one slot on an existing wheel (extends the slot array if needed). */
function applyWheelSlot(fixture: OflFixture, p: Extract<EnrichmentProposal, { kind: 'wheelSlotColor' }>): void {
  const wheel = fixture.wheels?.[p.wheelName];
  if (!wheel) return;

  while (wheel.slots.length < p.slotNumber) wheel.slots.push({ type: 'Open' } as OflWheelSlot);
  wheel.slots[p.slotNumber - 1] = {
    type: p.slotType,
    ...(p.colors ? { colors: p.colors } : {}),
  } as OflWheelSlot;
}

/**
 * Applies accepted AI enrichment proposals to a working copy of an OFL fixture.
 * Returns a new object — the caller re-derives the editor draft from it via
 * initFromOflFixture, mirroring the AI import flow.
 */
export function applyEnrichmentProposals(fixture: OflFixture, accepted: EnrichmentProposal[]): OflFixture {
  const patched: OflFixture = JSON.parse(JSON.stringify(fixture));
  for (const p of accepted) {
    if (p.kind === 'shutter') applyShutter(patched, p);
    else if (p.kind === 'dimmerDefault') applyDimmer(patched, p);
    else if (p.kind === 'wheelSlotColor') applyWheelSlot(patched, p);
  }
  return patched;
}
