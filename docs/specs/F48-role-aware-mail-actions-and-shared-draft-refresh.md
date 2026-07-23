# F48 — Role-Aware Mail Actions and Shared Draft Refresh

> Status: Shipped
> Remediation: follow-up to R-13
> Owner area: `src/lib/auth/mailbox-access.ts`, `src/app/api/messages*`, `src/components/compose/`, `src/components/message-actions/`, `src/components/messages/`, `src/components/dashboard-nav.tsx`

## 1. Problem and user job

Mailbox ACLs correctly reject unauthorized operations on the server, but the interface still presents actions a user cannot complete. A viewer can open Compose and receives an empty sender instead of being kept out of the send workflow. Draft authorization is also inconsistent: dedicated draft APIs require responder/manager access, while generic message reads can expose draft rows and bodies with viewer access.

Shared mailbox drafts are stored against the selected mailbox, but another user already viewing Drafts receives no indication that a draft was created or changed.

The user job is to see only actions their current mailbox role permits, keep work-in-progress drafts private from viewers, and see team draft changes within a short bounded interval without claiming real-time collaborative editing.

## 2. Current behavior

- Dashboard and admin layouts always render compose infrastructure.
- Dashboard navigation always shows Compose and Drafts.
- `/compose` renders for a viewer-only user; the send button is disabled because no valid `fromAddr` exists.
- Reply and Forward are shown on message details regardless of the message mailbox role.
- Dedicated `/api/drafts*` routes use the `send` mailbox capability.
- Generic message list/detail/search/count/thread/attachment routes use the `read` capability even when `messages.status = "draft"`.
- Compose debounces draft POST/PATCH by 900 ms and includes the selected `mailboxId`.
- Draft lists load on navigation and local `lumimail:messages-changed` events only; other browser sessions do not cause either event.

## 3. Desired behavior

### 3.1 Capability-aware interface

- `viewer` can read and perform the shared message-state actions defined by F47, but cannot see Compose, Reply, Forward, or Drafts navigation for a viewer-only account.
- `responder` and `manager` can compose, reply, forward, list, open, edit, and delete mailbox drafts.
- Compose is available if the user has at least one responder/manager mailbox.
- When Compose opens while a viewer mailbox is selected and another send-capable mailbox exists, the first send-capable mailbox becomes the sender.
- Reply and Forward are based on the role for the message's mailbox, not merely any send-capable mailbox.
- A viewer-only direct visit to `/compose` returns to `/inbox` after mailbox roles load and never renders an actionable compose form.
- Floating compose does not render for a user with no send-capable mailbox.
- Server authorization remains authoritative; hidden controls never replace API checks.

### 3.2 Draft privacy

- Any message whose status is `draft` requires `send` capability for its mailbox across every endpoint, including generic message list/detail/search/count/thread, labels/state mutations, attachments, and API-key reads.
- Null-mailbox drafts remain private to their creator.
- Viewers do not receive draft counts, metadata, snippets, bodies, or attachment metadata.
- Responders and managers assigned to the same mailbox share its stored drafts.

### 3.3 Lightweight refresh

- While a visible Drafts page is mounted, it refreshes its list every 10 seconds and bypasses the in-memory message cache.
- Background refresh does not replace the page with a loading state.
- Refresh pauses while the document is hidden and resumes on the next visible interval or focus/visibility event.
- Local draft saves continue to use the existing 900 ms debounce.
- Presence, cursor sharing, simultaneous editing, locks, versions, merge behavior, and conflict warnings remain out of scope.

## 4. Edge cases and error states

- Mailbox roles can change while a page is open; the next mailbox-list refresh/session navigation reflects the new UI, while APIs enforce the change immediately.
- A user with a viewer mailbox and a responder mailbox may compose only from the responder mailbox.
- A reply from a viewer mailbox is not offered even if the user can send from a different mailbox.
- A draft membership revoked between list and open returns indistinguishable `404`.
- A background draft refresh failure preserves the last successful list and retries on the next interval.
- An initial draft load failure keeps the existing empty/error behavior.
- Multiple responders may overwrite the same draft under the existing last-write-wins behavior; F48 does not imply safe concurrent editing.

