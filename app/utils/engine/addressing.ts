/**
 * Id and DMX address assignment for newly added fixtures (shared by the
 * workspace add flow and the extension command factory).
 */
import type { Fixture } from './core/fixture';
import { getKind } from '~/utils/kinds/kind-host';
import { newPrefixedId } from '~/utils/ids';

/**
 * Assigns ids (`ofl-<uuid>`, ADR 0004 D6 — collision-free across offline
 * clients; legacy `ofl-N` ids stay valid as opaque strings) and consecutive
 * start addresses after the highest used address. A fixture that would cross a 512-channel universe boundary
 * starts at the next universe, unless its kind declares `spansUniverses`.
 *
 * `fixedAddresses[i]` (plan M4.1) keeps an explicit absolute start address
 * for `newFixtures[i]`; fixtures without one are appended after everything
 * else, including the fixed ones.
 */
export function assignIdsAndAddresses(
  newFixtures: Fixture[],
  existing: readonly Fixture[],
  fixedAddresses: readonly (number | undefined)[] = [],
): void {
  let maxAddress = 0;
  for (const f of existing) {
    const fMax = f.startAddress + f.channels.length - 1;
    if (fMax > maxAddress) maxAddress = fMax;
  }
  newFixtures.forEach((f, i) => {
    const fixed = fixedAddresses[i];
    if (fixed !== undefined) maxAddress = Math.max(maxAddress, fixed + f.channels.length - 1);
  });

  let currentAddress = maxAddress + 1;
  for (const [i, f] of newFixtures.entries()) {
    f.id = newPrefixedId('ofl');
    const fixed = fixedAddresses[i];
    if (fixed !== undefined) {
      f.startAddress = fixed;
      continue;
    }
    const channelCount = f.channels.length;
    const spans = f.kind ? getKind(f.kind.id)?.def.spansUniverses === true : false;
    if (!spans) {
      const localAddr = ((currentAddress - 1) % 512) + 1;
      if (localAddr + channelCount - 1 > 512) {
        currentAddress = Math.floor((currentAddress - 1) / 512) * 512 + 1 + 512;
      }
    }
    f.startAddress = currentAddress;
    currentAddress += channelCount;
  }
}
