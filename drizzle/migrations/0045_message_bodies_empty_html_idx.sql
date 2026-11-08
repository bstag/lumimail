-- Partial index over rows stored with empty HTML by the pre-fix sanitizer (F34, 2026-11-07).
-- The scheduled body repair reads only these rows, and the index empties as they are fixed.
CREATE INDEX `message_bodies_empty_html_idx` ON `message_bodies` (`message_id`) WHERE "message_bodies"."html_body" = '';
