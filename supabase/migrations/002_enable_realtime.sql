-- Enable Realtime CDC on project_changes so Postgres Changes subscriptions work
ALTER PUBLICATION supabase_realtime ADD TABLE project_changes;
