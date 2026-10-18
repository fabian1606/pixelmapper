/**
 * Generic user record sync (ADR 0004 D21, WP-RECORDS) — public API.
 * See `architecture/offline/wp-records.md`.
 */
export { createRecordCollection } from './record-collection';
export type { RecordCollection, RecordCollectionOptions, RecordSyncStatus } from './record-collection';
export {
  adoptLocalRecords,
  clearLocalRecords,
  configureRecordRemote,
  countPendingRecords,
  getRecordUser,
  recordUserId,
  setRecordUser,
  syncAllRecords,
} from './record-session';
export { createSupabaseRecordRemote } from './record-remote';
export type { RecordItem, RecordRemote, UserRecord, UserRecordRow, UserRecordRowInput } from './types';
