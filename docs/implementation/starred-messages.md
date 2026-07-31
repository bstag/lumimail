# Starred Messages

Implemented in: `2026-06-18`

## Overview

Users can star/unstar any message. Starred messages appear in a dedicated Starred folder accessible from the sidebar.

## Schema

```sql
ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
```

## API

### Toggle star
```
PATCH /api/messages/[messageId]/starred
{ "starred": true | false }
→ { "starred": true | false }
```

### List starred messages
```
GET /api/messages?starred=true
```

## UI

- **Starred page**: `/starred` — shows all starred messages
- **Star button**: inline ⭐ toggle on each message row in any folder, in the
  leading slot between the checkbox and the sender
- **Sidebar**: "Starred" link with Star icon

## Notes

- Stars are per-user, not per-mailbox
- Starred messages appear independently of their folder status
- The row previously also rendered a per-folder icon in that leading slot. On
  inbox and starred that icon was a `Star`, so each row showed two stars and
  only the trailing one responded to clicks. The toggle took over the slot and
  the per-folder icon was dropped — the folder is already established by the
  page, so repeating it on every row said nothing.
- Covered by `tests/e2e/message-list-star.spec.ts`
