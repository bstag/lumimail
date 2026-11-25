CREATE INDEX messages_mailbox_list_order_idx ON messages (
  mailbox_id,
  (CASE WHEN status = 'received' THEN coalesce(snoozed_until, created_at) ELSE created_at END),
  id
);
