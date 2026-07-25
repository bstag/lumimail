# F64 — Vacation Responder Loop and Frequency Controls

> Status: In Progress — implemented and locally verified; not yet deployed
> Owner area: `src/lib/email/vacation.ts`, `src/lib/email/inbound.ts`, `src/lib/email/send.ts`

## 1. Problem & User Job

The vacation responder replies to essentially every inbound message. Its only
suppression is a substring test for `noreply` or `no-reply` in the sender address
(`inbound.ts`). That leaves several ways to aim mail at an uninvolved third party:

- **Mutual auto-reply storm.** Lumimail's auto-reply carries no marker identifying it
  as automated. If two responders are enabled — two Lumimail users, or a Lumimail user
  and any other autoresponder — each reply provokes another, without bound.
- **Bounces.** A delivery failure arrives with a null envelope sender. Replying to it
  generates another bounce, and the pair can ricochet.
- **Mailing lists.** A list message produces a reply to the list itself, which may
  redistribute it to every subscriber.
- **Unbounded frequency.** A correspondent who sends ten messages receives ten
  identical out-of-office replies.

An operator needs the responder to answer real correspondents once per period, and to
stay silent toward automated systems.

## 2. User Stories & Acceptance Criteria

- As a correspondent, I receive at most one out-of-office reply per configured window no matter how many messages I send.
- Given a message carrying `Auto-Submitted` other than `no`, when it is processed, then no reply is sent.
- Given `Precedence: bulk`, `list`, or `junk`, or any `List-Id`/`List-Unsubscribe` header, then no reply is sent.
- Given a null or empty envelope sender, then no reply is sent, because the message is a bounce.
- Given a message from an address that is itself automated (`mailer-daemon`, `postmaster`, `bounce`, `noreply`), then no reply is sent.
- Given a message Lumimail itself auto-replied with, then no reply is sent, because our replies now identify themselves.
- Given two Lumimail mailboxes both with responders enabled, when one writes to the other, then exactly one reply is produced and the exchange terminates.
- As a recipient of an out-of-office reply, the message identifies itself as automatic so my own systems can suppress a response.
- As a responder owner, I can restrict replies to people in my contacts, to senders on a domain in my organization, or to either.
- Given neither restriction is enabled, then everyone receives a reply, which is the existing behavior.
- Given both restrictions are enabled, then a sender matching either one receives a reply.

## 3. Scope Boundaries

**In scope:**

- Header- and sender-based suppression evaluated before any send.
- A per-sender, per-user reply log enforcing the frequency window.
- Marking outgoing auto-replies as automatic (`Auto-Submitted: auto-replied`).
- Optional audience restrictions: known contacts, organization domains, or either.
- Extending `SendEmailInput` so an auto-reply can be marked, since it currently has no way to carry that.

**Out of scope:**

- Changing who may enable a responder, or its subject/body content.
- Per-organization or per-mailbox frequency configuration. The window is a documented constant; making it configurable is a separate decision.
- Per-audience reply text. One body is sent regardless of which audience matched.
- Pruning the reply log. Rows are small and bounded by distinct correspondents; retention can join R-11's sweep later if it grows.
- Detecting loops by message content or subject heuristics. Header-based detection is the RFC-sanctioned mechanism and content matching is unreliable.

## 4. Data Model

New table `vacation_reply_log`:

| Column | Type | Null | Purpose |
|--------|------|------|---------|
| `id` | text pk | no | `vrl_` prefixed id |
| `user_id` | text fk → `users` cascade | no | Responder owner |
| `sender_address` | text | no | Normalized lowercase correspondent |
| `last_replied_at` | integer timestamp | no | When the last reply was sent |

Unique index on (`user_id`, `sender_address`). The row is upserted on send, so the
table holds one row per correspondent rather than one per message.

`vacation_responders` gains two boolean columns in migration `0021`:

| Column | Default | Meaning |
|--------|---------|---------|
| `reply_to_contacts` | `false` | Reply to senders present in the owner's contacts |
| `reply_to_organization` | `false` | Reply to senders on any domain in the owner's organization |

Both default to `false`, which preserves the existing reply-to-everyone behavior for
rows that already exist. The flags are independent and combine as **OR**, so
"contacts plus colleagues" is expressible; requiring both would make the pair
strictly less useful than either alone.

## 5. API Contract

`PUT /api/vacation` accepts optional `replyToContacts` and `replyToOrganization`
booleans, defaulting to `false` when absent. `GET` returns them on the responder.

`SendEmailInput` gains an optional `autoReply` flag rather than arbitrary headers; see
§12 for why the headers themselves are not carried through the stored payload.

## 6. UI/UX

The `/settings` responder gains a **Who receives a reply** group with two checkboxes,
shown only when the responder is enabled. Below them a line states the effective
audience — everyone when neither is ticked, otherwise that only matching senders
receive a reply — so the combined meaning is visible without reading documentation.

