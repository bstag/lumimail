# F76 — All-Mailboxes Scope

> Status: Shipped (local)
> Owner area: `src/components/mailbox-provider.tsx`, `src/components/mailbox-selector.tsx`, `src/lib/auth/account-state.ts`, `src/components/message-actions/`

## 1. Problem & User Job

A user with access to several mailboxes (their own plus shared ones such as
`support@`) currently has to switch mailboxes to find out whether anything needs
attention, and cannot see one chronological stream across all of them.

The data layer already supports this and the UI does not expose it:
`GET /api/messages` treats `mailboxId` as **optional** and falls back to
`messageAccessCondition(db, user.id, user.organizationId, "read")` — every mailbox
the caller may read. `getMessageQueryParams` already omits the parameter when the
id is null. `GET /api/messages/counts` is already called with `null` by the mailbox
dropdown. What is missing is a way for the user to *choose* that state, and a
correct reply identity once they are in it.

## 2. User Stories & Acceptance Criteria

- As a user with more than one mailbox, I can select "All mailboxes" and see every
  folder across every mailbox I can read.
  - Given I select All mailboxes, When I open Inbox, Then the list contains mail
    from every accessible mailbox, newest first.
  - The choice persists across reload and across navigation.
  - Given I have exactly one mailbox, Then the option is hidden — it would be a
    no-op entry.
- As a user in All-mailboxes scope, replying sends from the mailbox that received
  the message, not from my primary mailbox.
  - Given a message received at `support@`, When I reply, Then the compose form is
    seeded with `support@` as the sending mailbox.
  - Given a message whose `mailboxId` is null (an orphaned row), When I reply, Then
    the primary mailbox is used and the From field is explicit about it.
- As a user in All-mailboxes scope, composing a new message (no message context)
  sends from my primary mailbox.
- As a restricted member, All mailboxes shows exactly the mailboxes I have
  membership in — never the organization's other mailboxes.

## 3. Scope Boundaries

**In scope:** an "All mailboxes" entry in the mailbox selector, a persisted scope
sentinel distinct from "nothing selected yet", aggregate folder counts, reply
identity derived from `message.mailboxId`, a per-row mailbox indicator in list rows
while the scope is active.

**Out of scope:**

- A From picker in the composer. Reply derives its identity; it does not offer a
  choice. (Considered and declined 2026-07-31 — see §12.)
- Selecting an arbitrary *subset* of mailboxes. The scope is one mailbox or all.
- Per-mailbox unread badges in the sidebar folder list. The mailbox dropdown
  already shows per-mailbox unread.
- Making All mailboxes the default for new users. Primary stays the default.
- Cross-*organization* aggregation. `messageAccessCondition` is the boundary and
  does not change.

## 4. Data Model

No schema change. No migration.

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | read-only: `mailboxId` | Already selected; used for the row indicator and reply identity |
| `mailbox_memberships` | read-only | Already the basis of `messageAccessCondition` |

Client persistence: a **separate** key,
`ALL_MAILBOXES_SCOPE_STORAGE_KEY` (`"mailbox-scope-all"`), alongside the existing
`SELECTED_MAILBOX_STORAGE_KEY`. Both are cleared by
`resetAccountScopedClientState`.

**The scope is separate state from the active mailbox** — this is the central
design decision and it changed during implementation. The draft assumed a
reserved `"all"` value inside the existing selection. That is wrong for a second
reason beyond the null-overloading one:

> `ComposeForm` sets the active mailbox as a side effect — when it loads a draft
> (`loadedDraftMailboxId`) and when the active mailbox cannot send. If the scope
> and the active mailbox were the same value, opening the composer would silently
> drop the user out of All mailboxes.

So `selectedMailbox` keeps meaning "the identity I send as" and is always a real
mailbox once resolved; `allMailboxes` is a separate boolean that only decides
whether message *lists* are filtered. `scopedMailboxId` on the context is the
derived value list queries use. The composer needed no changes to its existing
selection behavior.

## 5. API Contract

No API change. The relevant existing behavior, which this feature depends on and
must not regress:

| Method | Route | Behavior relied upon |
|--------|-------|----------------------|
| GET | `/api/messages` | `mailboxId` omitted ⇒ every readable mailbox, via `messageAccessCondition` |
| GET | `/api/messages/counts` | `mailboxId` omitted ⇒ aggregate folder counts + per-mailbox breakdown |

