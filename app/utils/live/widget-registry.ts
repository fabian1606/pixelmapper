/**
 * Live widget registry (ADR §5.7).
 *
 * Core widget types plus `liveWidgets` contributed by extensions. The live
 * canvas resolves a widget's component here; unknown types (e.g. from an
 * extension that is not installed) resolve to `null` and render a
 * placeholder without creating a project dependency.
 */
import { markRaw, type Component } from 'vue';
import {
  Crosshair, Drum, MousePointerClick, Palette, Projector, SlidersHorizontal, Type, Gamepad2,
} from 'lucide-vue-next';
import type { LiveMappingType } from '@pixelmapper/extension-api';
import { getContributions } from '~/utils/extensions/registry';
import { iconByName } from '~/utils/extensions/icons';
import { CORE_WIDGET_SIZES, type CoreLiveWidgetType } from './types';
import LiveButtonWidget from '~/components/live/LiveButtonWidget.vue';
import LiveSliderWidget from '~/components/live/LiveSliderWidget.vue';
import LiveXyWidget from '~/components/live/LiveXyWidget.vue';
import LiveColorWidget from '~/components/live/LiveColorWidget.vue';
import LiveLabelWidget from '~/components/live/LiveLabelWidget.vue';
import LiveBeatWidget from '~/components/live/LiveBeatWidget.vue';
import LiveFixturePreviewWidget from '~/components/live/LiveFixturePreviewWidget.vue';
import LiveControllerTwinWidget from '~/components/live/LiveControllerTwinWidget.vue';

/** A resolved widget type, core or extension. */
export interface WidgetTypeInfo {
  type: string;
  label: string;
  icon: Component;
  component: Component;
  /** Grid footprint for new widgets. */
  defaultSize: [number, number];
  /** Owning extension, `null` for core widgets. */
  extensionId: string | null;
  /** Shown in the add sidebar (controller twins are added per controller). */
  addable: boolean;
  /** Initial extension data for new widgets (extension widgets only). */
  defaultConfig?: () => Record<string, unknown>;
  mappingTypes?: LiveMappingType[];
}

/** Core widget types in add-sidebar order. */
const CORE_WIDGETS: Omit<WidgetTypeInfo, 'defaultSize' | 'extensionId'>[] = [
  { type: 'button', label: 'Button', icon: MousePointerClick, component: LiveButtonWidget, addable: true },
  { type: 'slider', label: 'Slider', icon: SlidersHorizontal, component: LiveSliderWidget, addable: true },
  { type: 'xy', label: 'XY Pad', icon: Crosshair, component: LiveXyWidget, addable: true },
  { type: 'label', label: 'Label', icon: Type, component: LiveLabelWidget, addable: true },
  { type: 'fixture-preview', label: 'Preview', icon: Projector, component: LiveFixturePreviewWidget, addable: true },
  { type: 'color', label: 'Color', icon: Palette, component: LiveColorWidget, addable: true },
  { type: 'beat', label: 'Beat', icon: Drum, component: LiveBeatWidget, addable: true },
  { type: 'controller-twin', label: 'Controller', icon: Gamepad2, component: LiveControllerTwinWidget, addable: false },
];

/** Resolves a lucide icon name used by an extension (re-exported for existing callers). */
export { iconByName } from '~/utils/extensions/icons';

/** All known widget types: core first, then extension widgets by extension id. */
export function listWidgetTypes(): WidgetTypeInfo[] {
  const core = CORE_WIDGETS.map(w => ({
    ...w,
    component: markRaw(w.component),
    defaultSize: CORE_WIDGET_SIZES[w.type as CoreLiveWidgetType],
    extensionId: null,
  }));
  const ext = getContributions('liveWidgets').map(({ extensionId, contribution: d }) => ({
    type: d.type,
    label: d.label,
    icon: iconByName(d.icon),
    component: markRaw(d.component),
    defaultSize: (d.defaultSize ? [d.defaultSize.w, d.defaultSize.h] : [4, 4]) as [number, number],
    extensionId,
    addable: true,
    defaultConfig: d.defaultConfig,
    mappingTypes: d.mappingTypes,
  }));
  return [...core, ...ext];
}

/** Resolves a widget type, or `null` when unknown (render a placeholder). */
export function resolveWidgetType(type: string): WidgetTypeInfo | null {
  return listWidgetTypes().find(w => w.type === type) ?? null;
}
