import { registerLiveOp } from '~/stores/live-bus-store';
import { userColor } from '~/composables/live-ops/colors';

interface CursorMovePayload {
  wx: number;
  wy: number;
  context?: 'editor' | 'live';
  livePageId?: string;
}

interface CameraSyncPayload {
  x: number;
  y: number;
  scale: number;
  context?: 'editor' | 'live';
  livePageId?: string;
}

registerLiveOp<CameraSyncPayload>('camera.sync', {
  scope: 'per-user',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ x, y, scale, context, livePageId }, _userId, ctx, sessionId) => {
    ctx.remoteCameras.set(sessionId, { x, y, scale, context, livePageId });
    ctx.triggerCameraUpdate();
  },
});

// Cursors are keyed by sessionId (one per WebSocket connection / tab) so that
// multiple tabs of the same user produce distinct cursors with distinct colors.
registerLiveOp<CursorMovePayload>('cursor.move', {
  scope: 'per-user',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ wx, wy, context, livePageId }, userId, ctx, sessionId) => {
    ctx.cursors.set(sessionId, {
      userId,
      sessionId,
      displayName: ctx.displayNameOf(userId),
      color: userColor(sessionId),
      wx,
      wy,
      context,
      livePageId,
    });
    ctx.triggerCursorUpdate();
  },
});
