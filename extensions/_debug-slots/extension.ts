/**
 * `_debug-slots` — dev-only extension that renders a small label with the
 * slot id into every `:actions` (and `:start`/`:header`) slot. Used to verify
 * that core UI built from layout primitives exposes the expected slot ids.
 */
import { defineExtension } from '@pixelmapper/extension-api';
import SlotLabel from './components/SlotLabel.vue';

export default defineExtension({
  id: '_debug-slots',
  version: '0.1.0',
  apiVersion: '^1.0.0',
  displayName: 'Debug: slot ids',
  description: 'Development helper that labels extension slots with their ids.',
  contributes: {
    slots: [
      { slot: '**:actions', component: SlotLabel },
      { slot: '**:start', component: SlotLabel },
      { slot: '**:header', component: SlotLabel },
      {
        slot: '**:items',
        menuItem: {
          label: 'Debug: log scopes',
          action: scopes => console.info('[debug-slots] scopes', scopes),
        },
      },
    ],
  },
});
