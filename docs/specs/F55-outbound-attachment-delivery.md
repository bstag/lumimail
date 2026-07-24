# F55 — Outbound Attachment Delivery

> Status: `Implemented — production validation pending`
> Owner area: compose, `/api/send`, `/api/v1/send`, R2 attachment storage,
> outbound queue snapshots, Cloudflare/Resend providers

## 1. Problem and user job

Lumimail currently queues the message before the compose client uploads selected
files to `/api/attachments`. The provider therefore never receives those files.
The UI can report that a message was queued and then store attachment metadata on
the message afterward, which misleadingly suggests the recipient received the
attachment.

**User job:** when I attach a supported file and send an email, Lumimail should
accept the message and files as one operation, deliver the exact files to the
recipient, and fail truthfully when it cannot preserve or deliver them.

## 2. Current behavior

- Compose sends JSON to `/api/send`, receives a message ID, then uploads each file
  separately to `/api/attachments`.
- The durable job snapshot contains only sender, recipient, subject, HTML, and text.
- The queue consumer calls the provider without loading attachment metadata or
  bytes.
- Cloudflare and Resend provider adapters have no attachment contract.
- The attachment route permits a send-capable user to append a file to an existing
  queued, sent, failed, or draft message.
- Each selected file may be 25 MiB; there is no count, aggregate-size, filename, or
  file-type policy.
- Selected files are local browser state and are not persisted by draft autosave.

## 3. Desired behavior

### Browser send

1. Compose submits one `multipart/form-data` request containing a JSON `payload`
   field and zero or more `attachment` file fields.
2. JSON-only requests remain supported for clients sending no attachments.
3. The server authenticates, rate limits, validates the message, validates every
   attachment, and authorizes the sender before writing attachment bytes.
4. Validation or authorization failure returns a bounded 4xx response and writes
   neither R2 objects nor D1 message/attachment/job rows.
5. A successful response remains HTTP 202 with the existing queued result.
6. Compose clears the selected files and deletes its draft only after the complete
   message and attachment set is durably accepted.

### API-key send

`POST /api/v1/send` keeps its JSON contract and accepts an optional
`attachments` array:

```json
{
  "attachments": [
    {
      "filename": "report.pdf",
      "contentType": "application/pdf",
      "contentBase64": "JVBERi0..."
    }
  ]
}
```

Malformed Base64, unsupported files, and messages exceeding the same browser
limits return HTTP 400. Attachment bytes are never copied into the queue body or
stored in D1.

### Durable producer

1. Normalize and validate the complete message before persistence.
2. Generate the message, job, and attachment IDs.
3. Store each attachment in R2 under an opaque, server-generated key.
4. Persist the message, body, job, and attachment metadata in one D1 batch.
5. Store only immutable attachment metadata (`id`, `filename`, `contentType`,
   `size`, `r2Key`) in the outbound job snapshot.
6. Enqueue only the job ID, as defined by F54.
7. If an R2 write or the D1 batch fails, delete every R2 object written by this
   attempt. The queue is not called.
8. If queue publication fails after D1 persistence, retain the message and files,
   mark the message/job failed, and expose the existing truthful failure state.

### Queue consumer

1. Parse and validate the stored attachment metadata as part of the immutable job
   snapshot.
2. Load every referenced R2 object before calling the provider.
3. Require every object to exist and have the exact stored size. A missing or
   mismatched object is a permanent storage failure: mark the job/message failed,
   call no provider, and acknowledge the queue message.
4. Pass the exact bytes, normalized filename, and content type to the configured
   provider.
5. Provider retry, duplicate prevention, final-state ordering, and dead-letter
   behavior remain those defined by F54.

### Provider adapters

- The normalized `OutboundMessage` supports attachment objects with filename,
  content type, and `ArrayBuffer` content.
- Cloudflare receives structured attachment entries using binary `ArrayBuffer`
  content and `attachment` disposition.