The suppression rules and frequency window have no interface; they are delivery
behavior. The documented window belongs in the responder's help text, left for a copy
pass rather than guessed at here.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/email/vacation.test.ts` | Each suppression rule independently; a normal sender is not suppressed; header matching is case-insensitive. |
| Unit | `tests/unit/lib/email/vacation.test.ts` | Frequency: first reply sends and logs, a second within the window is suppressed, one after the window sends again. |
| Unit | `tests/unit/lib/email/vacation.test.ts` | Audience: unrestricted replies to everyone without querying; contacts and organization each allow and refuse; both combine as OR; a personal account cannot satisfy the organization audience. |
| Unit | `tests/unit/lib/email/inbound.test.ts` | The responder receives inbound headers, and the outgoing reply carries `Auto-Submitted: auto-replied`. |
| Unit | `tests/unit/db/migrations.test.ts` | Migrations `0020` and `0021` on fresh and upgraded databases. |

E2E is not added: the behavior is invisible in the browser and is exercised through the
inbound queue path, which browser tests cannot drive.

## 8. Current Behavior

`maybeVacationRespond` checks `enabled`, the start/end window, and a `noreply` substring,
then sends. It receives no headers, so no RFC 3834 signal is available to it, and it
records nothing, so it has no memory of previous replies. Its own output carries no
`Auto-Submitted`, so neither Lumimail nor any other system can recognize the reply as
automatic.

## 9. Error States

| Condition | Result | Logged? |
|-----------|--------|---------|
| Suppressed by a rule | No reply; inbound processing continues | No |
| Within the frequency window | No reply; log untouched | No |
| Send fails | Remains best-effort; inbound delivery still succeeds | No |
| Log write fails after a successful send | Reply was delivered; the next message may reply again. Preferred over failing inbound delivery. | Yes |

## 10. Edge Cases

- Header comparison is case-insensitive on both name and value; `AUTO-SUBMITTED: Auto-Replied` must suppress.
- `Auto-Submitted: no` explicitly means "not automatic" and must **not** suppress.
- An empty or `<>` envelope sender is a bounce and is never replied to.
- A sender who is also the recipient must not trigger a self-reply.
- The frequency window is per responder owner and correspondent, so two users on holiday each reply once to the same person.
- A correspondent writing from a different address is a different row, by design.

## 11. Permissions & Security

- No authorization change; the responder still belongs to one user.
- Suppression decisions read headers already stored on the inbound queue payload and add no new data collection.
- The reply log stores correspondent addresses, which the contacts table already holds, so it introduces no new class of personal data.

## 12. Open Questions / Decisions

- Decision: one reply per correspondent per **4 days**, matching the interval used by major providers. Long enough to stop a storm, short enough that a genuine ongoing exchange is re-informed. — 2026-07-25
- Decision: mark our replies `Auto-Submitted: auto-replied` per RFC 3834. This is what makes mutual-responder termination work, and it is also the courtesy that lets other systems suppress. — 2026-07-25
- Decision: suppress on any `List-*` header rather than only `List-Id`, since a reply to a list can reach every subscriber and the cost of a false suppression is one missed out-of-office notice. — 2026-07-25
- Decision: a failed log write does not fail inbound delivery. Duplicate out-of-office replies are a nuisance; losing an inbound message is data loss. — 2026-07-25
- Decision: the audience restrictions are independent booleans combining as OR rather than one exclusive choice, so "contacts plus colleagues" is expressible without a fourth enum value. — 2026-07-25
- Decision: "organization" means any domain belonging to the owner's organization, not only the receiving mailbox's domain. On a multi-domain account a colleague on a second domain is a colleague, and the alternative would treat them as an outsider. — 2026-07-25
- Decision: audience is evaluated after the safety suppression rules and before the frequency window, so a suppressed sender never consumes a window slot. — 2026-07-25

## 13. Bug / Change Log

### 2026-07-25 — Stop the responder from answering machines and repeating itself

Type: Bug Fix

Summary:

- Add `src/lib/email/vacation.ts` with six suppression rules, a self-reply check, and a 4-day per-correspondent window.
- Add `vacation_reply_log` and migration `0020`.
- Pass inbound headers to the responder, which previously received none.
- Mark outgoing auto-replies `Auto-Submitted: auto-replied` and `X-Auto-Response-Suppress: All`.

Reason:

- The only suppression was a substring test for `noreply` in the sender. Two enabled responders would answer each other without bound, bounces and mailing lists were replied to, and a repeat correspondent received one reply per message. Tracked as R-27.

Impact:

- Two enabled responders now terminate after one exchange, because our own marker is recognised by our own rules — there is a test asserting exactly that.
- A correspondent receives at most one notice per 4 days.
- Bounces, bulk mail, and list traffic are never answered.

Tests:

- 16 suppression and window cases in `vacation.test.ts`, plus inbound cases for header suppression, window suppression, log recording, and a failed log write not failing delivery.
- Five `send.test.ts` cases covering the flag on the snapshot, header merging with threading headers, no headers for ordinary mail, and rejection of a non-boolean flag in a stored payload.

Notes:

- The stored payload carries a boolean, not headers. `isThreadingHeaders` exists to stop header injection from a snapshot, so widening it would have weakened that guard; the consumer applies a constant from code instead.
- The provider `headers` type widened from the two threading headers to `Record<string, string>`, documented as caller-controlled values only.
- The log is written only after a successful send, so a failed reply does not consume the window. A failed log write is warned and swallowed, because losing an inbound message would be worse than a duplicate notice.
- The timestamp-coverage guard added this morning caught `vacation_reply_log.last_replied_at` immediately. The normalization statement went into `0020` rather than `0019`, because `0019` is already applied and editing an applied migration is the exact defect the staged-upgrade contract detects. The guard now scans the whole migration set.
