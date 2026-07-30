# Tech Debt Remediation Plan — 2026-07-30 batch

One large maintainability batch executed on a single branch (`chore/tech-debt-batch`)
as a sequence of independently verifiable waves. Each wave ends with a green
`npm run verify`; waves that touch user-visible behavior also run `npm run e2e`.
Every commit within the batch is scoped to one T-item so the batch is bisectable.

Source: four-layer maintainability review (API routes, lib/email core, UI,
schema/tests/config) performed 2026-07-30. This plan supersedes nothing —
`REMEDIATION_PLAN.md` MVP items (R-11, R-17, R-18, R-23) remain tracked there.

## Ground rules for the batch

- **Behavior-preserving by default.** Except for Wave 0 bug fixes, no observable
  behavior changes. Refactors ride under existing tests; tests move with code but
  are never weakened.
- **Spec-first for bugs.** Each Wave 0 item gets a failing test before the fix and
  a spec update (existing spec where one covers the surface).
- **Preserve the crown jewels.** The outbound claim/fencing logic, `sanitize.ts`,
  `forwarding.ts`, and `messageAccessCondition` are moved, not rewritten.
- **Order matters.** Wave 1 helpers exist to make Waves 2–3 diffs small; do not
  reorder waves.

## Precondition (before the branch is cut)

- [x] **T-00 Land the in-flight F74 work.** The working tree holds the F74
  auth-hardening changes and migration `0027`. Commit and verify them on `main`
  first so the batch contains only debt work.

## Wave 0 — Correctness fixes (each spec-first, with failing test)

- [x] **T-01 Read-scope API keys mutating message state — resolved as
  working-as-specified.** [F52](specs/F52-imap-smtp-bridge-contract-repair.md)
  (decision 2026-07-23) fixes the scope vocabulary at `read`/`send`, and the
  IMAP contract requires the `read` scope to cover client state flags
  (read/unread, trash) — PATCH's schema is already narrowed to exactly those
  reversible flags, and scope denial is tested. Disposition: comment added at
  the `authorize()` site citing F52 so the pattern is not re-flagged as a
  privilege escalation. No behavior change.
- [x] **T-02 Declining a routing-rule delete must not report success.**
  `src/app/(admin)/routing/page.tsx:87` calls `confirm()` inside `mutationFn`;
  Cancel resolves as success and invalidates queries. Move confirmation before
  `mutate()` (interim), replaced by `ConfirmDialog` in T-21. Effort S.
- [x] **T-03 Fix the `["domains"]` query-key collision.** `domains/page.tsx`
  (`?includeDns=true`) and `routing`/`mailboxes` pages share one key with two
  payload shapes. Introduce `src/lib/query-keys.ts`; key becomes
  `["domains", { includeDns }]`. Audit `["mailboxes"]` for the same hazard. Effort S.
- [x] **T-04 Provider misconfiguration must be retryable, not terminal.**
  `selectOutboundProvider` throws plain `Error` inside the consumer's send
  try-block (`src/lib/email/send.ts:605`), so an unknown `MAIL_PROVIDER` or
  missing `RESEND_API_KEY` marks queued jobs `failed`. Wrap config errors as
  `OutboundProviderError` with `retryable: true` (or pre-flight the provider
  outside classification). Update [F54](specs/F54-durable-outbound-delivery.md).
  Effort S.
- [x] **T-05 Neutralize the `db:generate` trap.** `drizzle/migrations/meta/_journal.json`
  stops at 0009 with 4 snapshots against 28 SQL migrations; the documented
  `npm run db:generate` would emit a wrong mega-migration. Decision: **commit to
  hand-written migrations** — delete `meta/`, remove the `db:generate` script,
  update `CLAUDE.md` and `MVP_SCOPE.md` conventions. (Alternative — regenerating
  snapshots — costs more and preserves a workflow nobody has used since 0006.)
  Effort S.
- [x] **T-06 Guard or document `/api/setup/domain`.** The unauthenticated POST
  provisions Cloudflare DNS; only defense is the primary-domain 409. Add an
  explicit first-boot guard (reject when any user exists) plus a comment naming
  the invariant. Effort S.

