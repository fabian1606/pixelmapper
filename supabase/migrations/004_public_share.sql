-- Public share link for the read-only patch table.
-- A nullable token on the project; when set, the `load-shared-project` edge
-- function (service-role) resolves it to the latest snapshot's patch data.
-- No new RLS policy is needed: anon still has no direct read access — public
-- reads go exclusively through the service-role edge function.

ALTER TABLE projects
  ADD COLUMN public_share_token uuid;

CREATE UNIQUE INDEX projects_public_share_token_key
  ON projects (public_share_token);
