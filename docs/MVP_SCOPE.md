# Lumimail — Feature Registry

Lumimail is a self-hosted multi-tenant Google Workspace email replacement.
An org admin provisions domains, creates mailboxes, invites team members, and each
member gets their own inbox with full webmail + email client (IMAP/SMTP) support.

Status values: `Shipped`, `In Progress`, `Planned`, `Out of scope`.

## Feature Matrix

| ID | Feature | Status | Spec | Routes (UI) | Routes (API) | Docs |
|----|---------|--------|------|-------------|---------------|------|
| F01 | Auth (register, login, session, invite accept, password reset) | Shipped | [F01](specs/F01-auth.md) | `/login`, `/register` | `/api/auth/*` | — |
| F02 | Domain management (org-scoped, Cloudflare DNS) | Shipped | [F02](specs/F02-domains.md) | `/domains` | `/api/domains*`, `/api/setup/*` | — |
| F03 | Mailboxes (org-scoped, multi-user) | Shipped | [F03](specs/F03-mailboxes.md) | `/mailboxes`, `/mailboxes/[id]` | `/api/mailboxes*` | — |
| F04 | Mail folders (inbox/sent/drafts/spam/trash/starred) | Shipped | [F04](specs/F04-mail-folders.md) | `/{inbox,sent,drafts,spam,trash,starred}` | `/api/messages*` | — |
| F05 | Compose, send, drafts (WYSIWYG + attachments) | Shipped | [F05](specs/F05-compose-send.md) | `/compose`, `/drafts*` | `/api/send`, `/api/drafts*`, `/api/v1/send` | [attachments](implementation/attachments.md) |
| F06 | API keys | Shipped | [F06](specs/F06-api-keys.md) | `/api-keys` | `/api/api-keys`, `/api/v1/send` | — |
| F07 | Routing rules | Shipped | — | `/routing` | `/api/routing-rules*` | — |
| F08 | Webhooks | Shipped | — | `/webhooks` | `/api/webhooks*` | — |
| F09 | Settings & profile | Shipped | [F09](specs/F09-settings.md) | `/settings` | `/api/settings/profile` | — |
| F10 | Seed/demo data | Shipped (dev) | — | — | `/api/seed` | — |
| F11 | Email agent (AI triage, smart inbox) | Out of scope | — | — | — | — |
| F12 | Multi-user workspace (orgs, invites, roles) | Shipped | [F12](specs/F12-multi-user-workspace.md) | `/members`, `/register?token=` | `/api/org/members*` | — |
| F13 | IMAP/SMTP bridge (email client support) | Shipped | [F13](specs/F13-imap-smtp-bridge.md) | — | — | [imap-bridge/README](../imap-bridge/README.md) |
| F14 | Starred messages | Shipped | — | `/starred` | `/api/messages/[id]/starred` | [starred](implementation/starred-messages.md) |
| F15 | Labels | Shipped | — | `/labels` | `/api/labels*`, `/api/messages/[id]/labels` | [labels](implementation/labels.md) |
| F16 | Email aliases (org-scoped) | Shipped | — | `/aliases` | `/api/aliases*` | [aliases](implementation/aliases.md) |
| F17 | Attachments (R2 upload/download) | Shipped | — | — | `/api/attachments*`, `/api/messages/[id]/attachments` | [attachments](implementation/attachments.md) |
| F18 | Thread view (conversation grouping) | Shipped | — | `/inbox/[id]` | `/api/messages/thread/[threadId]` | — |
| F19 | Message search | Shipped | — | — | `/api/messages?q=` | — |
| F20 | Contacts (auto-captured) | Shipped | — | — | via inbound/outbound hooks | — |
| F21 | Password reset | Shipped | — | `/forgot-password`, `/reset-password` | `/api/auth/forgot-password`, `/api/auth/reset-password` | — |
| F22 | Contacts UI | Shipped | — | `/contacts` | `/api/contacts` | [filters-vacation-contacts](implementation/filters-vacation-contacts.md) |
| F23 | Label filter in inbox | Shipped | — | message list label chips | `/api/messages?labelId=` | [labels](implementation/labels.md) |
| F24 | Email filters/rules | Shipped | — | `/filters` | `/api/filters*` | [filters-vacation-contacts](implementation/filters-vacation-contacts.md) |
| F25 | Vacation responder | Shipped | — | `/settings` | `/api/vacation` | [filters-vacation-contacts](implementation/filters-vacation-contacts.md) |
| F26 | Reply / Forward | Shipped | — | `/inbox/[id]`, `/compose` | `/api/messages/[id]` | [reply-forward](implementation/reply-forward.md) |
| F27 | Inline attachment list | Shipped | — | `/inbox/[id]` | `/api/messages/[id]/attachments` | [attachments](implementation/attachments.md) |
| F28 | Password change | Shipped | — | `/settings` | `/api/auth/change-password` | [filters-vacation-contacts](implementation/filters-vacation-contacts.md) |
| F29 | Bulk actions + pagination | Shipped | — | message list toolbar | `/api/messages/bulk` | — |
| F30 | Group aliases (fan-out delivery) | Shipped | — | `/aliases` | inbound routing | [group-aliases](implementation/group-aliases.md) |
| F31 | Inline image/PDF preview | Shipped | — | `/inbox/[id]` | `/api/attachments/[id]?disposition=inline` | [attachments](implementation/attachments.md) |
| F32 | Mobile-responsive UI | Shipped | — | dashboard + admin layouts | — | — |
| F33 | Pluggable outbound mail providers (Cloudflare, Resend) | Shipped | [F33](specs/F33-outbound-mail-providers.md) | — | `/api/send`, `/api/v1/send` (via `MAIL_PROVIDER`) | — |
| F34 | Workers-compatible HTML sanitization (dompurify + linkedom) | Shipped | [F34](specs/F34-workers-html-sanitization.md) | `/inbox/[id]` | inbound parsing | — |

