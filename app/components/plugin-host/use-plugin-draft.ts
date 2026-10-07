/**
 * Session draft of the "New modifier from code" dialog: sources survive
 * closing and reopening the dialog (module-level state, not persisted).
 */
import { ref } from 'vue';
import { TEMPLATE_MANIFEST, TEMPLATE_SOURCE } from '~/utils/plugins/create-plugin';

const manifestText = ref(JSON.stringify(TEMPLATE_MANIFEST, null, 2));
const modifierSource = ref(TEMPLATE_SOURCE);
const uiSource = ref('');

/** The shared draft refs and a reset to the template. */
export function usePluginDraft() {
  /** Restores the template. */
  function reset() {
    manifestText.value = JSON.stringify(TEMPLATE_MANIFEST, null, 2);
    modifierSource.value = TEMPLATE_SOURCE;
    uiSource.value = '';
  }
  return { manifestText, modifierSource, uiSource, reset };
}
