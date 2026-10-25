// @vitest-environment node
/**
 * Version ids (0x00MMmmpp), image names, progress texts and error messages
 * of the firmware update (plan M7.4).
 */
import { describe, expect, it } from 'vitest';
import { BridgeCommandError } from '../bridge/backend';
import { describeFlashError, describeJobError } from './firmware-errors';
import { compareFirmwareVersions, describeImageModel, firmwareVersionParts, formatFirmwareVersion, parseFirmwareVersion } from './firmware-version';
import { describeFlashPhase, flashProgressFraction, isTerminalPhase } from './flash-progress';
import { makeJob } from './testing/fixtures';

describe('firmware version ids', () => {
  it('formats 0x00MMmmpp as M.m.p', () => {
    expect(formatFirmwareVersion(0x010200)).toBe('1.2.0');
    expect(formatFirmwareVersion(0x000500)).toBe('0.5.0');
    expect(formatFirmwareVersion(0)).toBe('0.0.0');
    expect(formatFirmwareVersion(0xffffff)).toBe('255.255.255');
    expect(firmwareVersionParts(0x0a0b0c)).toEqual({ major: 10, minor: 11, patch: 12 });
  });

  it('shows ids outside the format raw', () => {
    expect(formatFirmwareVersion(0xb0000003)).toBe('0xB0000003');
    expect(formatFirmwareVersion(0x01000000)).toBe('0x01000000');
    expect(firmwareVersionParts(-1)).toBeNull();
    expect(formatFirmwareVersion(1.5)).toBe('1.5');
  });

  it('parses M.m.p back to the id', () => {
    expect(parseFirmwareVersion('1.2.0')).toBe(0x010200);
    expect(parseFirmwareVersion(' 0.5.3 ')).toBe(0x000503);
    expect(parseFirmwareVersion('1.256.0')).toBeNull();
    expect(parseFirmwareVersion('1.2')).toBeNull();
    expect(parseFirmwareVersion('v1.2.0')).toBeNull();
  });

  it('compares ids numerically (= version order)', () => {
    expect(compareFirmwareVersions(0x010200, 0x000500)).toBe(1);
    expect(compareFirmwareVersions(0x000500, 0x010200)).toBe(-1);
    expect(compareFirmwareVersions(0x010200, 0x010200)).toBe(0);
    expect(compareFirmwareVersions(0x000a00, 0x000909)).toBe(1); // 0.10.0 > 0.9.9
  });

  it('names the device an image is for', () => {
    expect(describeImageModel({ manufacturerId: 0x7ff0, modelId: 1 })).toBe('XBAR500 LED tube');
    expect(describeImageModel({ manufacturerId: 0x1234, modelId: 0x42 })).toBe('Model 0x0042 of manufacturer 0x1234');
  });
});

describe('flash progress', () => {
  it('advances through the phases; pages drive writing', () => {
    expect(flashProgressFraction(makeJob({ phase: 'entering' }))).toBe(0);
    expect(flashProgressFraction(makeJob({ phase: 'writing', pagesDone: 0 }))).toBeCloseTo(0.05);
    expect(flashProgressFraction(makeJob({ phase: 'writing', pagesDone: 47, pagesTotal: 94 }))).toBeCloseTo(0.45);
    expect(flashProgressFraction(makeJob({ phase: 'verifying', pagesDone: 94 }))).toBeCloseTo(0.85);
    expect(flashProgressFraction(makeJob({ phase: 'confirming' }))).toBeCloseTo(0.96);
    expect(flashProgressFraction(makeJob({ phase: 'done' }))).toBe(1);
    expect(flashProgressFraction(makeJob({ phase: 'failed', pagesDone: 94 }))).toBeCloseTo(0.85);
    expect(flashProgressFraction(makeJob({ phase: 'writing', pagesTotal: 0 }))).toBeCloseTo(0.05);
  });

  it('describes phases in English', () => {
    expect(describeFlashPhase(makeJob({ phase: 'writing', pagesDone: 12 }))).toBe('Writing 12 / 94 pages');
    expect(describeFlashPhase(makeJob({ phase: 'verifying', rewrites: 1 }))).toBe('Verifying (1 chunk rewritten)');
    expect(describeFlashPhase(makeJob({ phase: 'entering' }))).toBe('Starting bootloader');
    expect(isTerminalPhase('cancelled')).toBe(true);
    expect(isTerminalPhase('confirming')).toBe(false);
  });
});

describe('firmware errors', () => {
  it('explains the flash pre-check errors', () => {
    expect(describeFlashError(new BridgeCommandError('downgrade', 'downgrade', { current: 0x010200, image: 0x000500 })).message)
      .toBe('The image (0.5.0) is older than the installed firmware (1.2.0)');
    expect(describeFlashError(new BridgeCommandError('invalidImage', 'CRC mismatch'))).toEqual({ message: 'The file is not a valid tube firmware image', detail: 'CRC mismatch' });
    expect(describeFlashError(new BridgeCommandError('busy', 'busy')).message).toBe('Another firmware update is running on this port');
    expect(describeFlashError(new BridgeCommandError('timeout', 'timeout')).message).toBe('No answer from the device');
  });

  it('explains job errors and keeps the bridge text as detail', () => {
    expect(describeJobError({ code: 'timeout', message: 'BOOT_INFO: no answer after 3 retries' }))
      .toEqual({ message: 'No answer from the device', detail: 'BOOT_INFO: no answer after 3 retries' });
    expect(describeJobError({ code: 'internal', message: 'FINISH failed (error 2)' })).toEqual({ message: 'FINISH failed (error 2)', detail: null });
    expect(describeJobError(null).message).toBe('The update failed');
  });
});