## What "Google Workspace email replacement" means

- Org admin provisions **domains** and **mailboxes** on those domains.
- Admin **invites team members**. Each gets login + inbox.
- Each user sees only **their own mail** (cross-tenant isolation enforced).
- Admin manages members, domains, aliases, routing rules, webhooks.
- **Email clients** (Thunderbird, Apple Mail, Outlook) connect via the IMAP/SMTP bridge.
- Self-hosted on Cloudflare Workers + D1. Flat operating cost.

## Gmail / Workspace parity status

All core trivial-webmail and email-client features are shipped: compose/send,
reply/forward, threads, search, labels, starred, filters/rules, vacation
responder, contacts, attachments (upload + inline preview), bulk actions,
pagination, group aliases with fan-out delivery, multi-user orgs with
cross-tenant isolation, IMAP/SMTP bridge for desktop/mobile clients, and a
mobile-responsive UI.

### Post-parity enhancements (optional, not blocking)

| Feature | Notes |
|---------|-------|
| Rich-text (HTML) compose | Compose is plain-text; a WYSIWYG editor would match Gmail formatting |
| Server-side push (IMAP IDLE) | Bridge polls; IDLE would give instant client updates |
| Snooze / scheduled send | Gmail conveniences beyond core mail |

## Adding a feature

1. Add a row here with status `Planned` and a spec link (create from `docs/specs/TEMPLATE.md`).
2. Follow `docs/ENGINEERING.md` (spec → tests → implementation → verification → spec update).
3. Flip status to `Shipped` only once tests pass and `npm run verify` is green.

## Conventions

- **Stack:** Next.js 16 (App Router) on Cloudflare Workers via OpenNext, Drizzle ORM + D1, Tailwind v4, shadcn/Radix UI, TanStack Query, Zod.
- **Auth:** session cookie (`src/lib/auth/`), per-request DB via `getDb(env)`.
- **Validation:** all request bodies validated with Zod schemas in `src/lib/validators.ts`.
- **IDs:** `newId(prefix)` from `src/lib/ids.ts` (nanoid-based, prefixed).
- **Cross-tenant isolation:** every query that reads/writes mailbox, message, domain, or routing data must filter by user/org. New endpoints need cross-tenant denial tests.
