import { registerLiveOp, useLiveBusStore } from '~/stores/live-bus-store';

// Emitted when a user navigates between editor / live, or changes their
// active live page. Followers react to this event by navigating themselves.

export interface UserPageChangePayload {
  viewMode: 'editor' | 'live';
  livePageId?: string;
}

registerLiveOp<UserPageChangePayload>('user.pageChange', {
  scope: 'per-user',
  throttle: 'immediate',
  apply: (payload, _userId, _ctx, sessionId) => {
    // Forward to the live-bus store, which decides whether to follow.
    const liveBus = useLiveBusStore();
    liveBus.handlePageChange(sessionId, payload);
  },
});