Both are already covered by cross-tenant denial tests; this feature adds a test
asserting that the unscoped list for user A never contains user B's rows.

## 6. UI/UX

- **Selector** (`mailbox-selector.tsx`): "All mailboxes" as the first entry above
  the individual mailboxes, with a check mark when active and the summed unread
  count from `counts.mailboxes`. Hidden when `mailboxes.length < 2`.
- **Header**: the selector button already falls back to "All mailboxes" /
  "All domains" when `selectedMailbox` is null — that display becomes a real state
  instead of a transient pre-selection artifact.
- **List rows**: while the scope is active, each row shows which mailbox it belongs
  to. Placed after the subject/preview so it does not compete with the sender.
  Suppressed when a single mailbox is selected, where it would be noise on every row.
- **Reply/forward**: `MessageActions` resolves the message's mailbox through
  `resolveReplyMailboxId` and passes it to the composer as a `fromMailboxId`
  query parameter. `ComposeForm` honours it before its send-capability fallback,
  and only when that mailbox can actually send — otherwise it would seed an
  identity the server will refuse.
- **Compose**: unchanged. With no `fromMailboxId` it uses the active mailbox, and
  its existing fallback picks a send-capable one.
- **Empty state**: "No emails" as today; the scope does not change folder copy.
- **Mobile**: the selector is already in the header on mobile; no new surface.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/components/mailbox-scope-utils.test.ts` | `readStoredScope` / `writeStoredScope` round-trip; `"all"` survives a mailbox-list refresh; an unknown stored id falls back to primary, not to all |
| Unit | `tests/unit/components/mailbox-scope-utils.test.ts` | `resolveReplyMailbox(message, mailboxes, primary)`: message's mailbox wins; null `mailboxId` falls back to primary; a mailbox the user lost access to falls back to primary |
| Unit | `tests/unit/hooks/utils.test.ts` | `getMessageQueryParams` omits `mailboxId` for the all scope (already true; pinned so it cannot regress) |
| Integration | `tests/unit/app/api/messages/route.test.ts` | the unscoped request still compiles the membership access predicate, and carries no `mailbox_id = ?` narrowing; the scoped request adds that narrowing *on top of* the predicate |
| E2E | `tests/e2e/all-mailboxes-scope.spec.ts` | select All mailboxes → list spans mailboxes; per-row mailbox label appears only in scope; choice survives reload; single-mailbox user never sees the option; reply seeds `fromMailboxId` from the receiving mailbox |

**Limit of the integration test.** The unit-test database mock ignores SQL
semantics, so it cannot prove row-level isolation — it can only prove the
predicate is still *there*. That is a real regression guard (someone
"optimizing" the unscoped path by dropping the condition fails this test) but it
is not proof of isolation. Row-level proof requires the local suite against a
real database; see §15.

Coverage target: 100% on new/changed gated files. The new logic is deliberately
placed in `mailbox-scope-utils.ts` (a `*-utils.ts` name) so it falls inside the
coverage gate rather than hiding in a `.tsx` component.

## 8. Current Behavior

- `MailboxProvider` holds `selectedMailbox: MailboxOption | null`.
- `null` currently means **"not chosen yet"**, not "all": an effect
  (`mailbox-provider.tsx`) runs whenever the mailbox list resolves and replaces a
  null selection with the stored id, else the primary, else the first mailbox. A
  null selection therefore cannot survive a mailbox-list refetch — this is the
  central obstacle, and the reason a distinct sentinel is required rather than
  simply "setting it to null".
- `setSelectedMailbox(null)` already removes the stored key, so persistence exists
  in one direction only.
- `MailboxSelector` renders one entry per mailbox and has no "all" entry. Its
  header text already falls back to "All mailboxes" when the selection is null,
  which today is only visible for a moment during load.
- `useMessageCounts(null)` already fetches unscoped counts — the dropdown uses it.
- `MessageActions.replyTo` derives the recipient from the message but the sending
  identity comes from the globally selected mailbox downstream in compose.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| Stored scope names a deleted mailbox | falls back to primary silently | — | No |
| Reply from a message whose mailbox access was revoked | falls back to primary; send is authorized server-side regardless | 403 from `/api/send` if truly unauthorized | Existing |
| Counts request fails in all scope | existing empty-counts fallback | — | Existing |
| Only one mailbox accessible | option hidden | — | No |

## 10. Edge Cases

- **Stored `"all"` but the user drops to one mailbox** — the option disappears and
  the scope resolves to that mailbox. The stale sentinel must not strand the user
  on an option that is no longer offered.
- **Account switch** — `registerAccountStateReset` already clears the selection on
  F50 account switch; the sentinel must clear with it, or user B inherits user A's
  scope.
- **Message with `mailboxId: null`** — reply falls back to primary.
- **Reply to a message in a mailbox the user can read but not send from** — the
  viewer-capability rule (F48) already hides Reply; unchanged.
- **Large aggregate list** — same 25-row pagination; the query is a single indexed
  read either way (`messages_user_created_idx` covers the unscoped ordering).
- **Concurrent mailbox revocation** — the next list refetch drops the rows;
  `messageAccessCondition` is evaluated per request, not cached.
- **Mobile viewport** — selector only.

## 11. Permissions & Security

- **This feature must not widen access by one row.** The unscoped query is not
  "no filter" — it is `messageAccessCondition(db, user.id, user.organizationId,
  "read")`, the same predicate every scoped query already applies on top of a
  mailbox filter. Removing the mailbox filter removes a *narrowing* condition, not
  the authorization condition.
- The cross-tenant test for the unscoped path is mandatory and is listed in §7. It
  is the single highest-risk item in this feature: a mistake here exposes another
  tenant's mail rather than merely showing a wrong folder.
- Restricted members see exactly their `mailbox_memberships`.
- No secrets involved. Not separately audited.

## 12. Open Questions / Decisions

- **Reply identity in all scope?** → Derive from `message.mailboxId`, falling back
  to primary. Decided 2026-07-31. "Always primary" was rejected because replying to
  mail addressed to a shared mailbox would go out under the individual's own
  address — a wrong-sender leak on exactly the shared-mailbox setup this feature
  targets. A From picker was rejected as a larger change to the composer than the
  scope work itself; it stays available as a later addition.
- **Reuse `null` as the all sentinel?** → No, and the reason is stronger than the
  draft recorded. `null` already means "not yet resolved" and is overwritten by
  the provider's effect on every mailbox-list load. Worse, `ComposeForm` sets the
  active mailbox as a side effect, so a scope stored *in the selection* would be
  destroyed by opening the composer. Resolved 2026-07-31 by making the scope a
  separate boolean with its own storage key; see §4.
- **Show a mailbox indicator per row?** → Yes, but only while the scope is active.
- **Default new users to all?** → No. Primary stays the default.

## 13. Bug / Change Log

### 2026-07-31 — All-mailboxes scope

Type: Feature

Summary:
- `MailboxProvider` gains `allMailboxes` / `setAllMailboxes` / `scopedMailboxId`,
  persisted under its own storage key and cleared on account switch.
- `mailbox-scope-utils.ts` holds the pure logic: `resolveScopedMailboxId`,
  `isAllScopeAvailable`, `readStoredAllScope`, `resolveReplyMailboxId`.
- Mailbox selector gains an "All mailboxes" entry with the summed unread count,
  hidden for single-mailbox users.
- List rows show their mailbox while the scope is active.
- Reply/forward pass `fromMailboxId`; the composer honours it when that mailbox
  can send.

Reason:
- `/api/messages` has treated `mailboxId` as optional since it was written,
  falling back to `messageAccessCondition`. Only the client control and the reply
  identity were missing.

Impact:
- Additive and opt-in. Users who never select the option see no change. No API or
  schema change.

Tests:
- See §7.

Notes:
- Composes with F75: a label view under All mailboxes is the cross-mailbox filing
  destination. Neither feature blocks the other.
- Nav folder counts follow `scopedMailboxId`, so a badge always counts what the
  folder will actually show.

## 14. Not verified

- **Row-level cross-tenant isolation for the unscoped path has not been executed
  against a real database in this environment.** `npm run e2e:local` fails at
  sign-in with a 503 from the rate-limit store (local Wrangler bindings are not
  configured); confirmed pre-existing, unrelated to these changes. The static
  guard in §7 and the pre-existing `messageAccessCondition` tests both pass, and
  the predicate is unchanged from the already-audited scoped path — but this is
  the one item in this feature where a mistake exposes another tenant's mail, so
  it should be exercised against a real database before deploying.
- The per-row mailbox label and the scope control have not been checked on a
  narrow mobile viewport.
