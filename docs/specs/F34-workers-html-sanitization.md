# F34 — Workers-compatible HTML sanitization

> Status: Shipped — R-19 verified locally and in production
> Owner area: `src/lib/email/sanitize.ts`, `src/lib/email/parse.ts`, `src/app/(dashboard)/inbox/[messageId]/page.tsx`

## 1. Problem and user job

Inbound email is untrusted content. Lumimail must display useful formatting without
allowing a sender to execute script, submit forms, navigate through active embedded
content, load tracking resources automatically, or inject dangerous attributes and
URLs.

The current `dompurify` + `linkedom` server implementation does not meet that job.
DOMPurify marks the supplied server DOM unsupported and returns input unchanged.
The main single-message render path then inserts the stored value with
`dangerouslySetInnerHTML` without browser sanitization. This is a confirmed stored-XSS
boundary.

## 2. Current behavior

- `parseRawMime()` calls the explicit allowlist `sanitizeHtml()` before storing
  inbound HTML.
- The server sanitizer parses with `linkedom`, traverses without application
  recursion, and serializes only the elements, attributes, and URLs in this spec.
- Parser/transformation failures return escaped text rather than the original markup.
- Both the thread-item and main single-message renderers apply browser DOMPurify
  with the shared tag, attribute, and URL policy as defense in depth.
- The sanitizer is included in the configured coverage gate with adversarial and
  fail-closed regression tests.

## 3. Desired behavior and acceptance criteria

- Importing and calling the sanitizer must work without a browser `window` or
  `document`, including in the Cloudflare Worker bundle.
- Common structural email formatting is retained through a documented allowlist.
- Executable or active elements are removed, including their unsafe content where
  applicable: scripts, styles, templates, forms/controls, frames, objects, embeds,
  SVG, MathML, metadata, and resource links.
- All event handlers, inline styles, class/id/name attributes, namespace attributes,
  and other unapproved attributes are removed.
- Links retain only `http:`, `https:`, and `mailto:` destinations. Obfuscated,
  protocol-relative, relative, `javascript:`, `data:`, `vbscript:`, file, blob, and
  malformed destinations lose their `href`.
- Retained links receive `rel="noopener noreferrer nofollow"`. A safe existing title
  may be retained.
- Images and other automatically loaded remote content are removed for this security
  remediation. A future image proxy/consent feature may reintroduce them under a new
  specification.
- HTML comments are removed.
- Null, undefined, and empty input return `null`.
- Sanitizer failures fail closed and never return the original HTML.
- Both the main message body and expanded thread messages apply browser-side
  DOMPurify as a second boundary.

## 4. Scope boundaries

In scope:

- Replace the unsupported server DOMPurify integration with an explicit allowlist
  transformation using the existing Workers-compatible `linkedom` parser.
- Add adversarial regression tests for elements, attributes, URLs, malformed markup,
  comments, and failure behavior that can be triggered deterministically.
- Restore the sanitizer to the coverage gate.
- Apply consistent browser defense in depth to both message render paths.

Out of scope:

- Remote-image proxying or click-to-load UX.
- CSS sanitization; all inline and embedded CSS is removed.
- Rewriting links through a tracking or warning service.
- Retroactively rewriting already stored rows. Browser defense in depth protects
  their display; a separate maintenance operation may re-sanitize stored content.
- Attachment preview sanitization, tracked with attachment remediation.

## 5. Sanitization policy

Allowed elements:

