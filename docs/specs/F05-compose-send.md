# F05 — Compose, Send & Drafts

> Status: Shipped
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

**Out of scope:** Attachments, reply/forward (UI exists but no compose integration), email templates, scheduled send.

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
| POST | `/api/send` | `guardUser` | `{ from, to, subject, html?, text?, mailboxId? }` | `{ messageId, providerMessageId }` | 400, 429 (rate limit), 500 |
| POST | `/api/v1/send` | API key (`send` scope) | same | same | 401, 403 (scope), 400, 429 |

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
- `sendEmail()` validates sender domain is active, creates outbound job, sends via the configured outbound provider (`selectOutboundProvider(env)` — Cloudflare by default, Resend when `MAIL_PROVIDER=resend`). See [F33](F33-outbound-mail-providers.md).
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
