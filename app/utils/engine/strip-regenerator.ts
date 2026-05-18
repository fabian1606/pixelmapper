import type { Fixture, StripConfig } from './core/fixture';
import { buildStripChannelsAndBeams, syncStripBounds, enforceStripLength } from './neopixel-strip-factory';

export type StripConfigPatch = Partial<Pick<StripConfig,
  'ledCount' | 'groupSize' | 'ledsPerMeter' | 'chipType'
>>;

/**
 * Apply a partial update to a strip fixture's `stripConfig` and rebuild the
 * derived `channels` + `beams` arrays. The polyline points stay untouched —
 * only their target length is re-enforced if `ledCount` or `ledsPerMeter`
 * changed.
 *
 * Callers should wrap this in a Command (UpdateStripConfigCommand) so the
 * change is reversible and persisted.
 */
export function regenerateStripChannelsAndBeams(fixture: Fixture, patch: StripConfigPatch): void {
  if (!fixture.stripConfig) return;

  Object.assign(fixture.stripConfig, patch);
  fixture.stripConfig.lengthMeters =
    fixture.stripConfig.ledCount / Math.max(1, fixture.stripConfig.ledsPerMeter);

  const { channels, beams } = buildStripChannelsAndBeams(fixture.stripConfig);
  fixture.channels = channels;
  fixture.beams = beams;

  // Re-enforce polyline target length around centroid (anchorIdx=null).
  if (patch.ledCount !== undefined || patch.ledsPerMeter !== undefined) {
    enforceStripLength(fixture, null);
  } else {
    syncStripBounds(fixture);
  }
}