`a`, `abbr`, `b`, `blockquote`, `br`, `code`, `del`, `div`, `em`, `h1`, `h2`,
`h3`, `h4`, `h5`, `h6`, `hr`, `i`, `li`, `ol`, `p`, `pre`, `s`, `span`,
`strong`, `sub`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`,
`u`, and `ul`.

Allowed attributes:

- `a`: `href`, `title` after URL validation.
- `blockquote`: `cite` after the same URL validation.
- `td`/`th`: bounded positive integer `colspan` and `rowspan`.
- All allowed elements: `dir` only when `ltr`, `rtl`, or `auto`; `lang` only when
  it is a conservative language-tag value.

Unknown non-active elements are unwrapped so readable child text survives. Active
or metadata elements are removed with their entire subtree.

## 6. Data and API contracts

No schema or HTTP response change.

```ts
export function sanitizeHtml(html: string | null | undefined): string | null
```

`messageBodies.htmlBody` continues to store the returned HTML.

## 7. Error states

| Condition | Required behavior |
|-----------|-------------------|
| Empty input | Return `null`. |
| Malformed HTML | Parse and emit only allowed serialized content. |
| Unsupported/dangerous URL | Remove the URL-bearing attribute; preserve safe link text. |
| Parser/transformation exception | Return escaped plain text or an empty safe string; never return the original markup. |
| Existing hostile stored row | Browser DOMPurify removes active content before render. |

## 8. Edge cases

- Mixed-case element and attribute names.
- Character references and whitespace/control characters in URL schemes.
- Nested dangerous elements inside allowed formatting.
- SVG/MathML namespace switching and foreign content.
- Duplicate/nested links and malformed table markup.
- Very deep content must not rely on application recursion.
- Link text remains visible when its `href` is removed.
- International text and ordinary HTML entities remain readable.

## 9. Permissions and security

Sanitization applies to every inbound message regardless of sender, recipient,
organization, mailbox, or role. There is no trusted-sender bypass.

The implementation must not log message HTML. Sanitization is not a substitute for
mailbox authorization, safe response headers, or attachment validation.

## 10. Test plan

| Layer | File | Coverage |
|-------|------|----------|
| Unit | `tests/unit/lib/email/sanitize.test.ts` | Allowlist retention; dangerous element/subtree removal; attribute stripping; URL policy; comments; malformed input; null/empty behavior. |
| Unit | `tests/unit/lib/email/parse.test.ts` | Parsed MIME HTML passes through the safe sanitizer boundary. |
| Build | OpenNext/Wrangler dry run | Worker bundle imports and initializes the sanitizer without a browser DOM. |
| Browser | `tests/e2e/api-contracts.spec.ts` | A mocked hostile stored row is inert in the single-message render path. |
| Manual production | Controlled hostile email | After deployment, confirm stored/rendered output is inert without recording message content in committed files. |

`npm run verify` passes with `src/lib/email/sanitize.ts` restored to coverage.
The focused browser security test, OpenNext build, and Wrangler deployment dry run
also pass. Controlled production mail remains required before checking R-19 complete.

## 11. Decisions

- 2026-07-22: Do not depend on DOMPurify with a non-browser DOM after the existing
  pairing was proven to fail open.
- 2026-07-22: Use a strict allowlist and remove remote images/styles for the P0 fix.
  Preserving active email styling is less important than a defensible security
  boundary.
- 2026-07-22: Apply browser DOMPurify to every HTML render path as defense in depth,
  including already stored content.
- 2026-07-22: Do not add a new dependency while the existing `linkedom` parser can
  support a small, explicit policy.

## 12. Open questions

- Should a later feature add click-to-load images or a Cloudflare-hosted image proxy?
- Should existing `message_bodies.html_body` rows be re-sanitized in a maintenance job?

Neither question blocks this fail-closed remediation.

## 13. Bug/change log

### 2026-07-22 — Replace fail-open Workers sanitizer

Type: Security Fix

Summary:
- Replaced the unsupported DOMPurify/linkedom server pairing with an explicit
  Workers-compatible allowlist sanitizer.
- Added a shared browser/server policy, adversarial regression coverage, fail-closed
  parser coverage, and consistent browser defense in depth.

Reason:
- Hostile inbound HTML currently survives storage sanitization unchanged and can be
  inserted directly by the main message view.

Impact:
- Incoming email retains safe structural formatting while active content, remote
  resources, styling, and unsafe URLs are removed.

Tests:
- The original regression test failed with 7 of 9 hostile cases surviving.
- 16 focused sanitizer/parser tests pass.
- `npm run verify`: 112 test files and 881 tests pass with 100% configured coverage;
  lint has 43 existing warnings and no errors.
- Focused Playwright browser security test passes.
- Full Playwright suite passes (12 tests).
- OpenNext production build and `wrangler deploy --dry-run` pass.
- Deployed as Worker version `722ae8e3-bb50-4031-9b96-dfc590a20739`; Worker startup
  was 105 ms and post-deployment manifest/login HTTP smoke checks returned 200.
- A controlled production reply suppressed its remote image. Quoted-reply detection
  selected the plain-text alternative, confirming a separate reply-display limitation
  now tracked under R-25.
- A new non-reply production HTML message retained bold formatting and a safe HTTP
  link in the final message view.
- R-19 production acceptance is complete.
