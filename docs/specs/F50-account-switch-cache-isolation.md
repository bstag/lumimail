# F50 — Account-Switch Cache Isolation

> Status: Implemented Locally — Deployment Pending
> Remediation: security follow-up discovered during F47/F48 production validation

## 1. Problem

Lumimail keeps mailbox options, message lists, message counts, TanStack Query results, and the selected mailbox ID in browser memory or `localStorage`. Logging out removes the session token but does not clear those account-scoped values.

In production, logging out of a restricted account and into the owner account initially showed the restricted account's one-mailbox selector. A hard refresh restored the owner's full mailbox list because it discarded the stale JavaScript caches.

Server-side mailbox authorization remains authoritative and the F47 production checks rejected inaccessible message data. However, stale browser caches can expose mailbox metadata and may render message rows fetched by the previous account without making a new authorized request. This is a cross-account data-isolation defect.

## 2. Current behavior

- `mailbox-provider-utils.ts` caches `/api/mailboxes` results in module memory.
- `hooks/utils.ts` caches message lists and counts with keys that do not include the authenticated identity.
- the root TanStack Query client survives client-side logout/login navigation.
- `selected-mailbox-id` remains in `localStorage`.
- logout and `401` handling clear only `lumimail-session-token`.
- login uses the shared session-token helper, while registration writes the token directly to `localStorage`.
- a hard refresh clears module and query memory, masking the defect.

## 3. Desired behavior

Every browser authentication boundary must synchronously clear all account-scoped client state before another identity can render:

- explicit logout;
- automatic `401` session invalidation;
- successful login;
- successful registration, including invitation registration.

The reset must clear:

- mailbox option cache and in-flight mailbox request reuse;
- message-list cache and in-flight message-list request reuse;
- message-count cache and in-flight message-count request reuse;
- all root TanStack Query data;
- selected mailbox React state;
- `selected-mailbox-id` from `localStorage`.

The session token remains the only browser authentication value and is written only after the old account state is reset.

## 4. Security invariants

- A promise started under account A must never populate a cache used by account B after reset.
- A stale account-A promise must not delete or replace a newer account-B in-flight request.
- No cache key may silently bridge an authentication reset.
- Clearing one cache listener must not prevent the remaining listeners from running.
- Browser-state cleanup is defense in depth; server authorization remains mandatory.

## 5. Edge cases and error states

- `localStorage` may be unavailable or throw; reset and authentication must continue.
- reset may occur while mailbox, message-list, count, or TanStack queries are in flight.
- reset may occur when no dashboard providers or cache modules are mounted.
- repeated reset calls are idempotent.
- an account can legitimately have access to the same mailbox ID as the prior account; cached data must still be discarded.
- a failed login/registration must not clear the current session because no new authenticated identity was established.
- `redirectOnUnauthorized: false` must not implicitly reset the session; explicit logout performs the reset after the logout request.

## 6. Implementation contract

- Add one browser account-state reset coordinator under `src/lib/auth/`.
- Cache modules register synchronous reset callbacks with that coordinator.
- The coordinator removes the selected-mailbox storage key and invokes every registered callback.
- Session-token set and clear operations invoke the coordinator.
- Registration uses the canonical session persistence helper rather than direct storage access.
- Mailbox and message request caches use generations and request identity checks so stale promises cannot repopulate or erase new-account entries.
- The root Query Client registers `queryClient.clear()` with the coordinator.
- Mounted mailbox providers clear visible mailbox and selection state immediately when reset fires.

## 7. Test plan

### Unit

- account-state reset removes selected mailbox storage and notifies/unsubscribes listeners;
- storage and listener failures do not stop reset;
- session-token set, clear, successful login persistence, and automatic `401` invoke reset;
- failed session persistence does not reset;
- registration delegates successful token persistence to the canonical helper;
- clearing during an in-flight mailbox request prevents stale cache repopulation;
- clearing during in-flight message/count requests prevents stale cache reuse or deletion of newer requests;
- Query Client registration clears data on reset and unsubscribes cleanly.

### Browser

- account A loads mailbox/message/query data;
- account A logs out through the UI;
- account B logs in without a hard refresh;
- account B sees only its mocked mailbox and message data;
- account-A mailbox names and message subjects are absent.

### Full verification

- `npm run verify`;
- `npm run e2e`;
- `npx opennextjs-cloudflare build`;
- production logout/login account-switch validation without hard refresh.

## 8. Decisions

- Decision 2026-07-23: treat stale account-scoped browser data as a security defect, not a cosmetic cache issue.
- Decision: clear the complete TanStack Query client at authentication boundaries because its current keys are not identity-scoped.
- Decision: use a central reset coordinator plus cache generations rather than adding the user ID to only selected keys; this closes existing and future identity transitions consistently.
- Decision: do not weaken or replace server-side mailbox authorization.

## 9. Bug / change log draft

### 2026-07-23 — Isolate browser caches across account switches

Type: Security / Correctness

Summary:

- Purge all account-scoped browser caches and selected-mailbox state on authentication changes, and prevent old in-flight requests from repopulating new-account caches.

Reason:

- Production account switching retained the previous account's mailbox selector until a hard refresh.

Impact:

- Logout/login and invited-account testing can safely occur in one browser session without displaying stale data from the prior account.

## 10. Implementation and verification log

### 2026-07-23 — Local implementation

- Added one account-state reset coordinator that clears selected-mailbox storage and broadcasts a browser-global reset event across separately loaded Next.js client chunks.
- Session-token set and clear operations now reset account-scoped state; successful login and registration share the canonical persistence path.
- Mailbox, message-list, and message-count caches register reset handlers.
- Cache generations prevent a request started before reset from repopulating a current-account cache.
- Request identity checks prevent a stale promise from deleting a newer request for the same key.
- The root TanStack Query client clears on account reset, and mounted mailbox providers immediately hide their mailbox list and selection.
- Added unit coverage for storage/listener failures, cross-chunk browser events, successful and failed auth transitions, registration persistence, stale in-flight requests, and Query Client reset registration.
- Added a browser flow that loads account-A mailbox/message data, logs out, logs in as account B without a hard refresh, and verifies only account-B data and selection remain.
- `npm run verify` passed with 130 test files, 1,074 tests, 100% statements, branches, functions, and lines, and 37 existing lint warnings with zero errors.
- `npx playwright test --workers=2` passed all 31 browser scenarios.
- `npx opennextjs-cloudflare build` completed and generated `.open-next/worker.js`.

Production deployment and a controlled no-hard-refresh account switch remain pending.
