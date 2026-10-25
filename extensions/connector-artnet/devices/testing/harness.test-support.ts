/**
 * Test harness of the device flows (M6): the real host (shared globals,
 * engine store, history, custom fixture with the XBAR500 RDM IDs), the
 * fake bridge with simulated tubes, a node connector for the fake node and
 * a started `DeviceRuntime` running commands as this extension.
 *
 * Tests only — imports core (`~/…`), which extension runtime code never does.
 */
import { vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { getFixture, type Command, type FixtureId } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { runAsExtension } from '~/utils/extensions/fixture-patch-observer';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { clearFixtureChangeGuards } from '~/utils/extensions/fixture-change-guard';
import { resetRegistry } from '~/utils/extensions/registry';
import { saveCustomFixture, customFixtureKey } from '~/utils/fixture-definitions/custom-fixtures';
import { setDefinitionFetcher } from '~/utils/fixture-definitions/resolve-definition';
import { setRdmLookupFetcher } from '~/utils/fixture-definitions/rdm-lookup';
import xbar500 from '~/utils/fixture-definitions/__fixtures__/xbar500-custom.json';
import type { OflFixture } from '~/utils/ofl/types';
import { getNodeDirectory, installArtNetBackend } from '../../bridge/shared';
import { FakeArtNetBackend } from '../../bridge/testing/fake-backend';
import { makeNode } from '../../bridge/testing/fixtures';
import { ArtNetNodeConnector, activeNodeConnectors } from '../../node/node-connector';
import { DeviceRuntime } from '../device-runtime';
import { fixtureLinkState } from '../fixture-link-state';
import { ARTNET_EXTENSION_ID } from '../link';
import { FakeRdmDevices } from './fake-devices';

/** One prepared environment. */
export interface Harness {
  backend: FakeArtNetBackend;
  tubes: FakeRdmDevices;
  connector: ArtNetNodeConnector;
  runtime: DeviceRuntime;
  /** Definition key of the XBAR500 custom fixture. */
  xbarKey: string;
  /** Lets the fake bridge and the microtask-delivered observers run. */
  settle(): Promise<void>;
  /** Runs a command like the core UI (no initiator). */
  runAsUser(command: Command): void;
  /** The badge status of a fixture. */
  statusOf(fixtureId: FixtureId): string | undefined;
  /** Tears everything down. */
  dispose(): Promise<void>;
}

/** Stubs the browser pieces the engine store expects (call in `beforeAll`). */
export function stubEngineGlobals(): void {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useSupabaseClient', () => ({}));
}

/** Builds the environment; `setup` adds tubes before the node is announced. */
export async function createHarness(setup: (tubes: FakeRdmDevices) => void = () => {}): Promise<Harness> {
  setActivePinia(createPinia());
  resetRegistry();
  installSharedGlobals();
  localStorage.clear();
  const xbarKey = customFixtureKey(saveCustomFixture({ ...(xbar500 as unknown as OflFixture), pixelmapper: { rdmManufacturerId: 0x7ff0 } }));
  setRdmLookupFetcher(async () => ({ keys: [] }));
  setDefinitionFetcher(async (url) => { throw new Error(`404 ${url}`); });

  const backend = new FakeArtNetBackend();
  installArtNetBackend(backend);
  const directory = getNodeDirectory();
  const tubes = new FakeRdmDevices(backend, makeNode());
  setup(tubes);

  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0));
  };
  const connector = ArtNetNodeConnector.fromConfig('node-1', ArtNetNodeConnector.configForNode(tubes.node));
  await connector.connect(); // retains discovery → the fake bridge connects
  // Let the directory read its (empty) snapshot first: the fake answers `nodes` when asked.
  await settle();
  const history = useHistory();
  const runtime = new DeviceRuntime({
    commands: createCoreCommandFactory(ARTNET_EXTENSION_ID),
    run: command => runAsExtension(ARTNET_EXTENSION_ID, () => history.execute(command)),
  }, { backend, directory, rereadMs: 60_000 });
  runtime.start();
  tubes.announce();
  await settle();
  return {
    backend,
    tubes,
    connector,
    runtime,
    xbarKey,
    settle,
    runAsUser: command => history.execute(command),
    statusOf: (id) => {
      const view = getFixture(id);
      return view ? fixtureLinkState(runtime, view)?.status.kind : undefined;
    },
    async dispose() {
      runtime.stop();
      for (const c of [...activeNodeConnectors]) await c.disconnect();
      installArtNetBackend(null);
      clearFixtureChangeGuards();
      setRdmLookupFetcher(null);
      setDefinitionFetcher(null);
      // Empty the history so the next test starts clean.
      while (history.canUndo.value) history.undo();
    },
  };
}
