# F70 — Documentation Status Sweep

> Status: `Shipped (local)`

## 1. Problem & User Job

Lumimail's implementation and production evidence moved faster than its overview
documents. The README and landing page advertise the product to prospective
operators, while `MVP_SCOPE.md`, `FEATURE_VALIDATION.md`, and the feature-spec
index help contributors decide what is complete. Contradictory status claims make
both audiences choose from stale information.

The user job is to understand what Lumimail does today, which capabilities are
locally complete versus production-verified, and what work still prevents a
general production-ready claim.

## 2. Current Behavior

- `README.md` accurately lists many implemented features but calls message search
  full-text, describes the interface as "Gmail-class", and does not explain durable
  delivery, delivery recovery, safe external forwarding, mailbox capabilities,
  queue health, or the remaining bridge deployment boundary.
- `docs/FEATURE_VALIDATION.md` is a dated 2026-07-22 audit whose limitations for
  F03, F05, F07, F12, F13, F17, F25, F27, F30, F31, and F33 were subsequently
  repaired or narrowed by F47–F64.
- `docs/README.md` indexes only the earliest specifications and makes the newer
  behavioral contracts difficult to discover.
- `docs/MVP_SCOPE.md` contains current feature rows alongside an obsolete
  "MVP blockers" table and gate notes that still call completed recovery work
  unimplemented.
- The public landing page describes only the earliest domain, routing, API-key,
  and team-mailbox surface.

## 3. Desired Behavior

- Public claims use bounded, supportable language and distinguish the web app from
  separately deployed services such as the IMAP/SMTP bridge.
- Completed reliability, security, routing, attachment, access-control, theme,
  and navigation work is discoverable from the README and landing page.
- Historical audits are retained for traceability but clearly point readers to
  the live feature registry for current status.
- The docs hub lists every current numbered specification.
- The MVP registry reports only evidence supported by the remediation log and
  preserves remaining production-readiness gaps.

## 4. Scope Boundaries

In scope:

- Repository Markdown read by operators, contributors, and prospective users.
- Customer-facing copy rendered by `src/app/page.tsx`.
- Cross-links, dates, feature status, and explicit deployment boundaries.

Out of scope:

- Changing product behavior.
- Marking local-only F68/F69 work as deployed.
- Marking F13, F63, R-11, R-17, R-18, or the final production-readiness gate
  complete without their required evidence.
- Publishing a deployment or pushing a branch without explicit authorization.
- Rewriting historical evidence inside individual completed feature specs.

## 5. Edge Cases and Error States

- A feature may be implemented locally but not deployed; public copy must not say
  production-verified in that case.
- A feature may be production-verified while its original audit remains useful;
  the audit should be labeled as a snapshot rather than silently rewritten as if
  performed later.
- "Search" must not imply body full-text search when the bounded implementation is
  metadata/snippet search.
- "IMAP/SMTP support" must mention that the bridge is a separate service and that
  production hosting/TLS/client validation remain operator work.
- Relative Markdown links must resolve from the file that contains them.

## 6. Test Plan

- Add a documentation contract test that checks:
  - every `docs/specs/F*.md` file is linked from `docs/README.md`;
  - the current validation document identifies itself as a historical snapshot
    and links to `MVP_SCOPE.md`;
  - known stale public claims are absent;
  - README and landing copy preserve the IMAP/SMTP deployment qualification.
- Run the focused documentation contract.
- Run `npm run verify`.
- Run `npm run e2e` because landing-page copy is user-visible.

## 7. Decisions

- Decision: keep `FEATURE_VALIDATION.md` as the original 2026-07-22 evidence
  snapshot and add a current reconciliation section. Rewriting its original rows
  would destroy the historical record and imply that the whole audit was rerun.
  — 2026-07-26
- Decision: use `MVP_SCOPE.md` as the one live status registry; overview documents
  summarize and link to it rather than growing parallel matrices. — 2026-07-26
- Decision: "online" means update the customer-facing landing source in this
  repository. Deployment is a separate external mutation and is not implied by a
  documentation-edit request. — 2026-07-26

## 8. Open Questions

- Whether to deploy these changes to the production Worker after review.
- Whether to give the project a separately hosted documentation site; none exists
  in the current repository configuration.

## 9. Bug / Change Log

### 2026-07-26 — Reconcile public and contributor documentation

- Audit the README, landing page, live feature registry, historical validation
  report, documentation hub, operations guide, remediation plan, and recent
  feature specs against current code, tests, and recorded production evidence.
- Update bounded customer-facing claims and navigation.
- Add automated drift checks for the documentation surfaces touched by the sweep.
- `tests/unit/docs/documentation-status.test.ts` passes all three contracts.
- `npm run verify` passes: typecheck, lint with 39 pre-existing warnings and no
  errors, 1,487 application tests at 100% configured coverage, and all 16 bridge
  tests.
- The two landing-page Chromium scenarios pass. The full mocked Chromium run
  reached 43 passing scenarios and three failures before the known development
  server/remote Wrangler proxy teardown prevented Playwright from exiting; it was
  not a clean suite pass and is not recorded as one.
- No production deployment or external publishing was performed. The landing
  source and repository documentation are ready for the normal review/deploy
  workflow.
