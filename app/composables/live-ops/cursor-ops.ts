import { registerLiveOp } from '~/stores/live-bus-store';
import { userColor } from '~/composables/live-ops/colors';

interface CursorMovePayload {
  wx: number;
  wy: number;
}

// Cursors are keyed by sessionId (one per WebSocket connection / tab) so that
// multiple tabs of the same user produce distinct cursors with distinct colors.
registerLiveOp<CursorMovePayload>('cursor.move', {
  scope: 'per-user',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ wx, wy }, userId, ctx, sessionId) => {
    ctx.cursors.set(sessionId, {
      userId,
      sessionId,
      displayName: ctx.displayNameOf(userId),
      color: userColor(sessionId),
      wx,
      wy,
    });
    ctx.triggerCursorUpdate();
  },
});
