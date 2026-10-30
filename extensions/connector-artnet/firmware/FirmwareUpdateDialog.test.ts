/**
 * `FirmwareUpdateDialog` and `TubeFirmwareButton` against
 * `FakeArtNetBackend` (plan M7.4): pick a file → preview → rows with
 * version old → new and greyed tubes → run with progress, phase and error
 * per tube → cancel; downgrade confirmation; re-attach; single tube from
 * the inspector.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { FirmwareUpdateManager } from './firmware-update-manager';
import { FOREIGN, FakeFirmwareBridge, HEX, NODE_ID, T1, T2, T3, makeJob } from './testing/fixtures';
import FirmwareUpdateDialog from './FirmwareUpdateDialog.vue';
import TubeFirmwareButton from './TubeFirmwareButton.vue';

let bridge: FakeFirmwareBridge;
let manager: FirmwareUpdateManager;
let wrapper: VueWrapper | null = null;

beforeEach(async () => {
  bridge = new FakeFirmwareBridge();
  manager = bridge.manager();
  await flushPromises();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  manager.dispose();
  bridge.dispose();
});

/** Mounts the dialog (teleport rendered in place) and waits for the tubes. */
async function mountDialog(props: Record<string, unknown> = {}) {
  wrapper = mount(FirmwareUpdateDialog, {
    props: { open: true, nodeId: NODE_ID, backend: bridge.backend, directory: bridge.directory, manager, ...props },
    global: { stubs: { teleport: true } },
  });
  await flushPromises();
  return wrapper;
}

