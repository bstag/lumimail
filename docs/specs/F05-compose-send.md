# F05 — Compose, Send & Drafts

> Status: Shipped locally — expanded formatting and CID images await production delivery verification
> Owner area: `src/components/compose/`, `src/app/api/send/`, `src/app/api/drafts/`, `src/app/api/v1/send/`

## 1. Problem & User Job

Users need to compose, auto-save as drafts, and send emails. Drafts persist across
browser sessions. Send is available via both the UI and a public API (API keys).

## 2. User Stories & Acceptance Criteria

- As a user, I can compose a formatted email in either the full-page or floating
  composer using paragraphs, headings, bold, italic, underline, strikethrough,
  lists, blockquotes, and safe links.
- As a recipient, I receive equivalent safe HTML and meaningful plain-text MIME
  alternatives regardless of which representation my email client prefers.
- As a user, drafts auto-save every 900ms when content changes.
- As a user, I can load a saved draft and continue editing.
- As a user, I can send an email from a selected mailbox.
- As a user, I can include outbound attachments in the send request.
- As a user replying to an HTML message, the delivered reply preserves a safe
  HTML quotation without exposing the source HTML in the authoring surface.
- As an API consumer, I can send email via `/api/v1/send` with an API key.

## 3. Scope Boundaries

**In scope:** Tiptap WYSIWYG compose form (popup + full page), undo/redo,
paragraph and clear-format controls, link editing with `Mod-K`, horizontal rule,
inline/code blocks, superscript/subscript, typography substitutions, alignment,
foreground/background color, tables, uploaded CID inline images,
server-sanitized semantic HTML and safe presentation attributes, derived plain
text, auto-save drafts, load/delete drafts, durable send via UI, send via API
key, outbound attachments, server-derived HTML-preserving reply quotations,
responsive editor controls, reactive formatting state, localized toolbar
labels, explicit color/highlight clearing, and inline-image alternative text.

**In scope through later contracts:** outbound attachments are defined by
[F55](F55-outbound-attachment-delivery.md); reply/forward composition is tracked
separately in the feature registry.

**Out of scope:** Arbitrary HTML/source editing, arbitrary CSS, remote-image
URLs, base64 image persistence, font-family/size selection, embedded audio or
video, email templates, scheduled send, selected-file persistence in draft
autosave, and automatic forwarding of original attachments.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `id`, `userId`, `mailboxId`, `direction: "outbound"`, `fromAddr`, `toAddr`, `subject`, `snippet`, `status`, `providerMessageId` | |
| `messageBodies` | `textBody`, `htmlBody` | Server-normalized plain text and sanitized semantic HTML |
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

- `/compose` — full-page constrained WYSIWYG compose form
- Floating composer — popup overlay at bottom-right
- Compose form: from (read-only), to, subject, formatting toolbar, editable body,
  attachments, send button
- On narrow compose surfaces, primary controls remain visible while secondary
  controls are available from a compact overflow menu.
- Toolbar pressed/disabled states follow the current cursor or selection.
- Selected inline images expose alternative-text and removal controls.
- Header bar: shows "Draft saved" / "New Message" / "Loading draft"
- Auto-save indicator: "Autosaves as draft" / "Saved to drafts"
- Send success toast, draft deleted on send

## 7. Current Behavior

- `sendEmailSchema` accepts `html` and `text` fields
- The UI emits both Tiptap HTML and a plain-text alternative.
- Draft and send APIs sanitize authored HTML on the server before persistence or
  queue snapshot creation; client sanitization is never the security boundary.
- The server derives the authoritative plain-text alternative from sanitized
  HTML when HTML is present.
- `sendEmail()` authorizes the selected sender, persists a durable job snapshot,
  stores attachment bytes in R2 when present, and enqueues the job. The queue
  consumer selects Cloudflare or Resend and records the final state. See
  [F33](F33-outbound-mail-providers.md), [F54](F54-durable-outbound-delivery.md),
  and [F55](F55-outbound-attachment-delivery.md).
- Auto-save uses `useEffect` with 900ms debounce
- Drafts POST/PATCH both accept `html` field
- On send success, associated draft is deleted
- API key send uses `authenticateApiKey()` + `requireScope("send")`

## 8. Decisions

- Constrained WYSIWYG authoring is part of the MVP. The existing Tiptap editor is
  activated rather than introducing a second editor framework.
