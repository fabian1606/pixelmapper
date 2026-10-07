/**
 * Fixture type mapping for the Custom Fixture Editor.
 *
 * Derived from the official Open Fixture Library (OFL) category schema.
 * The OFL categories are: Barrel Scanner, Blinder, Color Changer, Dimmer,
 * Effect, Fan, Flower, Hazer, Laser, Matrix, Moving Head, Pixel Bar,
 * Scanner, Smoke, Stand, Strobe, Other.
 *
 * Canvas rendering mirrors the main Rust canvas (render.rs):
 *  - Single beam   → circle  (Color Changer, Moving Head, Blinder, etc.)
 *  - N×1 beams     → pixel bar  (Pixel Bar)
 *  - N×M beams     → matrix grid (Matrix)
 */

export type OflCategory =
  | 'Barrel Scanner'
  | 'Blinder'
  | 'Color Changer'
  | 'Dimmer'
  | 'Effect'
  | 'Fan'
  | 'Flower'
  | 'Hazer'
  | 'Laser'
  | 'Matrix'
  | 'Moving Head'
  | 'Pixel Bar'
  | 'Scanner'
  | 'Smoke'
  | 'Stand'
  | 'Strobe'
  | 'Other';

/** Which canvas rendering mode a category uses. */
export type CanvasRenderMode = 'single' | 'bar' | 'matrix';

/** Metadata about a fixture category shown in the sidebar. */
export interface FixtureCategoryMeta {
  label: string;
  icon: string; // lucide icon name or emoji fallback
  renderMode: CanvasRenderMode;
  /** Whether pixel count controls (cols/rows) should be shown. */
  hasPixelDensity: boolean;
}

/** Maps each OFL category to its display metadata. */
export const FIXTURE_CATEGORIES: Record<OflCategory, FixtureCategoryMeta> = {
  'Moving Head':    { label: 'Moving Head',   icon: 'spotlight',    renderMode: 'single',     hasPixelDensity: false },
  'Color Changer':  { label: 'Color Changer', icon: 'lamp',         renderMode: 'single',     hasPixelDensity: false },
  'Dimmer':         { label: 'Dimmer',         icon: 'sunset',       renderMode: 'single',     hasPixelDensity: false },
  'Blinder':        { label: 'Blinder',        icon: 'eye-off',      renderMode: 'single',     hasPixelDensity: false },
  'Strobe':         { label: 'Strobe',         icon: 'zap',          renderMode: 'single',     hasPixelDensity: false },
  'Scanner':        { label: 'Scanner',        icon: 'scan',         renderMode: 'single',     hasPixelDensity: false },
  'Barrel Scanner': { label: 'Barrel Scanner', icon: 'rotate-cw',    renderMode: 'single',     hasPixelDensity: false },
  'Laser':          { label: 'Laser',          icon: 'crosshair',    renderMode: 'single',     hasPixelDensity: false },
  'Effect':         { label: 'Effect',         icon: 'sparkles',     renderMode: 'single',     hasPixelDensity: false },
  'Flower':         { label: 'Flower',         icon: 'flower',       renderMode: 'single',     hasPixelDensity: false },
  'Pixel Bar':      { label: 'Pixel Bar',      icon: 'align-justify',renderMode: 'bar',        hasPixelDensity: true  },
  'Matrix':         { label: 'Matrix',         icon: 'grid',         renderMode: 'matrix',     hasPixelDensity: true  },
  'Smoke':          { label: 'Smoke / Fog',    icon: 'cloud',        renderMode: 'single',     hasPixelDensity: false },
  'Hazer':          { label: 'Hazer',          icon: 'wind',         renderMode: 'single',     hasPixelDensity: false },
  'Fan':            { label: 'Fan',            icon: 'wind',         renderMode: 'single',     hasPixelDensity: false },
  'Stand':          { label: 'Stand',          icon: 'box',          renderMode: 'single',     hasPixelDensity: false },
  'Other':          { label: 'Other',          icon: 'circle',       renderMode: 'single',     hasPixelDensity: false },
};

// ─── Schema-driven form field descriptors ────────────────────────────────────

