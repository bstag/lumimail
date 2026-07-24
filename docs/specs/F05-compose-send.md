# F05 — Compose, Send & Drafts

> Status: In Progress (core flow shipped; registry reconciliation required)
> Owner area: `src/components/compose/`, `src/app/api/send/`, `src/app/api/drafts/`, `src/app/api/v1/send/`

## 1. Problem & User Job

Users need to compose, auto-save as drafts, and send emails. Drafts persist across
browser sessions. Send is available via both the UI and a public API (API keys).

## 2. User Stories & Acceptance Criteria

- As a user, I can compose an email with rich formatting (Tiptap WYSIWYG).
  - Toolbar: bold, italic, underline, strikethrough, headings, lists, blockquote, links, text alignment.
- As a user, drafts auto-save every 900ms when content changes.
- As a user, I can load a saved draft and continue editing.
- As a user, I can send an email from a selected mailbox.
- As an API consumer, I can send email via `/api/v1/send` with an API key.

## 3. Scope Boundaries

**In scope:** Compose form (popup + full page), Tiptap WYSIWYG editor, auto-save drafts, load/delete drafts, send via UI, send via API key.

**In scope through later contracts:** outbound attachments are defined by
[F55](F55-outbound-attachment-delivery.md); reply/forward composition is tracked
separately in the feature registry.

**Out of scope:** email templates, scheduled send, selected-file persistence in
draft autosave, and automatic forwarding of original attachments.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `id`, `userId`, `mailboxId`, `direction: "outbound"`, `fromAddr`, `toAddr`, `subject`, `snippet`, `status`, `providerMessageId` | |
| `messageBodies` | `textBody`, `htmlBody` | htmlBody from Tiptap editor |
| `outboundJobs` | `id`, `userId`, `messageId`, `status`, `payload` | |

## 5. API Contract

### Send

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/send` | `guardUser` | JSON without files, or multipart `payload` + `attachment` fields | `{ messageId, status: "queued" }` | 400, 404, 415, 429, 500 |
| POST | `/api/v1/send` | API key (`send` scope) | JSON with optional Base64 `attachments` | same | 401, 400, 404, 500 |

### Drafts

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/drafts` | `guardUser` | query: `mailboxId?` | `{ drafts[] }` | 401 |
| POST | `/api/drafts` | `guardUser` | `{ from, to, subject, html?, text?, mailboxId? }` | `{ draft: { id } }` | 401 |
| GET | `/api/drafts/[id]` | `guardUser` | — | `{ draft }` | 401, 404 |
| PATCH | `/api/drafts/[id]` | `guardUser` | same as POST | `{ draft: { id } }` | 401, 404 |
| DELETE | `/api/drafts/[id]` | `guardUser` | — | `{ ok }` | 401, 404 |

## 6. UI/UX

- `/compose` — full-page compose form with Tiptap toolbar
- Floating composer — popup overlay at bottom-right
- Compose form: from (read-only), to, subject, rich body, send button
- Header bar: shows "Draft saved" / "New Message" / "Loading draft"
- Auto-save indicator: "Autosaves as draft" / "Saved to drafts"
- Send success toast, draft deleted on send

## 7. Current Behavior

- `sendEmailSchema` accepts `html` and `text` fields
- `sendEmail()` authorizes the selected sender, persists a durable job snapshot,
  stores attachment bytes in R2 when present, and enqueues the job. The queue
  consumer selects Cloudflare or Resend and records the final state. See
  [F33](F33-outbound-mail-providers.md), [F54](F54-durable-outbound-delivery.md),
  and [F55](F55-outbound-attachment-delivery.md).
- Auto-save uses `useEffect` with 900ms debounce
- Drafts POST/PATCH both accept `html` field
- On send success, associated draft is deleted
- API key send uses `authenticateApiKey()` + `requireScope("send")`

## 8. Bug / Change Log

### 2026-06-10 — Added Tiptap WYSIWYG editor

Type: Feature

Summary:
- Replaced plain `<Textarea>` with Tiptap editor featuring bold, italic, underline, strikethrough, headings (H1/H2), bullet/ordered lists, blockquote, links, and text alignment
- Added `ComposeEditor` and `ComposeEditorToolbar` components
- Updated draft save/send payloads to include HTML
- Added i18n strings under `compose.toolbar.*`
- Added Tiptap CSS to globals.css

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.
