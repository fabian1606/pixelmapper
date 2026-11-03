/**
 * Hardware controllers from extensions (ADR §5.7, plan P6.4), resolved into
 * the shape the core live-mode twin and the controller store use. Replaces
 * the former `controllers/` folder glob.
 */
import type { MidiPortInfo } from '@pixelmapper/extension-api';
import type { ControllerDefinition } from './types';
import { getContributions } from '~/utils/extensions/registry';

/** All registered controllers (resolved). */
export function listControllerDefinitions(): ControllerDefinition[] {
  return getContributions('controllers').map(({ contribution: d }) => ({
    key: d.id,
    label: d.label,
    vendor: d.vendor ?? '',
    model: d.model ?? '',
    svg: d.layoutSvg ?? '',
    viewBox: d.viewBox ?? { w: 100, h: 100 },
    defaultGridSize: d.defaultGridSize ?? { w: 8, h: 8 },
    controls: (d.controls ?? []).map(c => ({ ...c, defaultMapping: c.defaultMapping as ControllerDefinition['controls'][number]['defaultMapping'] })),
    matches: d.matches?.bind(d),
    driverFactory: d.createDriver as ControllerDefinition['driverFactory'],
  }));
}

/** A controller by key (null when its extension is not installed). */
export function getControllerDefinition(key: string): ControllerDefinition | null {
  return listControllerDefinitions().find(d => d.key === key) ?? null;
}

/** The controller that claims a MIDI port (its messages belong to that twin), if any. */
export function controllerForPort(port: MidiPortInfo): ControllerDefinition | null {
  return listControllerDefinitions().find(d => d.matches?.(port)) ?? null;
}
