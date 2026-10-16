/**
 * "New modifier from code" dialog (plan P4.3): build → result → add.
 *
 * The compiler cannot load under happy-dom (Binaryen's wasm fetch clashes
 * with its Response), so `buildFromCode` is mocked here; the real build is
 * covered by `create-plugin.test.ts` in the node environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, enableAutoUnmount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }) }));

const build = vi.hoisted(() => vi.fn());
vi.mock('~/utils/plugins/create-plugin', async (orig) => ({
  ...(await orig<typeof import('~/utils/plugins/create-plugin')>()),
  buildFromCode: build,
}));

enableAutoUnmount(afterEach);

/** Finds a button in the document by its text. */
function button(text: string): HTMLButtonElement {
  const b = [...document.body.querySelectorAll('button')].find(el => el.textContent?.includes(text));
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}

/** Waits until `fn` is truthy (async build). */
async function until(fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 20));
    await flushPromises();
  }
}

describe('NewModifierDialog', () => {
  it('builds the template and emits add with its hash', async () => {
    const { BUILTIN_PLUGINS } = await import('~/utils/plugins/builtin-index');
    const builtin = BUILTIN_PLUGINS[0]!;
    build.mockResolvedValue({
      pkg: { hash: builtin.hash, manifest: builtin.manifest, wasm: new Uint8Array(), source: {}, toolchain: 't' },
      diagnostics: [{ stage: 'validate', severity: 'warning', message: 'just a warning' }],
      metrics: { medianFrameMs: 0.01, samples: 288, outputMin: -1, outputMax: 1 },
    });
    const Dialog = (await import('./NewModifierDialog.vue')).default;
    const w = mount(Dialog, { props: { open: true }, attachTo: document.body });
    await nextTick();
    expect(document.body.textContent).toContain('New modifier from code');

    button('Build & validate').click();
    await until(() => document.body.textContent!.includes('Valid plugin') || document.body.textContent!.includes('Build failed'));
    expect(document.body.textContent).toContain('Valid plugin');
    expect(document.body.textContent).toContain('just a warning');
    expect(build.mock.calls[0]![0].source['modifier.ts']).toContain('register(new PulseTrain())');

    button('Add to stack').click();
    await until(() => !!w.emitted('add'));
    expect(w.emitted('add')![0]![0]).toBe(builtin.hash);
  }, 60_000);
});
