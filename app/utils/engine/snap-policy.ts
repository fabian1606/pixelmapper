export type ZoomTier = 'near' | 'mid' | 'far';

/**
 * Returns the active snap spacing (in whatever world unit the caller uses),
 * or null if snapping is off. Shift forces snap on when zoomed in close
 * ("near"), and inverts (disables) the default auto-snap when zoomed further
 * out ("mid"/"far") — a consistent "shift flips the current behavior" model
 * shared by the 2D and 3D viewports.
 */
export function resolveSnapSpacing(
  tier: ZoomTier,
  shiftHeld: boolean,
  fineSpacing: number,
  coarseSpacing: number,
): number | null {
  if (tier === 'near') return shiftHeld ? fineSpacing : null;
  const defaultSpacing = tier === 'far' ? coarseSpacing : fineSpacing;
  return shiftHeld ? null : defaultSpacing;
}
