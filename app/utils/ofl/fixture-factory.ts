import type { OflFixture } from './types';
import { resolveOflChannel } from './capability-map';
import { Fixture } from '../engine/core/fixture';
import type { Channel } from '../engine/core/channel';

/**
 * Determines if a channel key is a "fine" (higher-resolution) alias
 * and should be skipped in 8-bit mode (phase 1).
 *
 * OFL fine channel aliases follow the pattern "ChannelName fine" or "ChannelName fine^2".
 */
function isFineChannel(key: string, oflFixture: OflFixture): boolean {
  for (const channelDef of Object.values(oflFixture.availableChannels)) {
    if (channelDef.fineChannelAliases?.includes(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Creates a pixelmapper `Fixture` from an OFL fixture JSON definition.
 *
 * Only 8-bit coarse channels are included (fine/16-bit/24-bit aliases are skipped).
 * Null channel slots (used as spacers in OFL) are also skipped.
 *
 * @param oflFixture - The raw OFL fixture JSON object
 * @param modeIndex  - Which mode to use (default: 0, the first/simplest mode)
 * @param fixtureId  - The ID to assign to the new Fixture (default: auto uuid)
 */
export function createFixtureFromOfl(
  oflFixture: OflFixture,
  modeIndex: number = 0,
  fixtureId?: string | number
): Fixture {
  const mode = oflFixture.modes[modeIndex] ?? oflFixture.modes[0];
  if (!mode) {
    throw new Error(`OFL fixture "${oflFixture.name}" has no modes defined.`);
  }

  const channels: Channel[] = [];

  for (const channelKey of mode.channels) {
    // Skip null slots (used as spacers in matrix modes)
    if (!channelKey) continue;

    // Skip fine channels (16-bit / 24-bit aliases) in phase 1
    if (isFineChannel(channelKey, oflFixture)) continue;

    const channelDef = oflFixture.availableChannels[channelKey]
      ?? oflFixture.templateChannels?.[channelKey];

    if (!channelDef) continue;

    const mapped = resolveOflChannel(channelDef);

    const channel: Channel = {
      type: mapped.type,
      value: mapped.defaultValue,
      baseValue: mapped.defaultValue,
      role: mapped.role,
      colorValue: mapped.colorValue,
    };

    channels.push(channel);
  }

  const id = fixtureId ?? crypto.randomUUID();
  const fixture = new Fixture(id, channels);
  fixture.name = oflFixture.name;
  // Store the OFL metadata for reference
  (fixture as Fixture & { oflCategories: string[] }).oflCategories = oflFixture.categories;

  return fixture;
}
