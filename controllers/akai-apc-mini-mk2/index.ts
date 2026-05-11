import type { ControllerDefinition, ControllerControl } from '~/utils/controllers/types';
import { driverFactory } from './driver';

// ── SVG geometry (viewBox 0 0 433 372) ──────────────────────────────────────
// All values measured from layout.svg paths.

const PAD_W = 37.97;
const PAD_H = 19.22;
const PAD_COL_RIGHTS = [55.195, 100.905, 146.615, 192.325, 238.035, 283.745, 329.455, 375.165];
const PAD_ROW_TOPS   = [221.817, 195.881, 169.945, 144.009, 118.073, 92.137, 66.201, 40.265];

const TRACK_W = 10.811, TRACK_H = 10.811, TRACK_Y = 250.298;
const TRACK_RIGHTS = [41.086, 86.728, 132.371, 178.013, 223.656, 269.298, 314.940, 360.583];

const SCENE_W = 10.811, SCENE_H = 10.811;
const SCENE_RIGHTS = [405.991, 406.127, 405.905, 406.225, 405.995, 405.699, 406.036, 406.211];
const SCENE_YS     = [44.469,  70.005,  96.463, 121.848, 147.697, 173.549, 199.162, 225.196];

const FADER_W = 25.8, FADER_H = 83.55, FADER_Y = 277.714;
const FADER_RIGHTS = [51, 96.575, 142.15, 187.725, 233.3, 278.875, 324.45, 370.025, 415.6];

// SVG ids in this controller's layout.svg use the MIDI value in hex,
// prefixed with "_" for buttons (since IDs can't start with a digit) and
// "F" for faders. Helper:
const hexId = (n: number) => `_0x${n.toString(16).padStart(2, '0')}`;
const faderId = (cc: number) => `F0x${cc.toString(16)}`;

const PAD_NOTE_BASE   = 0;
const TRACK_NOTE_BASE = 100;
const SCENE_NOTE_BASE = 112;
const SHIFT_NOTE      = 122;
const FADER_CC_BASE   = 48;

const controls: ControllerControl[] = [];

// 64 RGB pads (8×8)
for (let row = 0; row < 8; row++) {
  for (let col = 0; col < 8; col++) {
    const note = PAD_NOTE_BASE + row * 8 + col;
    controls.push({
      id:    `pad-${row}-${col}`,
      type:  'button',
      label: `Pad ${row},${col}`,
      svgId: hexId(note),
      rect:  { x: PAD_COL_RIGHTS[col] - PAD_W, y: PAD_ROW_TOPS[row], w: PAD_W, h: PAD_H },
    });
  }
}

// 8 track buttons
for (let i = 0; i < 8; i++) {
  controls.push({
    id:    `track-${i}`,
    type:  'button',
    label: `Track ${i + 1}`,
    svgId: hexId(TRACK_NOTE_BASE + i),
    rect:  { x: TRACK_RIGHTS[i] - TRACK_W, y: TRACK_Y, w: TRACK_W, h: TRACK_H },
  });
}

// 8 scene buttons
for (let i = 0; i < 8; i++) {
  controls.push({
    id:    `scene-${i}`,
    type:  'button',
    label: `Scene ${i + 1}`,
    svgId: hexId(SCENE_NOTE_BASE + i),
    rect:  { x: SCENE_RIGHTS[i] - SCENE_W, y: SCENE_YS[i], w: SCENE_W, h: SCENE_H },
  });
}

// Shift
controls.push({
  id:    'shift',
  type:  'button',
  label: 'Shift',
  svgId: hexId(SHIFT_NOTE),
  rect:  { x: 406.225 - 10.811, y: 250.298, w: 10.811, h: 10.811 },
});

// 9 faders (0–7 channel + 8 master)
for (let i = 0; i < 9; i++) {
  controls.push({
    id:    `fader-${i}`,
    type:  'slider',
    label: i < 8 ? `Fader ${i + 1}` : 'Master',
    svgId: faderId(FADER_CC_BASE + i),
    rect:  { x: FADER_RIGHTS[i] - FADER_W, y: FADER_Y, w: FADER_W, h: FADER_H },
  });
}

const definition: ControllerDefinition = {
  key:    'akai-apc-mini-mk2',
  label:  'AKAI APC Mini mk2',
  vendor: 'AKAI',
  model:  'APC Mini mk2',
  svg:    '',
  viewBox: { w: 433, h: 372 },
  defaultGridSize: { w: 20, h: 17 },
  controls,
  driverFactory,
};

export default definition;