## Wave 1 — Shared primitives and deletions (unblocks everything after)

API layer:

- [x] **T-10 `withUser` / `withOrgAdmin` / `withOrgOwner` route wrappers** in
  `src/lib/api/handler.ts`: `getEnv` + guard + enveloped 401/403. Migrate the 8
  legacy `getCurrentUser` routes first, then mechanically the rest (75 preamble
  repetitions across 43 files). Effort M.
- [x] **T-11 `parseJsonBody(request, schema)`** returning `{data} | {errorResponse}`:
  kills 14 raw `as`-cast handlers, unguarded `request.json()` 500s, and the three
  competing Zod-error formats. Promote `firstZodMessage` from
  `src/app/api/routing-rules/utils.ts` into `src/lib/api/response.ts`. Effort M.
- [x] **T-12 Narrow `guardOrgAdmin` result type** so `organizationId: string`
  (removes 32 `as string`/`!` casts); add a `guardOrgMember` variant for
  non-admin routes that hand-check `user.organizationId` today. Effort S.
- [x] **T-13 Small shared helpers:** `enforceRateLimit` (4 copies),
  `setSessionCookie` (register/login literal), `mapSendError`
  (`/api/send` vs `/api/v1/send`), `validateDraftInput` (drafts POST/PATCH ~30
  duplicated lines), `enrichMessagesWithContacts`. Effort S each.

Constants and schema hygiene:

- [ ] **T-14 Single source for shared enums/constants.** Export
  `MAILBOX_ROLES`, `ORG_ROLES`, `ROUTING_ACTIONS`, `DEFAULT_LABEL_COLOR`,
  hostname regex, `SENDER_ROLES`, `RETRY_DELAY_SECONDS`, error-truncation length,
  and reuse `MAX_ATTACHMENT_COUNT` in `isAttachmentSnapshotArray`. Consume from
  both `src/db/schema/index.ts` and `src/lib/validators.ts`. Document or unify
  the diverging localPart regexes (`%` allowed in registration, forbidden in
  aliases). Effort S.
- [ ] **T-15 Schema consistency pass:** one formatting pass (tabs), array-form
  index callbacks for `rateLimits`, enum-type `messages.status` and
  `webhookDeliveries.status`, comment on `rateLimits.resetAt` integer mode.
  No migration required (types only). Effort S.
- [ ] **T-16 Utility dedup:** one email normalizer (keep vacation's null-safe
  variant with its comment), one `sanitizeFilename`, one SHA-256-hex helper
  (`src/lib/crypto-utils.ts`), one `attachmentKey()` + rollback helper
  (`src/lib/email/attachment-storage.ts` — the key scheme is a security
  invariant currently encoded in three literals), `src/lib/format.ts` for bytes
  and locale-aware dates (next-intl `useFormatter`), move
  `escapeHtml`/`plainTextToHtml` out of `compose-form.tsx`. Effort S.
- [ ] **T-17 Rate-limit purge off the hot path:** move the full-table
  `DELETE FROM rate_limits` from every check into the existing cron in
  `worker.ts scheduled()`; attach `cause` to `RateLimitUnavailableError`. Effort S.

Tests:

- [x] **T-18 Unit-test harness:** `tests/unit/helpers/route-mocks.ts` exposing
  `mockRouteDeps()` (standard `@/db`, `@/lib/cloudflare`, `@/lib/auth/cookies`,
  `@/lib/rate-limit` mock bag) and shared `jsonRequest()` builders. Adopt in
  files touched by this batch; opportunistic elsewhere. Effort M (incremental).
- [x] **T-19 Promote `mockOwnerShell` into `tests/e2e/shell.ts`** with options for
  role/mailboxes/counts; adopt in the 13 specs that hand-mock the shell. Effort S.
- [x] **T-20 Harden `wrangler-local-bindings.test.ts`:** parse the JSONC and
  assert structure instead of raw substrings. Effort S.

UI primitives:

- [x] **T-21 `ConfirmDialog`** modeled on the api-keys revoke dialog; replace the
  5 native `confirm()` calls (completes T-02 properly). Effort S.
