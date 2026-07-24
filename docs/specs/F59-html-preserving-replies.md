# F59 — HTML-Preserving Replies

> Status: `Ready for Production Validation`
> Owner area: compose reply state, authorized reply-source loading, outbound
> message bodies, Queue snapshots, Cloudflare/Resend multipart delivery

## 1. Problem & User Job

F58 correctly groups conversations and sends RFC reply headers, but the compose
page copies only the source message's plain-text alternative into the editable
reply body. Rich formatting from the sanitized HTML alternative becomes literal
plain-text markers. When an external client replies again, it quotes that
flattened copy and makes the conversation appear progressively damaged.

Production reproduction `msg_j21D609jt9u_jVeWD9oO2` confirms that the original
message still renders its sanitized HTML correctly, while Lumimail's quoted copy
loses bold, italic, underline, and link presentation.

**User job:** when I reply to an HTML email, preserve the safe formatting of the
message I am quoting without requiring a rich-text editor or trusting
client-supplied quote HTML.

## 2. Acceptance Criteria

- A reply to a message with sanitized HTML sends both `text` and `html`
  alternatives.
- The HTML alternative contains escaped authored text and the sanitized source
  HTML inside a semantic `blockquote`.
- The plain-text alternative contains authored text and a readable quoted source
  for clients that do not render HTML.
- The browser submits only the newly authored text and internal
  `replyToMessageId`; it does not copy the source body or submit derived HTML.
- The server reloads and authorizes the reply source in the selected mailbox,
  then derives both alternatives from persisted content.
- Draft autosave/reopen retains authored text plus the internal reply source;
  the quoted body is derived only when sending.
- New replies preserve bold, italic, underline, and safe links when an external
  HTML-capable client quotes them again.
- Existing already-sent messages are not rewritten.

## 3. Scope

**In scope:**

- Server-side reply-body derivation after F58 reply-source authorization.
- Safe HTML generation for plain authored text.
- Reuse of the persisted sanitized HTML source, with defense-in-depth
  sanitization before embedding.
- Plain-text quote generation.
- Removing the editable plain-text quote injection from reply compose.
- Keeping forwarding behavior unchanged.

**Out of scope:**

- A rich-text/WYSIWYG compose editor.
- Editing quoted HTML.
- Retrofitting previously sent messages.
- HTML-preserving forwarding.
- Inline CID image reconstruction.

## 4. Body Contract

For a threaded reply, the client body is treated as newly authored text only.
The server builds:

```text
AUTHORED TEXT

On the previous message, SOURCE wrote:
> SOURCE PLAIN TEXT
```

```html
<div>ESCAPED AUTHORED TEXT WITH LINE BREAKS</div>
<div>On the previous message, ESCAPED SOURCE wrote:</div>
<blockquote>SAFE SOURCE HTML OR ESCAPED SOURCE TEXT</blockquote>
```

Rules:

- Escape all authored text and attribution content.
- Convert authored and fallback source newlines to `<br>`.
- Sanitize persisted source HTML again before embedding.
- If sanitized source HTML is empty, use escaped source plain text.
- If neither source alternative has content, emit an empty blockquote rather
  than accepting quote content from the client.
- Bound behavior continues through the existing send validator/provider limits.
- Non-reply sends retain their existing `text`/`html` behavior.

## 5. Authorization & Security

- Reply source selection remains constrained by message ID, selected mailbox,
  organization, membership, non-draft status, and `read` capability.
- The source body is selected in the same authorized database query.
- Browser-provided HTML is ignored for threaded reply derivation.
- Persisted source HTML passes the Workers-compatible sanitizer immediately
  before inclusion.
- Generated HTML escapes all new user-authored text, addresses, and labels.
- Queue snapshots contain only final derived alternatives and the two F58
  allowlisted threading headers.

## 6. UI/UX

- Reply compose opens with recipient, subject, and an empty authored-text area.
- The historical quote is no longer inserted into the editable textarea.
- Autosave stores only authored content and `replyToMessageId`.
- Reopening a draft restores both values.
- Forward continues using its existing editable plain-text source copy.
- This repair does not add formatting controls; a rich-text composer remains a
  separate future feature.

## 7. Error & Edge States

| Condition | Behavior |
|---|---|
| Source HTML contains unsafe markup | sanitizer removes it before outbound storage/delivery |
| Source has HTML and text | HTML quote uses sanitized HTML; text quote uses text |
| Source has only HTML | text quote uses readable text derived from sanitized HTML |
| Source has only text | HTML quote uses escaped text with line breaks |
| Source has neither | send authored content with an empty quote |
| Unauthorized/deleted source | existing F58 non-enumerating HTTP 404 |
| Browser sends reply HTML | server-derived HTML replaces it |
| Existing sent flattened reply | unchanged |

## 8. Test Plan

| Layer | Coverage |
|---|---|
| Reply-body unit | escaping, line breaks, HTML preservation, sanitizer fallback, empty source |
| Send producer | authorized source body lookup, derived message/body/job values, client HTML ignored |
| Draft API | authored text and reply source persist without copied quote |
| Compose/browser | reply request contains authored text + source ID only; forward remains unchanged |
| Providers/Queue | existing multipart text/html snapshot delivery remains unchanged |
| Production | repeat the three-message chain and confirm external HTML quoting preserves formatting |

Run `npm run verify`, the focused Chromium reply contract, OpenNext build, and
Wrangler dry run before deployment.

## 9. Decisions

- Derive reply alternatives on the server, not in the browser, so authorization
  and HTML trust have one enforcement point. — 2026-07-24
- Keep the authoring surface plain text for this repair; rich-text authoring is
  valuable but is not required to preserve quoted HTML. — 2026-07-24
- Do not rewrite historical messages. — 2026-07-24

## 10. Bug / Change Log

### 2026-07-24 — Specify HTML-preserving reply alternatives

Type: `Correctness | Security | UX`

Summary:

- Defined server-derived multipart reply bodies that preserve sanitized source
  HTML without accepting browser-supplied quote content.

Reason:

- F58 production validation exposed progressive quote flattening even though
  conversation grouping and RFC headers worked correctly.

Tests:

- Planned unit, send-path, draft, browser, build, and controlled production
  validation.

### 2026-07-24 — Implement server-derived multipart reply bodies

Type: `Correctness | Security | UX`

Summary:

- Added one server-side reply-body builder that escapes newly authored text,
  sanitizes persisted source HTML again, and emits matching HTML and plain-text
  alternatives.
- Extended the existing authorized reply-source query to load the persisted
  body without adding a separate or less-constrained lookup.
- Removed source-body fetching and editable quote injection from reply compose;
  forwarding keeps its existing behavior.
- Queue snapshots and stored sent-message bodies now contain the final derived
  alternatives, while browser-provided reply HTML is ignored.

Tests:

- Added reply-body unit coverage for HTML preservation, unsafe markup removal,
  escaping, text-only and HTML-only fallbacks, and empty source bodies.
- Extended send-path coverage for authorized body loading, final queue/storage
  values, and rejection of client-selected reply HTML.
- Updated the focused Chromium contract to prove the reply textarea starts
  empty and the request contains authored text plus `replyToMessageId` only.
- `npm run verify` passes with 1,257 application tests at 100% statement,
  branch, function, and line coverage plus all 16 IMAP bridge tests.
- The focused Chromium reply contract passes.
- The OpenNext production build and Wrangler deployment dry run pass.

Not yet verified:

- A fresh production three-message chain after deployment. Historical flattened
  messages remain unchanged by design.
