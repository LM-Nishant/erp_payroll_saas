import type { WeeklyOffRule } from '@erp/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import WeeklyOffsPicker from './WeeklyOffsPicker.vue';

function mountPicker(initial: WeeklyOffRule[]) {
  const state = { value: initial };
  const wrapper = mount(WeeklyOffsPicker, {
    props: {
      modelValue: initial,
      'onUpdate:modelValue': (v: WeeklyOffRule[]) => {
        state.value = v;
        void wrapper.setProps({ modelValue: v });
      },
    },
    global: { plugins: [createVuetify({ components })] },
  });
  return { wrapper, state };
}

describe('WeeklyOffsPicker', () => {
  it('applies the "Sunday + 2nd & 4th Saturday" preset', async () => {
    const { wrapper, state } = mountPicker([{ weekday: 0 }]);
    const preset = wrapper
      .findAll('.v-chip')
      .find((c) => c.text() === 'Sunday + 2nd & 4th Saturday');
    expect(preset).toBeDefined();
    await preset!.trigger('click');
    expect(state.value).toEqual([{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }]);
    expect(wrapper.text()).toContain('every Sunday + 2nd, 4th Saturday');
  });

  it('summarises existing alternate-Saturday rules', () => {
    const { wrapper } = mountPicker([{ weekday: 0 }, { weekday: 6, weeks: [1, 3, 5] }]);
    expect(wrapper.text()).toContain('every Sunday + 1st, 3rd, 5th Saturday');
  });
});
