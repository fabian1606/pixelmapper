/**
 * Group colors shared by the canvas overlay, the Distribution section and
 * the `pm.steps` grid rows (plan M4.3, M8.2): 8 distinguishable hues.
 */
export const GROUP_COLORS: readonly string[] = [
  '#f97316', // A orange
  '#3b82f6', // B blue
  '#22c55e', // C green
  '#e11d48', // D rose
  '#a855f7', // E violet
  '#eab308', // F amber
  '#06b6d4', // G cyan
  '#ec4899', // H pink
];

/** Letter of a group index ("A", "B", …). */
export const groupLetter = (i: number) => String.fromCharCode(65 + (i % 26));
