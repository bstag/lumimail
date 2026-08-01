-- F75: one level of label nesting.
--
-- ON DELETE SET NULL is what implements "deleting a parent promotes its children
-- to top level" — enforced by the database rather than by application code that a
-- future caller could bypass. Depth (one level) and cycle rules are enforced in
-- the route handler; SQLite cannot express them as a constraint.
ALTER TABLE `labels` ADD `parent_id` text REFERENCES labels(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `labels_user_parent_idx` ON `labels` (`user_id`,`parent_id`);
