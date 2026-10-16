/**
 * ParamForm v2 (plan M5.3): editors first, bound params not twice, `when`,
 * tiers and the remembered "More" section.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import type { ParamSchema } from '@pixelmapper/extension-api';
import ParamForm from './ParamForm.vue';
import { layoutParams } from './param-form-layout';

const schema: ParamSchema = [
  { key: 'mode', type: 'enum', options: ['palette', 'shift'], default: 'shift', label: 'Mode' },
  { key: 'hueShift', type: 'number', min: -180, max: 180, default: 0, label: 'Hue shift', tier: 'hidden' },
  { key: 'hueRange', type: 'number', min: 0, max: 180, default: 40, label: 'Hue range', tier: 'hidden' },
  { key: 'transition', type: 'number', min: 0, max: 1, default: 0, label: 'Transition', when: { mode: 'palette' } },
  { key: 'saturation', type: 'number', min: 0, max: 2, default: 1, label: 'Saturation' },
  { key: 'satDip', type: 'number', min: 0, max: 1, default: 0, label: 'Saturation dip', tier: 'advanced' },
  { key: 'gain', type: 'number', min: 0, max: 1, default: 1, label: 'Gain', when: { 'distribution.mode': ['order', 'linear'] } },
];
const editors = [{ id: 'hue', input: 'pm.fader', bind: { value: 'hueShift', range: 'hueRange' }, when: { mode: 'shift' } }];

beforeEach(() => localStorage.clear());

describe('layoutParams', () => {
  it('editors by when; bound/hidden params never in the lists; advanced separate', () => {
    const l = layoutParams(schema, editors, { params: {}, distributionMode: 'none' });
    expect(l.editors.map(e => e.id)).toEqual(['hue']);
    expect(l.primary.flatMap(g => g.params.map(p => p.key))).toEqual(['mode', 'saturation']);
    expect(l.advanced.flatMap(g => g.params.map(p => p.key))).toEqual(['satDip']);
  });

  it('when on params and distribution.mode', () => {
    const l = layoutParams(schema, editors, { params: { mode: 'palette' }, distributionMode: 'order' });
    expect(l.editors).toEqual([]);
    expect(l.primary.flatMap(g => g.params.map(p => p.key))).toEqual(['mode', 'transition', 'saturation', 'gain']);
  });
});

describe('ParamForm', () => {
  it('composite editors read and write only their bound keys', async () => {
    const Stub = defineComponent({ name: 'Replaceable', props: ['name', 'modelValue'], emits: ['update:modelValue'], template: '<div :data-name="name" />' });
    const w = mount(ParamForm, { props: { schema, modelValue: { hueShift: 10, saturation: 1.5 }, editors }, global: { stubs: { Replaceable: Stub } } });
    const ed = w.findAllComponents(Stub).find(c => c.props('name') === 'pm.fader' && typeof c.props('modelValue') === 'object')!;
    expect(ed.props('modelValue')).toEqual({ value: 10, range: 40 });
    ed.vm.$emit('update:modelValue', { value: 20, range: 90 });
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ hueShift: 20, hueRange: 90, saturation: 1.5 });
  });

  it('"More" is closed by default and remembered per plugin', async () => {
    const w = mount(ParamForm, { props: { schema, modelValue: {}, moreKey: '@test/x' } });
    expect(w.find('[data-more-content]').exists()).toBe(false);
    await w.find('[data-more]').trigger('click');
    expect(w.find('[data-more-content]').text()).toContain('Saturation dip');
    const again = mount(ParamForm, { props: { schema, modelValue: {}, moreKey: '@test/x' } });
    expect(again.find('[data-more-content]').exists()).toBe(true);
  });

  it('enums with ≤ 3 options render segmented', () => {
    const w = mount(ParamForm, { props: { schema, modelValue: {} } });
    expect(w.find('[data-param="mode"] [aria-label="Mode"]').exists()).toBe(true);
  });
});