- Resend receives Base64 content generated from the stored bytes.
- An empty attachment list is omitted from provider requests to preserve the
  existing no-attachment contract.

## 4. Limits and validation

These limits provide predictable behavior across Lumimail's Cloudflare and Resend
providers and leave room below Cloudflare Email Service's 5 MiB total-message limit
for general recipients.

| Limit | Value |
|---|---:|
| Attachment count | 10 |
| One raw attachment | 3 MiB |
| Encoded message estimate | 4.5 MiB |
| Filename | 255 UTF-16 code units after normalization |

The encoded estimate includes UTF-8 subject/body bytes, Base64 expansion
(`4 * ceil(rawBytes / 3)`), and a fixed per-file MIME overhead. The server is
authoritative; matching client checks exist only for earlier feedback.

Supported content types:

- `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- `application/pdf`, `text/plain`, `text/csv`
- modern and legacy Microsoft Word and Excel document types
- `application/zip`

Executable and script extensions including `.exe`, `.bat`, `.cmd`, `.com`, `.scr`,
`.vbs`, `.js`, `.jar`, `.ps1`, and `.msi` are rejected regardless of claimed MIME
type. Empty files are accepted. Filenames have control characters and path
components removed, fall back to `attachment`, and are bounded to 255 characters.

## 5. API and error contract

- Unsupported media, dangerous filenames, too many files, malformed Base64, and
  size-limit failures return HTTP 400 with a safe attachment-specific message.
- Browser multipart without a string `payload`, with malformed JSON, or with a
  non-File attachment is invalid.
- Unsupported request content types return HTTP 415.
- Sender authorization remains a non-enumerating HTTP 404.
- Storage, persistence, enqueue, and provider failures remain HTTP 500 or durable
  failed state according to where acceptance occurred.
- Error responses and logs never contain attachment bytes, Base64 content, message
  bodies, R2 internals, provider response bodies, or credentials.

## 6. Permissions and tenant isolation

- Browser users and API keys must pass the existing sender/mailbox `send`
  capability checks before any attachment write.
- Attachment rows are owned through the already-authorized message and mailbox.
- The job snapshot uses server-generated R2 keys; clients cannot choose or retrieve
  arbitrary keys.
- The legacy `/api/attachments` endpoint may attach files only to a draft the user
  can send. It cannot mutate queued, sent, or failed messages.
- Losing mailbox access after durable acceptance does not cancel the queued send,
  matching F54.

## 7. Drafts, replies, and forwards

- Selected compose files remain ephemeral in this MVP. Draft autosave stores
  message fields but not newly selected files; reload or close discards them.
- A reply may include newly selected attachments.
- Forwarding quotes the original body but does not silently reattach the original
  message's files. A user may explicitly download and reattach them.
- Persisting selected files into shared drafts and explicit “include original
  attachments” forwarding are follow-up features, not hidden behavior.

## 8. Edge cases

- Duplicate filenames receive separate attachment IDs and opaque R2 keys.
- Partial R2 upload failure removes earlier objects from the same attempt.
- D1 failure after all R2 writes removes all newly written objects.
- Cleanup failure is logged with metadata only and does not cause enqueueing.
- Missing/mismatched R2 content is permanent because retry cannot reconstruct the
  accepted file.
- Provider transient failure retains the same immutable R2 objects for retry.
- Queue publication failure retains files with the visible failed message for
  audit/recovery.
- Deleted message/job behavior remains F54; general R2 lifecycle cleanup remains
  R-11.
- Cloudflare's local simulator may not support binary email attachments; provider
  adapter behavior is unit-tested and release validation uses the deployed Worker.

## 9. Test plan

### Unit

- Attachment normalization rejects count, type, extension, malformed Base64, and
  encoded-message limits and sanitizes filenames.
- Browser send accepts JSON without attachments and multipart with files.
- API-key send accepts valid Base64 attachments and rejects malformed input.
- Authorization/validation failure performs no R2 or D1 write.
- Producer writes exact bytes to opaque R2 keys, persists attachment rows and
  metadata-only snapshot, and cleans up R2 after partial upload or D1 failure.
- Queue publication failure preserves accepted attachment storage with failed
  message/job state.
- Consumer loads exact R2 bytes and passes them to the provider.
- Missing or mismatched R2 content fails permanently without provider delivery.
- Cloudflare receives binary attachments; Resend receives correct Base64.
- Existing no-attachment provider payloads remain unchanged.
- Legacy attachment upload rejects non-drafts and shares the validation rules.

### Browser

- Compose sends selected files in the same request as the message payload.
- It does not call `/api/attachments` after the queued response.
- A validation failure preserves the form and selected file.
- A successful queued response clears the form and selected files.

### Release

- `npm run verify`
- complete Chromium E2E suite
- OpenNext production build and Wrangler dry run
- production deployment
- controlled send to an external recipient, verifying filename, content type,
  exact bytes, and durable `sent` state
- controlled rejected attachment, verifying no message/job/attachment residue

## 10. Decisions

- Use R2 as the durable binary source; never put bytes or Base64 in D1 or queue
  messages.
- Keep the existing provider abstraction and F54 at-most-once claim boundary.
- Use one browser multipart request instead of a pre-upload session API; current
  size limits keep buffering below the Worker memory limit.
- Support API-key attachments now so browser and automation sends share one
  delivery truth.
- Preserve files after durable acceptance even if enqueue/provider delivery fails;
  lifecycle cleanup is handled separately under R-11.

## 11. Open questions

None blocking implementation. Shared-draft file persistence, larger provider-
specific limits, inline dispositions/content IDs, and original-attachment
forwarding require separate contracts.

## 12. Bug / change log

### 2026-07-24 — Outbound attachment delivery specification

Type: `Correctness / missing delivery behavior`

Drafted atomic browser/API acceptance, provider-portable limits, R2/D1 compensation,
immutable queue metadata, provider encoding, storage-failure behavior, permissions,
and draft/reply/forward boundaries before implementation.

### 2026-07-24 — Atomic attachment acceptance and provider delivery

Type: `Correctness / delivery`

Summary:

- Replaced compose's send-then-upload sequence with one multipart send request;
  JSON-only browser clients remain compatible and API-key sends accept optional
  Base64 attachment objects.
- Added a shared, provider-portable attachment contract with count, per-file,
  encoded-message, type, dangerous-extension, and normalized-filename checks.
- Stored exact bytes under opaque R2 keys before the D1 message/job/metadata batch,
  with cleanup after partial R2 or D1 failure.
- Extended immutable outbound job snapshots with metadata only. The queue consumer
  enforces canonical tenant/message R2 keys, exact object sizes, transient storage
  retries, and permanent missing/corrupt-object failure before any provider call.
- Added binary Cloudflare attachments and Base64 Resend attachments while
  preserving unchanged provider payloads for messages without files.
- Restricted the legacy attachment endpoint to drafts so it cannot append
  misleading metadata to queued, sent, or failed messages.

Verification:

- `npm run verify`: 141 application test files, 1,194 tests, 100% statement,
  branch, function, and line coverage; all 16 bridge tests passed. Lint reported
  the existing warning set and zero errors.
- All 36 Chromium scenarios passed, including atomic compose submission with no
  post-send `/api/attachments` call. Playwright remained open until timeout because
  the known local Wrangler remote-proxy helper did not shut down.
- The OpenNext production build passed and wrote `.open-next/worker.js`.
- Wrangler 4.113.0 dry run passed with the production Email, inbound/outbound
  Queue, D1, R2, Images, Assets, and service bindings.

Not yet verified:

- No production deployment or controlled external-recipient attachment delivery
  has been performed for F55. Exact received filename, content type, and bytes
  remain the release acceptance step.