/** Picks a `.hex` file in the file input. */
async function pickFile(w: VueWrapper, text = HEX, name = 'tube_fw-1.2.0.hex') {
  const input = w.find('[data-file-input]');
  Object.defineProperty(input.element, 'files', { value: [new File([text], name)], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

/** Row of a tube. */
const row = (w: VueWrapper, uid: string) => w.find(`[data-uid="${uid}"]`);
/** Checkbox of a tube's row. */
const box = (w: VueWrapper, uid: string) => row(w, uid).find('input[type="checkbox"]').element as HTMLInputElement;
/** UIDs of the `flash` requests. */
const flashed = () => bridge.requestsOf<{ uid: string }>('flash').map(f => f.uid);

describe('FirmwareUpdateDialog', () => {
  it('shows the node, its tubes and their versions before a file is chosen', async () => {
    const w = await mountDialog();
    expect(w.find('[role="dialog"]').text()).toContain('Update tube firmware');
    expect(w.text()).toContain('PM Node · 2.27.44.61');
    expect(w.find('[data-overlay-root]').exists()).toBe(true);
    expect(row(w, T1).text()).toContain('Port 1');
    expect(row(w, T1).find('[data-versions]').text()).toBe('0.5.0');
    expect(box(w, T1).disabled).toBe(true);
    expect(w.find('[data-start]').text()).toBe('Update 0 tubes');
  });

  it('previews the image and offers matching tubes with version old → new', async () => {
    const w = await mountDialog();
    await pickFile(w);
    expect(w.find('[data-image]').text()).toContain('XBAR500 LED tube');
    expect(w.find('[data-image]').text()).toContain('1.2.0');
    expect(row(w, T1).find('[data-versions]').text()).toBe('0.5.0 → 1.2.0');
    expect(row(w, T1).find('[data-eligibility]').text()).toBe('Update');
    expect(box(w, T1).checked).toBe(true);
    expect(row(w, T2).find('[data-eligibility]').text()).toBe('Up to date');
    expect(box(w, T2).checked).toBe(false);
    // Another manufacturer: greyed, not selectable, with the reason.
    expect(box(w, FOREIGN).disabled).toBe(true);
    expect(row(w, FOREIGN).classes()).toContain('opacity-60');
    expect(row(w, FOREIGN).find('[data-reason]').text()).toBe('Manufacturer 0x1234 — the image is for 0x7FF0');
    expect(w.find('[data-start]').text()).toBe('Update 2 tubes');
  });

  it('shows why a file is not an image', async () => {
    const w = await mountDialog();
    await pickFile(w, 'not a hex file');
    expect(w.find('[data-image-error]').text()).toBe('The file is not a valid tube firmware image: line 1: missing start code');
    expect(w.find('[data-start]').attributes('disabled')).toBeDefined();
  });

  it('runs the update with progress, phase and errors per tube', async () => {
    const w = await mountDialog();
    await pickFile(w);
    await row(w, T2).find('input[type="checkbox"]').setValue(true);
    await w.find('[data-start]').trigger('click');
    await flushPromises();
    expect(w.emitted('started')).toEqual([[3]]);
    expect(flashed()).toEqual([T1, T3]);
    expect(row(w, T2).attributes('data-status')).toBe('queued');
    expect(row(w, T2).find('[data-progress]').text()).toBe('Waiting for the port');

    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'writing', pagesDone: 47 });
    await flushPromises();
    expect(row(w, T1).find('[data-progress]').text()).toBe('Writing 47 / 94 pages · 45 %');
    expect(row(w, T1).find('[role="progressbar"]').attributes('aria-valuenow')).toBe('45');

    bridge.progress(bridge.jobOf(T3)!.jobId, { phase: 'failed', inBootloader: true, error: { code: 'timeout', message: 'BOOT_INFO: no answer' } });
    await flushPromises();
    const failed = row(w, T3).find('[data-progress]');
    expect(failed.text()).toBe('No answer from the device — the tube waits in its bootloader; update it again');
    expect(failed.classes()).toContain('text-destructive');
    expect(failed.attributes('title')).toBe('BOOT_INFO: no answer');

    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: '1.2.0' } });
    await flushPromises();
    expect(row(w, T1).find('[data-progress]').text()).toBe('Updated to 1.2.0');
    expect(row(w, T1).find('[data-versions]').text()).toBe('1.2.0 → 1.2.0');
    expect(flashed()).toEqual([T1, T3, T2]);
    expect(w.find('[data-summary]').text()).toContain('1 updated · 1 failed · 1 running or waiting');
  });

  it('cancels all updates of the node', async () => {
    const w = await mountDialog();
    await pickFile(w);
    await row(w, T2).find('input[type="checkbox"]').setValue(true);
    await w.find('[data-start]').trigger('click');
    await flushPromises();
    await w.find('[data-cancel-all]').trigger('click');
    await flushPromises();
    expect(bridge.requestsOf('flashCancel')).toHaveLength(2);
    expect(row(w, T2).find('[data-progress]').text()).toBe('Cancelled');
    expect(row(w, T1).find('[data-progress]').text()).toContain('Cancelling…');
    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'cancelled', inBootloader: true });
    bridge.progress(bridge.jobOf(T3)!.jobId, { phase: 'cancelled' });
    await flushPromises();
    expect(row(w, T1).find('[data-progress]').text()).toBe('Cancelled — the tube waits in its bootloader; update it again');
    expect(w.find('[data-cancel-all]').exists()).toBe(false);
  });

  it('asks before downgrading', async () => {
    bridge.tubes.get(T2)!.version = 0x010300;
    const w = await mountDialog();
    await pickFile(w);
    expect(row(w, T2).find('[data-eligibility]').text()).toBe('Downgrade');
    await row(w, T2).find('input[type="checkbox"]').setValue(true);
    await w.find('[data-start]').trigger('click');
    expect(w.find('[data-confirm-downgrade]').text()).toContain('Downgrade 1 tube?');
    expect(w.find('[data-confirm-downgrade]').text()).toContain(`${T2} (1.3.0 → 1.2.0)`);
    expect(flashed()).toEqual([]);
    await w.find('[data-confirm]').trigger('click');
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string; allowDowngrade: boolean }>('flash').map(f => [f.uid, f.allowDowngrade])).toEqual([[T1, false], [T3, false]]);
    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'done' });
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string; allowDowngrade: boolean }>('flash').at(-1)).toMatchObject({ uid: T2, allowDowngrade: true });
  });

  it('shows updates that already run in the bridge (after a reload)', async () => {
    bridge.jobs.push(makeJob({ jobId: 'r1', uid: T1, phase: 'writing', pagesDone: 94 }));
    const fresh = bridge.manager();
    const w = await mountDialog({ manager: fresh });
    expect(row(w, T1).attributes('data-status')).toBe('running');
    expect(row(w, T1).find('[data-progress]').text()).toBe('Writing 94 / 94 pages · 85 %');
    expect(w.find('[data-summary]').text()).toContain('updates continue when this dialog is closed');
    wrapper!.unmount();
    wrapper = null;
    fresh.dispose();
  });

  it('closes with the X and with Escape; running updates continue', async () => {
    const w = await mountDialog();
    await w.find('[data-close]').trigger('click');
    expect(w.emitted('update:open')).toEqual([[false]]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('update:open')).toEqual([[false], [false]]);
  });
});

describe('TubeFirmwareButton', () => {
  it('opens the dialog for one tube and shows its running update', async () => {
    wrapper = mount(TubeFirmwareButton, {
      props: { nodeId: NODE_ID, uid: T3, backend: bridge.backend, directory: bridge.directory, manager },
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.find('[data-open-firmware]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-uid]').map(r => r.attributes('data-uid'))).toEqual([T3]);
    await pickFile(wrapper);
    await wrapper.find('[data-start]').trigger('click');
    await flushPromises();
    expect(flashed()).toEqual([T3]);
    bridge.progress(bridge.jobOf(T3)!.jobId, { phase: 'writing', pagesDone: 47 });
    await flushPromises();
    expect(wrapper.find('[data-firmware-status]').text()).toBe('Updating · 45 %');
    await wrapper.find('[data-close]').trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('[data-firmware-status]').exists()).toBe(true);
  });
});