## 5. Test plan

### Unit/integration

- client capability helpers identify any/first send-capable mailbox;
- read access SQL distinguishes ordinary messages from drafts and requires responder/manager membership for drafts;
- generic list/count/detail behavior uses the draft-aware predicate;
- null-mailbox drafts remain creator-private;
- background message refresh bypasses cache without toggling initial loading state;
- hidden-document intervals do not request drafts.

### Browser

- viewer-only user does not see Compose or Drafts navigation;
- direct `/compose` navigation returns the viewer to Inbox;
- viewer message detail omits Reply and Forward;
- responder sees Compose/Drafts and can enter Compose;
- admin navigation remains unchanged;
- draft list performs a bounded background refresh.

### Full verification

- `npm run verify`;
- `npm run e2e`;
- `npx opennextjs-cloudflare build`;
- production viewer/responder smoke test after deployment.

## 6. Decisions

- Approved 2026-07-23: unavailable mail actions should not be shown merely to produce an authorization failure.
- Approved 2026-07-23: draft privacy follows send capability everywhere; viewer draft visibility is not part of read access.
- Approved 2026-07-23: implement bounded refresh before considering real-time collaborative drafts.
- Decision: use a 10-second visible-page refresh interval to keep D1/request load bounded for the current small-user deployment.
- Decision: reply/forward permission follows the source message mailbox, preventing accidental replies from an unrelated mailbox.

## 7. Bug / change log draft

### 2026-07-23 — Align mail actions and drafts with mailbox capabilities

Type: Security / UX / Feature

Summary:

- Hide unavailable send/draft actions, guard compose entry, make draft privacy consistent across generic endpoints, and refresh shared draft lists on a bounded interval.

Reason:

- Server rejection without capability-aware UI is confusing, generic draft reads are broader than the approved contract, and shared drafts otherwise appear stale across users.

Impact:

- Viewers retain mailbox reading and shared-state operations without seeing work-in-progress drafts or send actions; responders/managers receive a clearer shared-draft workflow.

## 8. Implementation and verification log

### 2026-07-23 — Local implementation

- Added shared mailbox capability helpers and used them to hide Compose/Drafts navigation, suppress floating compose, select a send-capable sender, and guard direct `/compose` navigation.
- Reply and Forward now render only when the user has responder/manager access to the source message's mailbox.
- The shared message authorization predicate now treats draft reads as send-capability operations, covering generic browser/API-key list, detail, search, count, thread, attachment, and mutation paths while preserving creator-private null-mailbox drafts.
- Visible Drafts pages bypass the message cache every 10 seconds and on focus/visibility restoration without replacing the current list with a loading state.
- Focused unit tests passed: 32/32.
- `npm run verify` passed with 126 test files, 1,056 tests, and 100% statements, branches, functions, and lines; lint reported 40 warnings and zero errors (one fewer warning than the prior baseline).
- `npx playwright test --workers=2` passed all 28 browser scenarios.
- `npx opennextjs-cloudflare build` completed and generated `.open-next/worker.js`.
- The browser run continues to log the pre-existing localization defects tracked by R-14.

### 2026-07-23 — Production deployment

- Deployed Worker version `7655ecdf-3317-47e8-8d40-4a305ca63ace` to `mail.henriksen.dev`.
- Live smoke checks returned `200` for `/` and JSON `401` for unauthenticated `/api/mailboxes` and `/api/messages?status=draft`.
- No D1 migration was required for F48.

### 2026-07-23 — Controlled viewer/responder production validation

- Changing the assigned mailbox role to `viewer` immediately removed Compose and Drafts navigation.
- Direct `/compose` navigation redirected to Inbox, and the Drafts view exposed no shared draft rows to the viewer.
- Reassigning the same mailbox as `responder` restored Compose and Drafts in the same account.
- With the responder Drafts page left open, another user created a shared draft. The untouched page changed from 2 rows to 3 and displayed the new `F40 AUTO REFRESH CHECK` draft during the monitoring window.

The controlled viewer/responder and bounded shared-draft refresh production gates are complete.
