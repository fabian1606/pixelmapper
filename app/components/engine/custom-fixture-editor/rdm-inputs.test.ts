/**
 * Component tests for the custom fixture editor's RDM inputs and the
 * "Import OFL JSON" header action (plan M4.7).
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RdmIdInput from './Sidebar/RdmIdInput.vue';
import ModeRdmPersonality from './ChannelEditor/ModeManager/ModeRdmPersonality.vue';
import CustomFixtureHeader from './Header/CustomFixtureHeader.vue';

describe('RdmIdInput', () => {
  it('shows the value as hex and emits parsed decimal / hex input', async () => {
    const wrapper = mount(RdmIdInput, { props: { modelValue: 0x7ff0, label: 'Manufacturer' } });
    const input = wrapper.get('input');
    expect(input.element.value).toBe('0x7FF0');

    await input.setValue('42');
    await input.setValue('0x2A');
    await input.setValue('');
    expect(wrapper.emitted('update:modelValue')).toEqual([[42], [42], [null]]);
  });

  it('flags invalid input without emitting it', async () => {
    const wrapper = mount(RdmIdInput, { props: { modelValue: null, label: 'Model' } });
    await wrapper.get('input').setValue('0x10000');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.text()).toContain('Enter 0–65535 or hex like 0x7FF0.');
  });

  it('reformats to hex on blur', async () => {
    const wrapper = mount(RdmIdInput, { props: { modelValue: null, label: 'Model' } });
    const input = wrapper.get('input');
    await input.trigger('focus');
    await input.setValue('1');
    await wrapper.setProps({ modelValue: 1 });
    await input.trigger('blur');
    expect(input.element.value).toBe('0x0001');
  });
});

describe('ModeRdmPersonality', () => {
  it('emits positive integers, undefined when cleared, nothing when invalid', async () => {
    const wrapper = mount(ModeRdmPersonality, { props: { modelValue: 2 } });
    const input = wrapper.get('input');
    expect(input.element.value).toBe('2');

    await input.setValue('0');
    expect(wrapper.text()).toContain('Positive whole number');
    await input.setValue('4');
    await input.setValue('');
    expect(wrapper.emitted('update:modelValue')).toEqual([[4], [undefined]]);
  });
});

describe('CustomFixtureHeader', () => {
  const steps = [{ id: 'general', label: 'General Info' }] as const;

  it('emits the picked JSON file from the import action', async () => {
    const wrapper = mount(CustomFixtureHeader, { props: { steps, currentStepIdx: 0, canImport: true } });
    expect(wrapper.text()).toContain('Import OFL JSON');

    const fileInput = wrapper.get('input[type="file"]');
    const file = new File(['{}'], 'fixture.json', { type: 'application/json' });
    Object.defineProperty(fileInput.element, 'files', { value: [file] });
    await fileInput.trigger('change');
    expect(wrapper.emitted('importOflJson')).toEqual([[file]]);
  });

  it('hides the import action when importing is not possible', () => {
    const wrapper = mount(CustomFixtureHeader, { props: { steps, currentStepIdx: 0, canImport: false } });
    expect(wrapper.text()).not.toContain('Import OFL JSON');
  });
});