- [x] **T-22 `apiJson.get/post/patch/delete`** wrapper using `parseApiResponse`
  (kills 35 header/stringify blocks); fold `readRoutingResponse`'s bare-string
  tolerance into `parseApiResponse` and delete it. Global `MutationCache.onError`
  → shared toast so no mutation fails silently (members role change, labels
  delete, bulk actions today). Effort M.
- [x] **T-23 `ListSection` / empty-state and `FormField` primitives** to collapse
  the three divergent loading/empty stylings and ~30 label+input triples. Effort S.

Deletions (safe, verified unreferenced):

- [~] **T-24 (in progress — search route, folder-page props, textarea, comment blocks done) Delete dead code:** `/api/messages/search` (no client callers —
  verified 2026-07-30), `src/components/ui/textarea.tsx` (wire vacation form to
  it instead if trivial, else delete), `MessageFolderConfig.title`, inert
  `headerIcons`, dead validator exports (`registerSchema`,
  `primaryDomainRegisterSchema`, `domainSchema`), labels routes pointed at the
  shared (currently unused) label schemas, `@types/dompurify` and
  `@types/bcryptjs`, commented-out blocks in `mailboxes/page.tsx` and
  `src/app/page.tsx`, `requireUser`/`guardOrgUser` after confirming no
  server-component usage. Unify tiptap pinning. Effort S.

## Wave 2 — Structural refactors (behavior-preserving)

- [ ] **T-30 Split `src/lib/email/send.ts` (735 lines) into
  `src/lib/email/outbound/`:** `authorization.ts`, `snapshot.ts` (the
  producer/consumer contract), `submit.ts`, `consumer.ts`, `recovery.ts`;
  keep `send.ts` as a re-export barrel. Merge the duplicated authorization
  queries (`getSenderContext` folds into `resolveSenderAuthorization`'s returned
  mailbox row). Extract `failJobQueueUnavailable`. Effort M.
- [ ] **T-31 Hoist the Cloudflare rule mutation out of send-time authorization.**
  `resolveSenderAuthorization` currently calls `ensureEmailRoutingRuleToWorker`
  on every send. Provision at mailbox-create/domain-provision time (plus a
  reconcile path); make authorization pure DB. Confirm no flow depends on
  send-time provisioning before removal — if one does, move it out of the
  authorization function and off the common path. Effort M.
- [ ] **T-32 Break the inbound↔send module cycle:** move `AUTO_REPLY_HEADERS` to
  a constants module; extract `maybeVacationRespond` into
  `vacation-responder.ts` (options object instead of 8 positional params) with a
  static `sendEmail` import; extract `applyMessageFilters` (merge per-filter
  updates into one write, drop the `as string` cast); move `getMessageWithBody`
  to `src/lib/messages/queries.ts`; export a named `ParsedEmail` type. Effort M.
- [ ] **T-33 Unify the response envelope.** Adopt `apiSuccess`/`apiError` in the
  30 raw-`Response.json` files (including all 12 `/api/messages/*` routes), fix
  the hand-rolled 201s, standardize the guard 401 shape. Mechanical,
  route-by-route, tests updated 1:1. Riskiest consumer is the client parsing —
  T-22's `apiJson` adoption should precede or accompany each route's migration.
  Effort M.
- [ ] **T-34 Migrate the mail UI to TanStack Query.** Replace the hand-rolled
  cache/event-bus in `src/hooks/utils.ts:72-152`, `use-messages.ts`,
  `use-message-counts.ts` with `useQuery` (per-folder `refetchInterval`,
  `refetchOnWindowFocus`) and `invalidateQueries`; delete `notifyMessagesChanged`.
  Convert the stragglers (aliases, members, message detail, vacation form,
  mailbox-provider, landing page). Folder-by-folder behind the e2e suite;
  messages last. Effort L.
- [ ] **T-35 Wire the existing i18n keys.** Decision: **wire, don't delete** —
  11 locales and RTL support are a deliberate product feature; the `admin` (75)
  and `landing` (12) namespaces already match the hardcoded strings, so this is
  mechanical. Include toasts, `aria-label`s, and confirmation prompts; add
  missing keys for labels/filters/contacts pages. Follow-up guard: a test that
  fails on untranslated literals in client components (scoped to a lintable
  pattern, not a full grep of prose). Effort M.
