INSERT INTO mailbox_memberships (id, mailbox_id, user_id, role, created_at, updated_at)
SELECT 'mbm_' || lower(hex(randomblob(12))), m.id, m.user_id, 'manager', unixepoch(), unixepoch()
FROM mailboxes m
JOIN domains d ON d.id = m.domain_id AND d.organization_id = m.organization_id
JOIN users u ON u.id = m.user_id AND u.organization_id = m.organization_id
JOIN organization_members om ON om.user_id = u.id AND om.organization_id = m.organization_id AND om.role = 'owner'
WHERE lower(u.email) = lower(m.local_part || '@' || d.hostname)
  AND NOT EXISTS (SELECT 1 FROM mailbox_memberships mbm WHERE mbm.mailbox_id = m.id);
--> statement-breakpoint
ALTER TABLE external_messages ADD COLUMN filters_pending_at integer;
--> statement-breakpoint
UPDATE `external_messages` SET `filters_pending_at` = `filters_pending_at` / 1000 WHERE `filters_pending_at` > 100000000000;