- Sanitized HTML is the canonical formatted delivery representation. A
  server-derived plain-text alternative is always stored and delivered with it.
- Stored authored HTML remains semantic with only normalized allowlisted
  presentation properties. Immediately before the provider call, the server
  adds fixed trusted presentation where clients commonly reset browser defaults.
- Safe HTML received from another message may be preserved in a server-derived
  reply quotation under F59. Raw source HTML remains server-owned and is never
  round-tripped through the browser as hidden trusted content.
- Style-based features are limited to an allowlist of properties and normalized
  values; arbitrary declarations, URLs, positioning, visibility, and
  layout-breaking CSS are removed.
- Inline images use sender-uploaded image files, `cid:` references, and
  server-generated content IDs. Remote URLs and data URLs are not accepted.
  Inline files share the existing attachment count/size/authorization/storage
  lifecycle and are not draft-autosaved until the attachment draft contract is
  expanded.
- Tables are structural email content. Cell spans remain bounded by the
  sanitizer; table presentation is server-owned at delivery and in the reader.
- API clients may submit text-only messages. When they submit HTML, the server
  sanitizes it and derives the authoritative text alternative.

## 9. Error States and Edge Cases

- A sender without the selected mailbox's send capability cannot create or send
  its drafts.
- A send is accepted only after its durable message/job and all selected
  attachment objects are stored atomically as defined by F54/F55.
- Newly selected files are not draft-autosaved; the UI must not claim otherwise.
- Removing a selected inline image also removes its pending CID upload.
- Empty alternative text is allowed for decorative inline images; authored
  alternative text is sanitized with the surrounding HTML.
- Invalid or unauthorized reply source identifiers fail closed under F59.
- Empty editor wrapper markup such as `<p></p>` does not satisfy the required-body
  contract.
- Pasted active content, remote images, forms, arbitrary styles, and unsupported
  markup are removed before draft persistence or outbound queueing. Allowlisted
  formatting styles are normalized rather than copied verbatim.
- A CID reference without a matching authorized inline upload is removed before
  delivery. An inline upload not referenced by sanitized HTML is never silently
  exposed through a public URL.
- Provider failure is represented by queued/failed delivery state rather than a
  false synchronous success.

## 10. Test Plan

- Add Workers-safe HTML-to-text and authored-content normalization tests,
  including hostile markup, links, lists, blockquotes, empty wrapper markup, and
  text-only API compatibility.
- Add draft create/update round-trip tests proving only sanitized HTML and its
  derived text are persisted.
- Add send tests proving the immutable outbound snapshot contains sanitized HTML
  and derived text.
- Add delivery-presentation tests proving semantic H1/H2 markup receives only
  fixed server-owned styles and hostile/user-authored styles cannot survive.
- Add toolbar contracts for history state, paragraph/clear formatting, link
  editing, semantic nodes, safe styles, tables, and image insertion.
- Add browser contracts for compact-toolbar access, reactive active state, and
  inline-image alternative-text editing.
- Require every supported locale to contain the complete toolbar message set.
- Add sanitizer tests for every allowed style value and adversarial CSS/URL
  input.
- Add CID attachment tests across multipart parsing, R2 snapshots, Cloudflare
  and Resend provider translation, reply handling, and plain-text fallback.
- Retain browser contracts for attachment submission, shared draft behavior,
  reply-source submission, visible delivery state, formatting, and draft reload.
- Documentation-status coverage must keep the registry, this specification, and
  README aligned on constrained WYSIWYG authoring.

## 11. Bug / Change Log

### 2026-07-29 — Editor usability quick wins

Type: Feature / UX.

Status: Implemented locally.

Implemented:
- Kept common formatting actions visible and moved secondary actions into a
  compact narrow-screen overflow menu while retaining horizontal overflow as a
  fallback for very small surfaces.
- Subscribed the toolbar to editor selection and transaction events so active
  and enabled states update as the cursor moves.
- Added explicit clear-text-color and clear-highlight actions.
- Added selected-image alternative-text editing and removal; removing an image
  also removes its pending CID upload.
- Routed all toolbar text and accessibility labels through complete translations
  for every supported locale.

Verification:
- `npm run verify` passes with 1,532 application tests at 100% configured
  coverage plus 16 bridge tests.
