// @vitest-environment node
/**
 * Which tubes an image is offered to (plan D17): manufacturer from the UID,
 * model from DEVICE_INFO, version decides update / up to date / downgrade.
 */
import { describe, expect, it } from 'vitest';
import { checkFirmwareEligibility, type TubeReading } from './firmware-eligibility';
import { FOREIGN, T1, makeImage } from './testing/fixtures';

/** A tube that answered DEVICE_INFO. */
const ok = (softwareVersionId: number, deviceModelId = 1): TubeReading => ({ state: 'ok', deviceModelId, softwareVersionId, softwareVersionLabel: null });
const image = makeImage(); // 1.2.0 for 0x7FF0 / 0x0001

describe('checkFirmwareEligibility', () => {
  it('offers and preselects older tubes', () => {
    expect(checkFirmwareEligibility(image, T1, ok(0x000500))).toEqual({
      kind: 'update', label: 'Update', reason: null, selectable: true, preselect: true, downgrade: false,
    });
  });

  it('marks the same version as up to date (selectable, not preselected)', () => {
    const e = checkFirmwareEligibility(image, T1, ok(0x010200));
    expect(e).toMatchObject({ kind: 'upToDate', label: 'Up to date', selectable: true, preselect: false, downgrade: false });
    expect(e.reason).toBe('Already runs 1.2.0');
  });

  it('marks newer tubes as downgrade that needs confirmation', () => {
    const e = checkFirmwareEligibility(image, T1, ok(0x010300));
    expect(e).toMatchObject({ kind: 'downgrade', selectable: true, preselect: false, downgrade: true });
    expect(e.reason).toBe('Installed 1.3.0 is newer than the image');
  });

  it('does not offer other manufacturers — even before the tube answered', () => {
    for (const reading of [ok(0x01), { state: 'loading' } as const, { state: 'error', message: 'No answer from the device' } as const]) {
      const e = checkFirmwareEligibility(image, FOREIGN, reading);
      expect(e).toMatchObject({ kind: 'mismatch', selectable: false, label: 'Other manufacturer' });
      expect(e.reason).toBe('Manufacturer 0x1234 — the image is for 0x7FF0');
    }
  });

  it('does not offer other models', () => {
    const e = checkFirmwareEligibility(image, T1, ok(0x000100, 0x0002));
    expect(e).toMatchObject({ kind: 'mismatch', selectable: false, label: 'Other model' });
    expect(e.reason).toBe('Model 0x0002 — the image is for model 0x0001');
  });

  it('waits while reading', () => {
    expect(checkFirmwareEligibility(image, T1, { state: 'loading' })).toMatchObject({ kind: 'loading', selectable: false });
  });

  it('offers unreadable tubes only on request; preselects tubes left in the bootloader', () => {
    const silent: TubeReading = { state: 'error', message: 'No answer from the device' };
    expect(checkFirmwareEligibility(image, T1, silent)).toMatchObject({ kind: 'unknown', selectable: true, preselect: false });
    expect(checkFirmwareEligibility(image, T1, silent, { inBootloader: true })).toMatchObject({ kind: 'bootloader', selectable: true, preselect: true, downgrade: false });
  });
});
