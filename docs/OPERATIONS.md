# Lumimail operational procedures

Backup, restore, rollback, and the data-egress inventory required by
[R-18](REMEDIATION_PLAN.md#phase-5--operational-hardening).

Resource identifiers are deliberately **not** recorded here. The database id, account
id, and zone ids live in `wrangler.jsonc`, which is gitignored; `wrangler.jsonc.example`
documents the shape. Commands below name resources by binding or name so they work
without secrets in this file.

## Backup

`wrangler d1 export` produces a complete SQL dump — schema, indexes, and rows.

```bash
wrangler d1 export DB --remote --output lumimail-backup.sql
```

**The dump contains message bodies, addresses, and password hashes.** Treat it as
production data: write it outside the repository, keep it encrypted at rest, and delete
it when it is no longer needed. It must never be committed.

Exercised 2026-07-25: 29 tables, 152 rows, 78 KB.

### What the dump does not contain

- R2 objects. Attachments and any retained raw MIME live in the bucket, not D1, so a D1 dump alone cannot restore a mailbox's attachments. A complete backup requires an R2 copy as well; that is **not yet exercised** and is recorded as an open gap below.
- Secrets. `CF_TOKEN` and any provider key are Worker secrets, not database rows.
- Queue contents. In-flight messages are held by Cloudflare Queues.

## Restore

A dump restores by executing it against an empty database.

```bash
# Into a fresh local database, to rehearse without touching production:
wrangler d1 execute DB --local --file lumimail-backup.sql
```

Restoring **over** production is destructive and is not a routine operation. Create a
new database, restore into it, verify, then repoint the binding — rather than importing
over live data.

Verified 2026-07-25 by restoring the dump into a throwaway database and checking:

| Check | Result |
|---|---|
| Tables restored | 29 |
| Indexes restored | 40 |
| `messages` / `message_bodies` | 34 / 34, one-to-one |
| Orphaned messages after restore | 0 |

The orphan check matters more than the row counts: it proves foreign-key relationships
survived the round trip rather than merely that rows arrived.

## Rollback

### Worker code

```bash
wrangler versions list          # find the target version id
wrangler rollback <version-id>
```

Version history is retained, so any recent deployment can be restored.

### Database — read this before rolling back

**Migrations are forward-only. Rolling back the Worker does not roll back D1.** A
deployment that applied a migration leaves the schema changed after the code is
reverted, so the older code runs against a newer schema.

Whether that is safe depends on the migration:

| Migration shape | Safe to roll back code? |
|---|---|
| Added a table or index (`0018`, `0024`) | Yes — older code ignores it |
| Added a nullable or defaulted column (`0017`, `0021`) | Yes — older code ignores it |
| Rebuilt or re-keyed a table (`0022`) | **No** — older code queries a column that no longer exists |
| Deleted rows (`0019`, `0023`, `0024`'s session purge) | Code rolls back; the data does not return |

Before rolling back past a migration, take a backup, then decide whether to write a
forward migration that restores the old shape. Reverting the SQL file is not sufficient,
because an applied migration is recorded in `d1_migrations` and will not re-run.

## Data-egress inventory

Every path by which data leaves the deployment, audited 2026-07-25.

### Cloudflare Workers logs

`observability` is enabled, so `console` output is retained by Cloudflare.

| Emitted | Where |
|---|---|
| Recipient address of an unroutable message | `inbound.ts` — "No routing for inbound address" |
| Recipient address of a rejected message | `inbound.ts` — "Rejected inbound" |
| R2 object keys | inbound/outbound attachment and retention paths |
| Queue names, message ids, job counts | `worker.ts` |
| Provider error text | outbound failure classification |

**No message bodies, subjects, passwords, tokens, or API keys are logged.** The two
recipient addresses are the only personal data, and they are logged deliberately: an
address that will not route is the fact needed to diagnose the problem. `apiError` logs
its `details` only when `NODE_ENV !== "production"`.

### Webhooks

User-configured URLs receive:

| Event | Payload |
|---|---|
| `message.inbound` | `messageId`, `from`, `to`, `subject` |
| `message.outbound` | `messageId`, `providerMessageId`, `to` |
| `message.failed` | `messageId`, `error` |

Subjects and addresses leave the system; **message bodies and attachments never do**.
Anyone configuring a webhook is directing that data to a third party of their choosing,
which should be stated wherever webhooks are configured.

### Mail providers

Cloudflare Email Sending, or Resend when `MAIL_PROVIDER=resend`, receives the full
outbound message including body and attachments. This is inherent to sending mail.
Inbound mail transits Cloudflare Email Routing before reaching the Worker.

### Cloudflare API

Domain, zone, routing-rule, and destination-address configuration is read and written
using `CF_TOKEN`. No message content is sent to the configuration API.

### Open gap

**R2 is not covered by any backup procedure.** `wrangler d1 export` captures the
database only. A restore from a D1 dump alone yields messages whose attachments are
missing, and the retention sweep would eventually treat the surviving R2 objects as
unreferenced. An R2 backup procedure is required before the backup gate can be
considered fully met.