- Focused attachment/alt-text, reactive-formatting, and compact-toolbar browser
  scenarios pass. F73 subsequently repaired the Playwright server lifecycle;
  the complete 49-scenario mocked Chromium suite now passes and exits cleanly.

### 2026-07-28 — Expand the MVP editor and multipart contract

Type: Feature / Scope Expansion.

Status: Implemented locally.

Requested:
- Expose the remaining email-appropriate StarterKit controls and add advanced
  formatting, tables, and inline images now rather than deferring them.

Decisions:
- Advanced presentation is stored only through normalized, allowlisted CSS
  values.
- Inline images are uploaded files delivered as CID attachments; arbitrary
  remote and data URLs remain prohibited.
- Every editor control must round-trip through server sanitization, derived text,
  durable snapshots, provider translation, and the sanitized reader before it
  is considered shipped.

Implemented:
- Added visible history, paragraph/clear-format, link editing with `Mod-K`,
  semantic formatting, alignment, safe colors/highlights, table editing, and
  uploaded inline-image controls.
- Added normalized style sanitization and CID-only image policy; remote/data
  image sources and arbitrary CSS remain prohibited.
- Added attachment disposition/content-ID persistence, Cloudflare/Resend
  provider translation, inbound CID metadata, and authenticated reader
  resolution.
- `npm run verify` passes with 1,531 application tests at 100% configured
  coverage plus 16 bridge tests.
- Focused advanced-formatting and combined attachment/CID browser scenarios
  pass; the Playwright process still does not exit because the configured
  Wrangler remote proxy lacks `CLOUDFLARE_API_TOKEN`.

### 2026-07-28 — Preserve visible heading hierarchy through delivery and reading

Type: Bug.

Observed:
- H1 markup survives authoring, sanitization, persistence, and queueing, but the
  outbound part has no presentation rule for clients that reset heading
  defaults.
- Lumimail's reader uses a `prose` class without a typography plugin, so received
  H1/H2 elements can also appear as ordinary body text.

Desired:
- Keep semantic H1/H2 markup as the stored source of truth.
- Add only fixed server-owned inline heading presentation at the provider
  boundary.
- Style sanitized H1/H2 elements explicitly in Lumimail's message reader.

Test plan:
- Prove outbound delivery decoration preserves semantic tags, applies the fixed
  presentation, and re-sanitizes hostile snapshot markup.
- Prove both thread and single-message HTML containers use the reader styling
  class.

### 2026-07-28 — Make constrained WYSIWYG authoring an MVP requirement

Type: Feature / Scope Decision.

Implemented:
- Activated the existing Tiptap editor in both composition surfaces.
- Drafts, sends, and replies store server-sanitized semantic HTML and a
  server-derived plain-text alternative.
- Preserved the F59 server-owned quotation boundary.
- Excluded style-based formatting, arbitrary HTML, tables, and inline images
  from the initial MVP.
- `npm run verify` passes with 1,500 application tests, 100% coverage, and 16
  bridge tests.
- The targeted attachment, formatted-reply, formatted-draft restore/autosave,
  and popup-composer browser scenarios pass. The Playwright process does not
  exit cleanly because the existing Wrangler remote proxy requires
  `CLOUDFLARE_API_TOKEN`; that infrastructure issue is tracked separately.

Remaining production evidence:
- Deploy and confirm that representative email clients receive and render both
  the formatted HTML body and its meaningful plain-text alternative.

### 2026-07-28 — Reconcile the prior plain-text authoring contract

Type: Documentation / Scope Correction.

Summary:
- Define the active plain-text composer as the shipped MVP authoring surface.
- Preserve HTML through the separate server-derived reply contract without
  claiming WYSIWYG authoring.
- Move rich-text/WYSIWYG composition to post-MVP scope.

### 2026-06-10 — Added Tiptap WYSIWYG editor

Type: Feature

Summary:
- Replaced plain `<Textarea>` with Tiptap editor featuring bold, italic, underline, strikethrough, headings (H1/H2), bullet/ordered lists, blockquote, links, and text alignment
- Added `ComposeEditor` and `ComposeEditorToolbar` components
- Updated draft save/send payloads to include HTML
- Added i18n strings under `compose.toolbar.*`
- Added Tiptap CSS to globals.css

Historical note: this entry records the original implementation claim. The
editor was not the active shipped authoring surface at the time. The later
2026-07-28 MVP decision above supersedes that temporary plain-text boundary.

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.