/** A plain text input. */
interface TextField {
  kind: 'text';
  placeholder?: string;
}
/** A multiline text input. */
interface TextareaField {
  kind: 'textarea';
  placeholder?: string;
  rows?: number;
}
/** A single draggable number input. `dragLabel` is the short handle text; `unit` is the suffix. */
interface NumberField {
  kind: 'number';
  /** Short handle label on the left drag zone (e.g. "POWER", "CCT"). */
  dragLabel: string;
  /** Unit shown as suffix on the right (e.g. "W", "K", "cm"). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}
/** Two draggable number inputs side by side. Each can have its own drag label and unit. */
interface NumberPairField {
  kind: 'number-pair';
  dragLabels: [string, string];
  /** Per-value unit suffixes (e.g. ['cm', 'kg'] or ['°', '°']). */
  units?: [string, string];
  min?: number;
  max?: number;
  step?: number;
  /** Keys in CustomFixtureFormState for the first and second value. */
  keys: [string, string];
}
/** A select dropdown. */
interface SelectField {
  kind: 'select';
  options: readonly string[];
  placeholder?: string;
  noneLabel?: string;
}

type WithMeta = {
  key?: string;
  /** Section heading shown above the first field in this group. */
  section?: string;
};

export type FormFieldDescriptor =
  | (TextField      & WithMeta)
  | (TextareaField  & WithMeta)
  | (NumberField    & WithMeta)
  | (NumberPairField & WithMeta)
  | (SelectField    & WithMeta);

import { z } from 'zod';

export const DMX_CONNECTORS = [
  '3-pin', '3-pin (swapped +/-)', '3-pin XLR IP65',
  '5-pin', '5-pin XLR IP65', '3-pin and 5-pin',
  '3.5mm stereo jack', 'RJ45',
] as const;

export const OFL_FIXTURE_CATEGORIES = [
  'Moving Head', 'Color Changer', 'Dimmer', 'Blinder', 'Strobe',
  'Scanner', 'Barrel Scanner', 'Laser', 'Effect', 'Flower',
  'Pixel Bar', 'Matrix', 'Smoke', 'Hazer', 'Fan', 'Stand', 'Other',
] as const;

export type OflFixtureCategory = typeof OFL_FIXTURE_CATEGORIES[number];

/**
 * Zod schema for the custom fixture general-info form state.
 * All fields are annotated with `.describe()` so an LLM can understand
 * what each field represents and generate appropriate values.
 */
export const CustomFixtureFormSchema = z.object({
  fixtureName:      z.string().describe('Full product name of the fixture (e.g. "Robe Robin 100 LED Wash")'),
  shortName:        z.string().describe('Abbreviated name used in tight UI spaces (e.g. "R100W"). Max ~10 chars.').optional().default(''),
  manufacturer:     z.string().describe('Brand or manufacturer name (e.g. "Chauvet DJ", "Martin", "Robe")').optional().default(''),
  comment:          z.string().describe('Any additional notes about this fixture, e.g. revision, known quirks').optional().default(''),

  // Primary classification — choose the SINGLE best-matching category:
  //   Moving Head   = motorized pan/tilt fixture (e.g. Sharpy, Pointe)
  //   Color Changer = static LED wash / PAR that changes color (RGBW, etc.) — USE THIS for LED wash/pars that do NOT move
  //   Dimmer        = simple dimmer pack (no color changing)
  //   Blinder       = high-output blinder / audience blinder
  //   Strobe        = dedicated strobe with few extra functions
  //   Scanner       = mirror-scan fixture (motor moves the mirror only)
  //   Barrel Scanner= rotating barrel / prism scanner
  //   Laser         = dedicated laser projector
  //   Effect        = derby, moon flower, other effect light (NOT laser)
  //   Flower        = Flower-style rotating color petal light
  //   Pixel Bar     = linear addressable LED bar (e.g. ADJ Pixel Bar series)
  //   Matrix        = 2-D addressable LED pixel grid
  //   Smoke         = smoke / fog machine
  //   Hazer         = haze machine
  //   Fan           = DMX-controlled fan
  //   Stand         = structural stand / truss accessory
  //   Other         = use ONLY if nothing else fits
  category: z.enum(OFL_FIXTURE_CATEGORIES)
    .describe('OFL fixture category — pick the single most fitting value from the enum. An LED PAR or RGBW wash that cannot move is "Color Changer", not "Other".')
    .optional().default('Other'),

  fixtureWidth:     z.number().min(1).max(5000).describe('Physical width of the fixture housing in millimetres').optional().default(300),
  fixtureHeight:    z.number().min(1).max(5000).describe('Physical height of the fixture housing in millimetres').optional().default(300),
  fixtureDepth:     z.number().min(0).max(9999).describe('Physical depth (front-to-back) of the fixture housing in millimetres').optional().default(300),
  weight:           z.number().min(0).max(999).describe('Weight of the fixture in kilograms').optional().default(0),
  power:            z.number().min(0).max(9999).describe('Power consumption in watts at full load').optional().default(0),

  dmxConnector:     z.enum(DMX_CONNECTORS).or(z.literal('')).describe('Physical DMX connector type on the fixture').optional().default(''),
  bulbType:         z.string().describe('Light source technology (e.g. "LED", "Halogen", "Discharge")').optional().default(''),
  colorTemperature: z.number().min(1000).max(20000).describe('Colour temperature of the light source in Kelvin. 0 means unspecified.').optional().default(0),
  beamAngleMin:     z.number().min(0).max(360).describe('Minimum beam angle in degrees (narrow end of zoom range)').optional().default(0),
  beamAngleMax:     z.number().min(0).max(360).describe('Maximum beam angle in degrees (wide end of zoom range). Equal to Min if no zoom.').optional().default(0),
});


/** All editable state for the custom fixture general-info form. Derived from the Zod schema. */
export type CustomFixtureFormState = z.infer<typeof CustomFixtureFormSchema>;


/**
 * Descriptor list for the Step 1 "General Info" form.
 * Section headings and field labels are derived from Zod schema `.describe()` annotations.
 */
export const GENERAL_INFO_FIELDS: FormFieldDescriptor[] = [
  // ── General (OFL: name, shortName, comment) ───────────────────────────────
  { section: 'General', key: 'fixtureName',  kind: 'text',     placeholder: 'Fixture Name *' },
  {                      key: 'shortName',   kind: 'text',     placeholder: 'Short Name (e.g. MH300)' },
  {                      key: 'manufacturer',kind: 'text',     placeholder: 'Manufacturer' },
  {                      key: 'comment',     kind: 'textarea', placeholder: 'Description / Notes', rows: 2 },

  // ── Physical Dimensions (OFL: physical.dimensions) ───────────────────────
  {
    section: 'Physical Dimensions (mm)',
    kind: 'number-pair',
    keys: ['fixtureWidth', 'fixtureHeight'],
    dragLabels: ['Width', 'Height'],
    units: ['mm', 'mm'],
    min: 1, max: 5000, step: 10,
  },
  {
    kind: 'number-pair',
    keys: ['fixtureDepth', 'weight'],
    dragLabels: ['Depth', 'Weight'],
    units: ['mm', 'kg'],
    min: 0, max: 9999, step: 1,
  },
  {
    key: 'power',
    kind: 'number',
    dragLabel: 'Power',
    unit: 'W',
    min: 0, max: 9999, step: 10,
  },

  // ── DMX Connector (OFL: physical.DMXconnector) ───────────────────────────
  {
    section: 'DMX Connector',
    key: 'dmxConnector',
    kind: 'select',
    options: DMX_CONNECTORS,
    placeholder: 'Select connector',
    noneLabel: 'Not specified',
  },

  // ── Light Source (OFL: physical.bulb.type, .colorTemperature) ────────────
  { section: 'Light Source', key: 'bulbType',        kind: 'text',   placeholder: 'Bulb Type (e.g. LED, Halogen)' },
  {                          key: 'colorTemperature', kind: 'number', dragLabel: 'Color Temp', unit: 'K', min: 1000, max: 20000, step: 100 },

  // ── Beam Angle (OFL: physical.lens.degreesMinMax) ─────────────────────────
  {
    section: 'Beam Angle (°)',
    kind: 'number-pair',
    keys: ['beamAngleMin', 'beamAngleMax'],
    dragLabels: ['Min', 'Max'],
    units: ['°', '°'],
    min: 0, max: 360, step: 0.5,
  },
];

/**
 * Validation schema for the Step 1 "Next" gate.
 * Only `fixtureName` is required; everything else is optional.
 */
export const Step1Schema = CustomFixtureFormSchema.pick({ fixtureName: true }).extend({
  fixtureName: z.string().min(1, 'Fixture Name is required'),
});

/** Ordered list of categories for the select dropdown. */
export const CATEGORY_OPTIONS: OflCategory[] = [
  'Moving Head',
  'Color Changer',
  'Dimmer',
  'Blinder',
  'Strobe',
  'Scanner',
  'Barrel Scanner',
  'Laser',
  'Effect',
  'Flower',
  'Pixel Bar',
  'Matrix',
  'Smoke',
  'Hazer',
  'Fan',
  'Stand',
  'Other',
];

// ─── Re-exports from split modules ───────────────────────────────────────────
export * from './custom-fixture-channel-types';
export * from './custom-fixture-capability-schemas';
