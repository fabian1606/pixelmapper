/**
 * Generic RDM parameter form (plan M7.1): the component, its composable
 * and the pure field model (fields from `rdmDescribe`, value codec, units,
 * NACK messages). Used by the node's connector card (M7.3) and the fixture
 * inspector's RDM section (M7.2).
 */
export { default as RdmParameterForm } from './RdmParameterForm.vue';
export { RDM_SETTINGS_REREAD_MS, useRdmParameterForm, runLimited, type RdmFieldState, type RdmParameterFormOptions } from './use-rdm-parameter-form';
export type {
  BuildFieldsOptions,
  RdmActionField,
  RdmBitFieldField,
  RdmBooleanField,
  RdmEnumField,
  RdmFieldKind,
  RdmFieldSource,
  RdmFieldValue,
  RdmNumberField,
  RdmParameterField,
  RdmRawField,
  RdmStringField,
} from './field-types';
export { buildParameterFields, fieldFromDescription, formatPid, isFormPid, uidManufacturer } from './parameter-fields';
export {
  decodeFieldValue,
  encodeFieldData,
  formatBitField,
  formatFieldValue,
  parseBitField,
  toRdmValue,
  validateFieldValue,
  type RdmReading,
} from './parameter-codec';
export {
  DEDICATED_STANDARD_PIDS,
  KNOWN_STANDARD_PARAMETERS,
  NODE_FLOW_PIDS,
  TUBE_BOOTLOADER_PIDS,
  isPixelmapperNode,
  type RdmEnumOption,
} from './known-parameters';
export { RDM_PREFIXES, RDM_UNITS, displayScale, formatWithUnit, rdmPrefix, rdmUnit, type RdmDisplayScale } from './rdm-units';
export { NACK_MESSAGES, describeNack, describeRdmError } from './rdm-errors';
export { RdmValueError, type RdmIntLayout } from './wire-bytes';
