# F94 — Public Privacy Policy and Terms of Service

> Status: In Progress
> Owner area: `src/app/privacy/`, `src/app/terms/`, `src/components/legal/`,
> `src/lib/legal/`, `src/app/page.tsx`, `src/i18n/messages/`

## 1. Problem & User Job

The public deployment at `https://mail.henriksen.dev` has a landing page but no privacy
policy or terms of service (`/privacy` and `/terms` return 404). Google's OAuth branding
and verification review requires a publicly reachable home page that links to a privacy
policy, and a privacy policy on the same domain that discloses Google user data use and
the Limited Use commitment. The operator, Stagware, needs both documents to finish the
Google Cloud consent-screen branding, which the F89 Gmail connection depends on.

Visitors, prospective users, and Google's reviewers must be able to read both documents
without signing in.

## 2. User Stories & Acceptance Criteria

- As an unauthenticated visitor, I can open `/privacy` and `/terms` and read each
  document.
  - Given no session, when I request either route, then I receive the document, not a
    login redirect or a 404.
- As a visitor on the landing page, I can find both documents from the page footer.
- As a Google reviewer opening the home page, I can see, without signing in, what Picket
  is for, what the optional Google account connection does, and an explicit statement
  that Picket does not use Google APIs or Google user data to create or distribute
  non-consensual intimate imagery (including AI-generated imagery) or for generative
  image or video creation.
  - Given no session, when I load `/`, then a "What Picket is for" section is present in
    the server-rendered HTML with those statements and links to both documents.
- As a reader of either document, I can reach the other document and the home page.
- As a Google reviewer, I can find on `/privacy`:
  - the operator name and a monitored contact address;
  - every Google scope Picket requests and what each is used for;
  - how Google user data is stored, who can read it, and how to disconnect and delete;
  - the Google API Services User Data Policy Limited Use statement.
- Each document states an effective date.

## 3. Scope Boundaries

**In scope:**

- Two static, public, server-rendered pages: `/privacy` and `/terms`.
- Document content held as typed data in `src/lib/legal/`, rendered by one shared
  component.
- Footer links on the landing page (localized labels in all 11 locales).
- A test that keeps the disclosed Google scopes equal to the scopes the code requests.
- A purpose and Google-use disclosure section on the home page, held as typed data with
  the legal content, and the matching prohibition in the Terms of Service.

**Out of scope:**

- Translating the legal text. The documents are English only; the landing footer link
  labels are localized.
- A cookie banner. The service sets only a strictly necessary session cookie and uses no
  analytics or advertising trackers.
- Self-service account or mailbox deletion. The policy directs deletion requests to the
  operator by email.
- Legal review. The documents are drafted from the code's actual behavior and must be
  reviewed by the operator before being relied on.

## 4. Data Model

No existing behavior touched; no schema or migration changes.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/privacy` | none | none | HTML document | none |
| GET | `/terms` | none | none | HTML document | none |

## 6. UI/UX

- One `LegalDocumentView` component renders the brand lockup (linking home), the title,
  effective date and summary, each titled section, and a footer navigation (Home,
  Privacy, Terms).
- All color uses semantic design tokens; the pages follow the light/dark theme.
- Single readable column, usable at 390 px and desktop widths, no horizontal scroll.
- The landing page gains a footer with Privacy and Terms links and the operator name.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/legal/legal-content.test.ts` | operator facts, unique section ids, well-formed links, ISO effective date, Google scope disclosure equals the scopes `getExternalOAuthProvider` requests, Limited Use statement, no unfilled placeholders |
| Unit | `tests/unit/i18n/keys.test.ts` (existing) | new landing keys exist in every locale |
| E2E | `tests/e2e/legal-pages.spec.ts` | both routes render without a session, landing footer links reach them, cross-links work |

Coverage target: 100% for new/changed files in `src/lib/`; React views are exercised by
Playwright.

## 8. Current Behavior

No existing behavior — new feature. `/privacy` and `/terms` currently return 404.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| Unknown legal path | Standard 404 | 404 | No |

## 10. Edge Cases

- Signed-in visitors see the same document; the pages never depend on session state.
- Dark theme, light theme, and system theme all keep the text readable.
- Mobile viewport: long words and URLs wrap; no horizontal scrolling.
- A change to the requested Google scopes fails the disclosure test until the policy is
  updated.

## 11. Permissions & Security

- Public and static; no request data is read, stored, or echoed.
- No secrets, tenant data, or environment values appear in either document.
- Statements about data handling must match the implemented behavior (F89, F63, F88,
  F87, `docs/OPERATIONS.md` data-egress inventory). A behavior change that invalidates a
  statement requires updating the document.

## 12. Open Questions / Decisions

- Decision 2026-09-30: the documents present the service as **Picket** (the current
  product name, F91) operated by **Stagware**, contact `support@henriksen.dev`.
- Decision 2026-09-30: English only, effective date 2026-09-30.
- Open: governing-law jurisdiction for the Terms is not yet specified and is worded
  generically. The operator should set it.
- Open: Google verification for the sensitive Gmail scopes is a separate operator task.

## 13. Bug / Change Log

### 2026-09-30 — State the application's purpose and Google API restrictions on the home page

Type: Behavior Change

Summary:

- The home page gains a "What Picket is for" section: the product's purpose, what the
  optional Google connection does, what Picket does not do (no NCII or generative image
  use of Google APIs, no advertising, no sale, no AI training), and links to both
  documents. The Terms prohibit non-consensual intimate imagery, and the privacy policy
  repeats the commitment.

Reason:

- Google's API Terms of Service review could not confirm compliance and asked for a home
  page that clearly outlines the application's purpose and confirms Google APIs are not
  used for AI-generated non-consensual intimate imagery. The home page described Picket
  only as "Cloudflare-native email operations" and never mentioned the Google connection.

Impact:

- Presentation only. English text, like the legal documents; no data, API, or schema
  changes.

Tests:

- `npm run verify` passed 2026-09-30 (2,762 unit tests, coverage and CRAP gates). The
  legal-pages Playwright spec passed 6 of 6 and the landing spec 4 of 4, including a
  check that the purpose section is in the initial HTML with JavaScript disabled.
- Not yet deployed.

### 2026-09-30 — Add public privacy policy and terms of service

Type: Feature

Summary:

- Added `/privacy` and `/terms`, shared rendering, landing footer links, and localized
  link labels.

Reason:

- Google OAuth branding review requires a public home page linking to a privacy policy
  that discloses Google user data use. None existed.

Impact:

- Two new public routes and a landing footer. No data, schema, or API changes.

Tests:

- `npm run verify` passed 2026-09-30: typecheck, lint with no errors, 2,760 unit tests, the
  100% coverage gate, and the CRAP gate. The new legal-pages spec and the existing landing
  spec passed 8 of 8 in Playwright, including a 390 px no-horizontal-scroll check.
- Not yet deployed.

Notes:

- Not legal advice; operator review required before reliance.