- [ ] **T-36 Split god components when touched:** `compose-form.tsx` →
  `useComposeDraft`, `useComposePrefill`, `useAttachments`, `AttachmentChips`;
  extract shared `MessageBody` in `inbox/[messageId]` (removes the duplicated
  renderer); `LabelFilterBar` + `FolderPagination` out of
  `message-folder-page.tsx`. Effort M.
- [ ] **T-37 Fix `queue-health.ts` insert-row cast** (`row as $inferSelect`) and
  index-coupled arrays: build `{definition, row}` pairs. Effort S.
- [ ] **T-38 Error-regime convergence:** result unions (per `forwarding.ts`) for
  expected outcomes, typed errors for exceptional ones. Add
  `DomainAlreadyRegisteredError` so duplicate-domain is distinguishable from a
  CF failure at `/api/domains`; route boundaries stop collapsing distinct
  failures into one string. Effort M.

## Wave 3 — Larger extractions (still in-batch, last because widest blast radius)

- [ ] **T-40 Service extractions for the god routes:**
  `src/lib/email/routing-rules-service.ts` (catch-all dance shared by POST/PATCH),
  `src/lib/email/alias-service.ts` (provision + compensation saga),
  `src/lib/auth/registration.ts` (invite-claim and first-run flows with their
  rollbacks). Model: the existing `domains/service.ts`. The compensation logic
  gains isolated unit tests. Effort L.
- [ ] **T-41 Single source of truth for org membership.** Today
  `users.organizationId` and `organizationMembers` coexist and `session.ts`
  reads both. In-batch scope: document the invariant where both are read, add a
  consistency assertion/test, and stop *new* code from touching the column
  directly (accessor in `src/lib/auth/`). Full column retirement (migration +
  backfill removal) is deliberately **out of batch** — schedule after the batch
  ships. Effort M (in-batch portion).
- [ ] **T-42 `routing.ts` `resolveInboundTargets` split:** `resolveAliasDecisions`
  / `resolveGroupMembers`, pass the loaded domain into the fallback (removes the
  doubled query), remove or justify the unreachable legacy arm with a test.
  Effort M.
- [ ] **T-43 Seed isolation:** move fixtures to `seed-fixtures.ts`; gate the seed
  route on an explicit env binding (`SEED_ENABLED`) instead of `NODE_ENV`;
  seeds populate `organizationId` (current org-scoped shape, not the legacy
  single-user shape). Effort S.

## Explicitly deferred (not in this batch)

- Full `users.organizationId` column retirement (see T-41).
- Splitting `src/db/schema/index.ts` or `validators.ts` — both are under the
  size where splitting pays; revisit at ~40 tables.
- `wrangler.jsonc` personal-config split (gitignore-with-example) — separate
  decision with deployment-workflow impact.
- Sync-bcrypt session-verification cost — performance work, needs measurement
  first.
- The MVP evidence items (R-11, R-17, R-18, R-23) — tracked in
  `REMEDIATION_PLAN.md`.

## Verification gates

| After | Gate |
|-------|------|
| Each T-item commit | `npm run typecheck` + focused tests |
| Wave 0 | `npm run verify` + new failing-then-passing tests per bug |
| Wave 1 | `npm run verify`; `npm run e2e` (ConfirmDialog, toast changes) |
| Wave 2 | `npm run verify` + `npm run e2e` after T-33, T-34, T-35 each |
| Wave 3 | `npm run verify` + `npm run e2e`; full pass before merge |
| Merge | Coverage remains at the 100% configured gate; spec/registry updates land with the batch |

## Spec/registry impact

- Wave 0 updates: F44/F52 (scopes), F54 (retry classification), F02 (setup guard).
- T-05 updates `CLAUDE.md` and MVP_SCOPE conventions (migration workflow).
- T-35 touches F53's successor surface; note under F71 or a new i18n spec row.
- The batch itself gets a registry row referencing this plan once merged.
