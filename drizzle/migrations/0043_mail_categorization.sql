ALTER TABLE messages ADD COLUMN received_at integer;
CREATE TABLE categorization_versions (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 organization_id text REFERENCES organizations(id) ON DELETE CASCADE, config text NOT NULL, created_at integer NOT NULL
);
CREATE INDEX categorization_versions_user_idx ON categorization_versions(user_id, created_at);
CREATE TABLE categorization_preferences (
 user_id text PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
 active_version text NOT NULL REFERENCES categorization_versions(id) ON DELETE CASCADE,
 automatic integer NOT NULL DEFAULT 0, ai_consent integer NOT NULL DEFAULT 0, automatic_since integer NOT NULL, checked_at integer NOT NULL
);
CREATE TABLE categorization_results (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
 message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 version_id text NOT NULL REFERENCES categorization_versions(id) ON DELETE CASCADE,
 result text NOT NULL, created_at integer NOT NULL
);
CREATE UNIQUE INDEX categorization_results_version_idx ON categorization_results(user_id, message_id, version_id);
CREATE TABLE categorization_states (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
 message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 version_id text NOT NULL REFERENCES categorization_versions(id) ON DELETE CASCADE,
 tags text NOT NULL, applied_label_ids text NOT NULL, override_tags text
);
CREATE UNIQUE INDEX categorization_states_message_idx ON categorization_states(user_id, message_id);
CREATE TABLE categorization_jobs (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
 version_id text NOT NULL REFERENCES categorization_versions(id) ON DELETE CASCADE,
 mailbox_id text REFERENCES mailboxes(id) ON DELETE CASCADE,
 automatic integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
 since integer NOT NULL, cutoff integer NOT NULL, cursor_at integer NOT NULL, cursor_id text NOT NULL DEFAULT '',
 processed integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, error text,
 lease_token text, lease_until integer NOT NULL, created_at integer NOT NULL
);
CREATE INDEX categorization_jobs_due_idx ON categorization_jobs(status, lease_until);
CREATE INDEX categorization_jobs_user_idx ON categorization_jobs(user_id, created_at);
CREATE UNIQUE INDEX categorization_jobs_active_user_idx ON categorization_jobs(user_id) WHERE status IN ('pending', 'running');
