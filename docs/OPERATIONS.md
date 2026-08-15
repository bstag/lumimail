# Lumimail operational procedures

Backup, restore, rollback, and the data-egress inventory required by
[R-18](REMEDIATION_PLAN.md#phase-5--operational-hardening).

Resource identifiers are deliberately **not** recorded here. The database id, account
id, and zone ids live in `wrangler.jsonc`, which is gitignored; `wrangler.jsonc.example`
documents the shape. Commands below name resources by binding or name so they work
without secrets in this file.

## Readiness doctor

Run the local preflight before any deployment work:

```bash
npm run doctor
```

With authorized read-only Cloudflare credentials, add provider inventory and public smoke:

```bash
npm run doctor -- --remote https://mail.example.com
npm run doctor -- --remote https://mail.example.com --json
```

Remote mode reads deployment/version metadata, critical binding shapes, D1/R2/Queue identity,
pending migrations, secret names (never values), Email Routing/Sending readiness, and six public
HTTP contracts. It does not deploy, apply migrations, execute SQL, read R2 objects, send mail, or
change provider configuration. Any failed or malformed required check exits non-zero.

Wrangler 4.114 has no read-only live Cron Trigger inventory. Doctor proves the exact source Cron and
the active version's `scheduled` handler, then retains a warning until the provider schedule is
observed separately. Do not reinterpret that warning as a passing provider-side schedule check.

## Record verified operational evidence

The Operations page can show content-free results from public smoke and signed-release verification.
Recording is always explicit: normal `npm run smoke` and `npm run release:verify` never write.

Use a newly signed-in owner session so its password authentication is within the 15-minute recent-
authentication window. In browser developer tools, copy the `ep_session` cookie value. It is an
HttpOnly bearer credential: do not paste it into a command argument, file, issue, log, or shell
history. In PowerShell, prompt for it without echoing or storing the value in command history:

```powershell
$evidenceSecret = Read-Host "Paste the fresh ep_session value" -AsSecureString
$env:LUMIMAIL_SESSION_TOKEN = [System.Net.NetworkCredential]::new("", $evidenceSecret).Password
```

Record the fixed six-check public smoke result. The script derives passed/total and records a failed
result when any boundary fails; it cannot be told to claim a passing count:

```powershell
npm run smoke:record -- https://mail.example.com
```

Record a signed release only after the existing pinned trust, expected version/schema, manifest, and
artifact verification succeeds:

```powershell
npm run release:verify:record -- <bundle-directory> <signature-json> <trust-json> <expected-version> <expected-schema> https://mail.example.com
```

A stale/invalid session, non-owner session, non-HTTPS origin, verification failure, or ingestion
failure exits non-zero with bounded output. The scripts never print the token or server response.
Remove the runtime credential immediately afterward and clear any clipboard copy:

```powershell
Remove-Item Env:LUMIMAIL_SESSION_TOKEN
Set-Clipboard -Value $null
```

Recovery is not recordable by these commands. Its current workflow does not yet produce one complete
end-to-end result, so partial steps must remain `Not recorded`.

### Record a received mail-flow proof

Use a real reply that originated in Lumimail and arrived in the external mailbox. In Gmail, open the
received reply, choose **More → Show original → Download Original**, and keep the `.eml` outside the
repository. The file contains the message body and addresses, so treat it as private mail and delete
the local copy when the proof is complete.

With a fresh owner `ep_session` loaded into `LUMIMAIL_SESSION_TOKEN` as above, run:

```powershell
npm run mail-flow:record -- <received-reply.eml> https://mail.example.com
```

The local command reads at most a 64 KiB header block from a file no larger than 10 MiB. It sends
only normalized `Message-ID`, `In-Reply-To`, and `References` identifiers to Lumimail; it never sends
or prints the body, addresses, subject, filename, or local path. Lumimail then derives eight fixed
checks inside the signed-in owner's organization: inbound persistence, reply/thread linkage, stored
and immutable queue headers, sent state, provider identity, and exact received-message identity.
Only the resulting `mail_flow` count and timestamps enter the operational evidence ledger.

A pass proves that exact Cloudflare-returned RFC Message-ID was observed in a received artifact. It
does not prove universal delivery, inbox placement, or independent DKIM authenticity. Providers that
return only an opaque API identifier fail closed until Lumimail can persist a trustworthy mapping to
the final received RFC Message-ID.

Afterward, remove the session environment variable, clear the clipboard, and securely delete the
private `.eml` according to your workstation's data-handling policy.

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

- R2 objects. Attachments and retained raw MIME live in the bucket, not D1. **A D1 dump alone is not a backup of this system** — see the R2 step below, which is required, not optional.
- Secrets. `CF_TOKEN` and any provider key are Worker secrets, not database rows.
- Queue contents. In-flight messages are held by Cloudflare Queues.

## Backup — R2 objects

Run **after** the D1 export, passing it the dump:

```bash
node scripts/r2-backup.mjs backup lumimail-backup.sql ./r2-backup
node scripts/r2-backup.mjs verify ./r2-backup
```

The dump is the manifest: D1 already records every key Lumimail owns, in
`attachments.r2_key` and `message_bodies.raw_r2_key`. Two consequences follow.

Only *referenced* objects are captured. An unreferenced object is precisely what the
F63 retention sweep exists to delete, so it does not need backing up.

Every key in the manifest provably existed when the dump was taken, so the R2 backup is
consistent with the database it accompanies rather than with whatever the bucket held
later. This is why the order matters: **export D1 first, then derive R2 from it.**

A referenced key with no object is reported and exits non-zero. That is a real finding —
the database pointing at something that is gone — not a warning to ignore.

`verify` re-reads every file and compares size and SHA-256 against the manifest without
contacting R2, so an archived backup can be checked at any time.

Exercised 2026-07-25: 15 referenced, 15 captured, 0 missing; verification checked 15
objects with no problems. The bucket held exactly 15 objects, so every object was
referenced.

**Scale limit:** one `wrangler r2 object get` per object, so this is linear in object
count and suited to the current scale. At volume, use Cloudflare's bucket replication
instead of this script.

## Restore — production

**Use D1 Time Travel, not the dump.** D1 keeps a point-in-time history, so recovering
production does not require a dump at all:

```bash
wrangler d1 time-travel info DB                  # current bookmark
wrangler d1 time-travel restore DB --bookmark=<bookmark>
```

This is the supported path for "production is wrong, put it back". The dump exists for
portability — moving to a new database, or inspecting data offline — not as the primary
recovery mechanism.

## Restore — from a dump

`wrangler d1 execute --file` **cannot load a `d1 export` dump.** Two reasons, both
found by attempting it:

1. The dump declares foreign keys before the tables they reference — `api_keys` cites
   `users` about 180 lines before `users` is created. Foreign-key enforcement must be
   off during the load or resolution fails on the forward reference. The dump's own
   `PRAGMA defer_foreign_keys` is not sufficient: a missing table is a resolution error,
   not a constraint violation.
2. That pragma is scoped to a transaction, and Wrangler executes a file as separate
   statements, so it does not survive regardless.

A restore must therefore execute the dump as a single script with foreign keys disabled,
then re-enable them and check integrity. `scripts/restore-local.mjs` does exactly that:

```bash
wrangler d1 export DB --remote --output dump.sql
node scripts/r2-backup.mjs backup dump.sql ./r2-backup

node scripts/restore-local.mjs dump.sql      # D1 into the local Wrangler database
node scripts/r2-backup.mjs restore ./r2-backup   # objects into the local bucket
npm run dev
```

The restore starts from an empty database — a dump carries its own `d1_migrations`
rows, which collide with whatever the target already recorded — and finishes with
`PRAGMA foreign_key_check`, so integrity is verified rather than assumed.

Restore R2 **before** pointing traffic at a restored database, or the retention sweep
may observe objects it considers unreferenced. The object restore refuses to write a
file whose SHA-256 does not match the manifest.

Restoring **over** production is destructive and is not routine. Create a new database,
restore into it, verify, then repoint the binding.

Verified 2026-07-25 by restoring a production dump and its objects into local:

| Check | Result |
|---|---|
| Tables / indexes | 29 / 40 |
| Rows | 3 users, 2 domains, 4 mailboxes, 35 messages, 4 attachments |
| R2 objects restored | 15 of 15 |
| Orphaned messages | 0 |
| **Foreign key violations** | **0** |

The integrity checks matter more than the row counts: they show relationships survived
the round trip rather than merely that rows arrived.

**The restored copy contains production password hashes**, so it accepts production
passwords. Treat a local replica as production data: it is a copy of real mail, not
test fixtures.

## Rollback

### Worker code

```bash
wrangler versions list          # find the target version id
wrangler rollback <version-id>
```

Version history is retained, so any recent deployment can be restored.

For the production-shaped remote rehearsal, use the guarded command rather than an inferred
rollback target:

```bash
node scripts/recovery-rollback.mjs <current-version-uuid> <previous-version-uuid>
```

It requires the exact isolated recovery config, switches the previous version to 100%, runs all six
public smoke checks, and restores the intended version in a mandatory return path. Exercised
2026-08-12: previous and intended versions each passed 6/6, followed by an independent provider
read showing the intended version alone at 100% and another independent 6/6 smoke run.

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

## Remote recovery rehearsal

The complete production-shaped path is implemented by the `recovery-*` scripts. Keep its output
directory private and outside the repository:

```bash
node scripts/recovery-capture.mjs <new-private-output-directory>
node scripts/recovery-restore.mjs <private-output-directory>
node scripts/recovery-app-verify.mjs <private-output-directory>
node scripts/recovery-rollback.mjs <current-version-uuid> <previous-version-uuid>
node scripts/recovery-cleanup.mjs <private-output-directory> <current-version-uuid>
```

Capture is read-only and publishes only after its canonical `lumimail-recovery-v1` directory passes
offline verification. Restore requires exact empty/schema-only remote targets and refuses routed or
production-overlapping resources. Application verification uses a random, fixed-ID, recovery-only
viewer and removes it afterward. Cleanup re-verifies the private archive and every remote identity
before deleting the Worker, exact manifest keys, empty bucket, and D1; it compares production
resource/routing fingerprints before and after.

Exercised 2026-08-12: a production capture restored into a spare remote D1 and R2 with all 29
application-table counts equal, 29 matching migrations, zero foreign-key violations, and 15/15
exact-byte object hashes. Public smoke passed 6/6. Authenticated allowed message/body/attachment
reads passed, unrelated-mailbox list/direct reads were denied, and browser inspection covered rich
HTML plus attachment controls. Worker rollback and return each passed 6/6.

On 2026-08-12 cleanup was partially complete: the recovery-only Worker had been deleted while the
restored D1 and 15-object R2 bucket remained. A metadata-only search on 2026-08-13 found no surviving
archive on the mounted drives, while read-only Cloudflare inventory reconfirmed the exact recovery
D1, 15-object R2 bucket, and absent Worker.

After choosing an encrypted destination outside the repository, recapture those exact isolated
resources without recreating the Worker or reading current production:

```powershell
npm run recovery:recapture -- <new-encrypted-output-directory>
```

The command refuses an existing destination, dirty worktree, configuration drift, any Worker result
other than Cloudflare absence code `10007`, routing to the recovery Worker, any D1/R2 identity or
15-object count mismatch, or incomplete byte capture. It publishes only after canonical offline
verification and otherwise removes only its randomly named partial directory. It never writes to
Cloudflare. The guarded cleanup re-verifies the canonical manifest, D1 export, and all object bytes
again before its first deletion.

Exercised 2026-08-13 against the isolated recovery resources. The chosen parent was empty but not
encrypted or access-restricted, so EFS and owner/SYSTEM/Administrators-only access were applied and
proven with an encrypted write/read/delete probe before export. Recapture then verified one D1 export
and all 15 objects. An independent offline pass found zero problems across 17 files totaling
8,519,426 bytes, and every file was EFS-encrypted. No remote mutation occurred.

Set or change the archive's bounded retention days independently of Cloudflare cleanup:

```powershell
npm run recovery:retention -- <archive-directory> 30
```

After cleanup succeeds, record its immutable basis once (later day changes preserve this timestamp):

```powershell
node scripts/recovery-retention.mjs <archive-directory> 30 --cleanup-completed-now
```

If a future rehearsal reaches the same partial state, supply the newly verified directory to the
guarded cleanup command; do not manually delete remaining remote copies. The cleanup command
recognizes only Wrangler's exact Worker
absence code (`10007`) as the already-completed exposure-removal step; it will not redeploy the
Worker, rerun smoke against a replacement, or treat arbitrary `not found` text as proof.

Completed 2026-08-13. The first cleanup attempt stopped safely because R2's aggregate reported zero
objects even though exact reads showed all 15 present and matching. The guard now accepts aggregate
disagreement only after streaming every exact manifest key in memory and matching size/SHA-256.
Guarded retry deleted those 15 objects, the empty bucket, and exact staging D1. Independent inventory
proves Worker/R2/D1 absence, the production fingerprint was unchanged, and production smoke passed
6/6. The encrypted archive remains verified and its configurable policy records cleanup at
`2026-08-13T21:48:19.075Z`, 30 days retention, and destruction after
`2026-09-12T21:48:19.075Z`.

## Production performance evidence

Measure only the fixed authenticated read paths with an owner session token held in the environment:

```powershell
$secret = Read-Host "Paste a fresh owner ep_session value" -AsSecureString
$env:LUMIMAIL_SESSION_TOKEN = [System.Net.NetworkCredential]::new("", $secret).Password
npm run performance:measure -- https://mail.henriksen.dev
Remove-Item Env:LUMIMAIL_SESSION_TOKEN
```

The command performs one warmup plus 15 serial reads of each allowlisted endpoint. It accepts no
arbitrary path, concurrency, sample-count, or target flags and prints no response data or token.

Run the fixed managed-D1 evidence separately:

```powershell
npm run performance:d1
```

This uses individual Wrangler `--command` queries rather than `--file`; the latter is an import path
that can affect availability even when a file contains only reads. Runtime and tests reject mutation
keywords and private projections, and a valid report must record zero rows written. Queue throughput
is not inferred from historical rows and requires the separately approved F84 controlled mail batch.

Exercised 2026-08-13. Managed D1 ran eight statements in 2.485 ms total provider-reported SQL time,
read 106 rows, wrote zero, and used the intended production indexes in WNAM. An authenticated Chrome
run then sampled the same six fixed GET paths serially 15 times after warmup; every target passed,
with p95 from 358 ms through 718 ms. The browser transport is recorded explicitly and includes
navigation/control overhead. The Queue batch remains separate because it sends real mail.
