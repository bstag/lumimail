# F91 — Picket UI Rebrand

> Status: `Shipped`
> Owner area: `src/app/`, `src/i18n/messages/`, `src/lib/`, `public/`, `imap-bridge/src/`

## 1. Problem & User Job

The maintained public fork still presents the inherited Lumimail product name throughout the web UI,
install metadata, transactional email, push notifications, and client-facing protocol messages. The
fork should present the new product name, **Picket**, without changing the repository's provenance or
the runtime identifiers on which existing deployments and stored data depend.

## 2. User Stories & Acceptance Criteria

- As a visitor, I see Picket in the landing-page wordmark and browser/install metadata.
- As a signed-in user, I see Picket anywhere the application identifies itself.
- As an email, push, IMAP, SMTP, or MCP client, I receive Picket-branded human-readable copy.
- Given an existing deployment, when the UI rebrand is deployed, its database, browser compatibility
  keys, Cloudflare bindings, queues, buckets, release formats, encryption contexts, and API contracts
  continue unchanged.
- No user-facing source or static asset in the bounded rebrand surface contains the display name
  `Lumimail` after the change.

## 3. Scope Boundaries

**In scope:**

- Next.js metadata, landing-page wordmark, PWA manifest, offline shell, and push copy.
- Localized product-name, navigation, domain-routing, and operations copy.
- User-facing settings, authorization, password recovery, invitation, attachment, and routing text.
- Human-readable MCP, IMAP, SMTP, and bridge process messages.
- Existing tests that assert this product copy.

**Out of scope:**

- Git history, repository/fork relationships, licensing, copyright notices, and maintainer documentation.
- Logos, icons, colors, or layout changes.
- Lowercase `lumimail` runtime identifiers, environment variables, browser-storage keys, event names,
  database columns/indexes/migrations, Cloudflare resources, release/recovery formats, test origins,
  MIME boundaries, and encryption contexts.
- Renaming internal exported symbols such as `createLumimailMcpServer` or `LumimailApiError`.
- Provisioning or changing any remote Cloudflare resource.

## 4. Data Model

No tables, columns, indexes, or migrations change.

## 5. API Contract

No request or response shape changes. Existing human-readable validation errors that identify the
product use Picket; their HTTP status and machine-readable envelope remain unchanged.

## 6. UI/UX

- The exact display spelling is `Picket`.
- Existing iconography, colors, typography, layout, responsive behavior, and RTL behavior are retained.
- Product names are not translated; every locale uses the Picket proper name inside its existing
  translated sentence structure.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/pwa-static-assets.test.ts` | Install metadata, offline shell, and push copy |
| Unit | existing auth/email/routing/MCP tests | Human-readable product copy and unchanged behavior |
| Unit | `imap-bridge/test/` | Client-facing IMAP/SMTP bridge greetings and errors |
| E2E | existing PWA and settings flows | Browser-visible Picket copy |
| Static audit | `rg` over bounded user-facing paths | No remaining display-name occurrences |

Run `npm run verify` and `npm run e2e` after implementation.

## 8. Current Behavior

The application displays Picket in metadata, the landing page, all locale catalogs, install/offline
assets, push notifications, settings screens, transactional messages, and protocol-client copy.
Lowercase compatibility identifiers and internal exported symbol names remain unchanged.

## 9. Error States

Behavior and status codes do not change. Only product-name text changes from Lumimail to Picket.

## 10. Edge Cases

- Existing installed PWAs receive updated manifest and offline copy through the current no-cache policy.
- Existing service-worker cache names remain unchanged so the rebrand does not alter cache lifecycle.
- Existing local/session storage survives because lowercase compatibility keys remain unchanged.
- Existing encrypted data remains decryptable because encryption contexts remain unchanged.
- RTL and non-English messages retain their translated grammar around the Picket proper name.

## 11. Permissions & Security

No authorization, tenant boundary, secret handling, or audit behavior changes.

## 12. Open Questions / Decisions

- Decision: use the exact spelling `Picket`; this supersedes the initial mixed-case spelling. — 2026-09-01
- Decision: preserve the existing colors and icons. — 2026-09-01
- Decision: retain Git history and the public fork relationship. — 2026-09-01
- Decision: preserve every lowercase compatibility identifier and all remote infrastructure. — 2026-09-01

## 13. Bug / Change Log

### 2026-09-01 — Present the maintained fork as Picket

Type: `Behavior Change`

Summary:
- Replace the inherited user-facing Lumimail display name with Picket.

Reason:
- Give the maintained fork a distinct visible identity without a risky data or infrastructure migration.

Impact:
- Users and connected clients see Picket; deployment compatibility remains unchanged.

Tests:
- `npm run verify` passes with 2,665 tests, 100% statement/branch/function/line coverage, the CRAP gate,
  and 21 bridge tests.
- `npm run e2e` passes all 102 Chromium scenarios.
- The bounded static audit finds only documented internal symbols, comments, and lowercase
  compatibility identifiers.
- Staging Worker version `bdb95459-c255-42bc-a17d-4b37f052788e` serves the corrected Picket casing;
  the public smoke contract passes 8/8 and the live manifest reports `Picket`.
- Production Worker version `9a76668b-d990-4cde-be74-f9c9bb7b5dfc` serves the corrected Picket casing
  at `https://mail.henriksen.dev`; the public smoke contract passes 8/8 and the live manifest reports
  `Picket`.

Notes:
- Repository provenance and AGPL notices remain intact.
