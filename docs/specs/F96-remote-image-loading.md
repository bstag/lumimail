# F96 — Remote image loading on request

> Status: In Progress
> Owner area: `src/lib/email/sanitize.ts`, `src/components/messages/safe-message-html.tsx`, `src/app/api/messages/[messageId]/remote-image/route.ts`

## 1. Problem & User Job

Received mail references logos, product photos, and charts by remote URL. F34 removes
every remote image so senders cannot track opens or the reader's IP. The removal is
silent: a reader cannot tell anything is missing, and image-led mail (newsletters,
receipts with product photos) is hard to read. A mailbox owner needs to see that images
were withheld and choose to load them without exposing their own address.

## 2. User Stories & Acceptance Criteria

- As a reader, I see "N images hidden to protect your privacy" above a received message
  that references remote images, with a "Show images" action.
- Given I choose "Show images", the images load through Lumimail; the sender sees a
  Cloudflare address, never my IP, cookies, or referrer.
- Tracking pixels (width or height of 1–2 px) are dropped at ingest and never counted.
- The image endpoint serves only URLs that appear in that message's stored HTML, only
  to a user who can read the message (cross-tenant denial), only raster image types,
  and at most 5 MiB. Anything else is 404/415/413/502.
- Outbound sanitization is unchanged: remote images are never sent.

## 3. Scope Boundaries

**In scope:** inbound HTML sanitization, the notice and per-view opt-in, the proxy route.

**Out of scope:** a remembered per-sender "always show" preference; repairing mail
stored before this change (the F89 body repair re-sanitizes affected imports).

## 4. Data Model

No schema change. Sanitized inbound HTML may now contain
`<img data-remote-src="https://…" alt width height>` with no `src`.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/messages/[messageId]/remote-image?u=<url>` | session/API key | `u` = exact `data-remote-src` value | image bytes, `nosniff`, `private` cache, sandbox CSP | 401, 404 (no access / URL not in message), 413, 415, 502 |

## 6. UI/UX

- `SafeMessageHtml` renders the notice above the body when hidden images exist; the
  choice applies to that message view only.
- Images without `src` render nothing, so layouts stay compact until loaded.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/email/sanitize.test.ts` | deferred remote images, pixel drop, outbound unchanged |
| Unit | `tests/unit/components/messages/safe-message-html.test.ts` | client keeps only http(s) deferred sources; rewrite to proxy |
| Route | `tests/unit/app/api/messages/[messageId]/remote-image/route.test.ts` | auth, cross-tenant denial, URL membership, type/size limits, headers |

## 8. Current Behavior

F34 drops every non-`cid:` image at ingest and again in the browser.

## 9. Error States

Upstream failure or a non-image response shows the browser's broken-image state for
that image only; the rest of the message is unaffected.

## 10. Change Log

### 2026-11-07 — Initial implementation
