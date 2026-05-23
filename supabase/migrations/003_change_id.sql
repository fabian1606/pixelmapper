-- Add client-generated change_id so the push-change endpoint can be idempotent.
-- This allows the IndexedDB WAL to safely retry pushes on reload / crash without
-- creating duplicate project_changes entries.

ALTER TABLE project_changes
  ADD COLUMN change_id uuid;

-- Backfill existing rows with random UUIDs so the NOT NULL constraint is satisfiable.
UPDATE project_changes SET change_id = gen_random_uuid() WHERE change_id IS NULL;

ALTER TABLE project_changes
  ALTER COLUMN change_id SET NOT NULL,
  ADD CONSTRAINT project_changes_change_id_unique UNIQUE (project_id, change_id);
