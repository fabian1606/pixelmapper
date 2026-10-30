import type { Component } from 'vue';
import { ArrowUpFromLine, CircleDot, Hand, Hourglass, MousePointerClick, ToggleRight } from 'lucide-vue-next';
import type { ButtonTrigger } from '~/utils/live/types';

/** Icon per button trigger, shared by action cards and section triggers. */
export const TRIGGER_ICONS: Record<ButtonTrigger, Component> = {
  press: CircleDot,
  double: MousePointerClick,
  long: Hourglass,
  hold: Hand,
  release: ArrowUpFromLine,
  toggle: ToggleRight,
};
