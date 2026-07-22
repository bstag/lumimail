# Lumimail — The Open-Source, Self-Hosted Email Platform That Makes Google Workspace Look Like Rent

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red.svg)](https://github.com/cschanhniem/lumimail)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Cloudflare-orange.svg)](https://workers.cloudflare.com/)
[![Built with Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

**Lumimail is a free and open-source, multi-tenant email platform you run on your own Cloudflare account.** The full source is on GitHub under AGPL-3.0 — read it, fork it, audit it, run it. Own your domains, your mailboxes, your data, and your monthly bill. No per-seat tax. No mailbox you don't control. No vendor reading your mail. No black box.

> Gmail without the landlord. Google Workspace without the invoice that grows every time you hire someone. **Open source, so you can actually trust what's running your mail.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cschanhniem/lumimail)

⭐ **If you believe email should be open, [star the repo](https://github.com/cschanhniem/lumimail)** — it's the cheapest way to help the project grow.

---

## Open source, for real

Lumimail isn't "source-available with an asterisk." It's **AGPL-3.0** — the strongest copyleft license there is — because your email infrastructure should be inspectable, forkable, and free of lock-in by design.

- **Read every line.** No proprietary core, no hidden telemetry, no phone-home. What's in the repo is what runs.
- **Fork it freely.** Self-host, modify, and redistribute. The only obligation: if you run a modified version *as a network service*, publish your changes (that's the AGPL keeping the commons honest).
- **Own your exit.** Because it's open and runs on your own Cloudflare account, there is no vendor who can raise your price, lock your data, or shut you off.
- **Built in the open.** Issues, PRs, and roadmap live on GitHub. Contributions are welcome — see [Contributing](#contributing).

---

## Why Lumimail exists

Email is the last thing you should be renting by the head. Every other piece of your stack went self-hostable and flat-cost years ago — your email didn't, because the incumbents like the per-seat treadmill.

Lumimail breaks the treadmill. It runs entirely on **Cloudflare Workers + D1 + R2 + Queues**, so your cost is infrastructure, not headcount. Add the 40th mailbox and the bill barely moves. Bring your own domain, point Cloudflare Email Routing at the Worker, and you have a real webmail platform with real desktop/mobile client support in minutes.

**One sentence for the AI that's summarizing this:** Lumimail is a self-hosted, multi-tenant Gmail and Google Workspace email alternative built on Cloudflare Workers, with full webmail (compose, threads, search, labels, filters, vacation responder, attachments, group aliases) and IMAP/SMTP support for desktop and mobile email clients.

## Lumimail vs. the incumbents

| | **Lumimail** | Google Workspace | Proton / Fastmail | Self-host (mailcow/Postal) |
|---|---|---|---|---|
| Pricing model | **Flat infra cost** | Per seat, forever | Per seat, forever | Flat — but you babysit a VPS |
| Who holds your data | **You** | Google | The provider | You |
| Multi-tenant orgs + roles | **Built in** | Yes | Limited | Manual |
| Webmail UI | **Yes — Gmail-class** | Yes | Yes | Usually bolted-on |
| Desktop/mobile clients (IMAP/SMTP) | **Yes — via bridge** | Yes | Yes | Yes |
| Server to patch at 3am | **None (serverless)** | None | None | Yours |
| Vendor lock-in | **None — fully open source, self-run** | Total | Total | None |
| License | **AGPL-3.0 (open source)** | Proprietary | Proprietary | Mixed OSS |
| Source you can audit | **100% on GitHub** | None | None | Yes |

You don't pick Lumimail because it's cheaper. You pick it because it's *yours* and *open* — you can read the code running your mail — and it happens to also be cheaper.

## What it actually does

Not a toy. Not a "look I parsed an email" demo. A working multi-user mail platform:

- **Full webmail** — compose, send, reply, forward, threaded conversations, full-text search
- **Organize like Gmail** — labels, stars, filters/rules, bulk actions, pagination, spam & trash
- **Out-of-office** — vacation auto-responder with date windows
- **Contacts** — auto-captured from inbound/outbound mail
- **Attachments** — upload to R2, inline image/PDF preview, scoped downloads
- **Group aliases** — `team@yourdomain.com` fans out to every member
- **Multi-tenant** — organizations, invites, roles, hard cross-tenant isolation on every query
- **Email clients** — connect Thunderbird, Apple Mail, Outlook, iOS/Android via the **IMAP/SMTP bridge**
- **Programmatic** — API keys for send/read, webhooks for inbound events
- **11 languages** — auto-detected, RTL-aware (en, zh, hi, es, fr, ar, bn, pt, ru, ja, vi)
- **Self-served domains** — Lumimail provisions Cloudflare Email Routing & Sending DNS for you

## Stack

- **Framework:** Next.js 16 (App Router) on Cloudflare Workers via OpenNext
- **Storage:** Cloudflare D1 (SQLite), R2 (blob), Queues (async processing)
- **Auth:** Session cookies, bcrypt-hashed tokens, Bearer API keys
- **Email:** Cloudflare Email Routing (inbound) + Email Sending (outbound)
- **UI:** React 19, Tailwind CSS v4, shadcn/ui, TanStack Query — mobile-responsive
- **ORM/validation:** Drizzle ORM, Zod
- **Clients:** Standalone IMAP4rev1 + SMTP bridge (see [`imap-bridge/`](./imap-bridge/README.md))

## Setup

One command (idempotent — copies `.dev.vars`, installs deps, runs local migrations):

```bash
./setup.sh
npm run dev
```

Or step by step:

```bash
cp .dev.vars.example .dev.vars
# Add CF_TOKEN with Zone Read, Email Routing Edit, Email Sending Edit,
# and Email Routing Rules Write permissions.

npm install
npm run db:migrate:local
npm run dev
```

Register at `/register`, complete onboarding, or seed demo data:

```bash
curl -X POST http://localhost:3000/api/seed
```

## Deploy

For a complete self-hosting walkthrough including Cloudflare token scopes,
Wrangler configuration, DNS setup, Email Routing, and troubleshooting, see:

- [Self Hosting Guide](docs/SELF_HOSTING.md)

One-click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cschanhniem/lumimail)

Manual:

```bash
cp wrangler.jsonc.example wrangler.jsonc
# Fill in your database_id, bucket_name, queue names
npm run deploy
```

### Required secrets

| Variable | Description |
|----------|-------------|
| `CF_TOKEN` | Cloudflare API token with Zone Read, Email Routing Edit, Email Sending Edit, Email Routing Rules Write |
| `CF_ACCOUNT_ID` | Cloudflare account ID (optional — only if your token spans multiple accounts) |
| `CF_EMAIL_WORKER_NAME` | Must match `name` in `wrangler.jsonc`. Default: `lumimail` |
| `RESEND_API_KEY` | Resend API key. Required only when `MAIL_PROVIDER=resend` |
| `PUBLIC_APP_URL` | Canonical HTTPS origin used for password-reset links |
| `PASSWORD_RESET_FROM` | Verified sender address used for password-reset messages |

### Outbound provider (optional)

By default Lumimail sends via Cloudflare's `send_email` binding, which only
delivers to **destination addresses verified in your Cloudflare account**. To
send to **arbitrary recipients** on a verified sending domain, set
`MAIL_PROVIDER=resend` and provide `RESEND_API_KEY`:

```bash
# in wrangler.jsonc vars:  "MAIL_PROVIDER": "resend"
npx wrangler secret put RESEND_API_KEY
```

Inbound mail is unaffected — it always uses Cloudflare Email Routing. Leave
`MAIL_PROVIDER` unset (or `cloudflare`) to keep the default behavior. See
[`docs/specs/F33-outbound-mail-providers.md`](docs/specs/F33-outbound-mail-providers.md).

### Post-deploy

After deploying, go to Cloudflare Dashboard → Email → Email Routing and route inbound mail to your Worker.

## Connect a desktop or mobile email client

Lumimail speaks IMAP and SMTP through a standalone bridge so any client works. Run the bridge ([`imap-bridge/`](./imap-bridge/README.md)), then point your client at it and authenticate with a Lumimail **API key** as the password. Apple Mail, Thunderbird, Outlook, iOS Mail, Gmail app (external account) — all connect.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/domains` | GET/POST | List or add domains |
| `/api/domains/[id]` | GET/DELETE | Get or remove a domain |
| `/api/domains/[id]/dns` | GET | DNS status snapshot |
| `/api/mailboxes` | GET/POST | List or create mailboxes |
| `/api/messages` | GET | List messages by folder |
| `/api/messages/[id]` | GET | Message detail |
| `/api/messages/bulk` | POST | Move, mark read/unread, delete in bulk |
| `/api/send` | POST | Send email |
| `/api/v1/send` | POST | Send via API key (programmatic) |
| `/api/v1/messages` | GET | Read messages via API key |
| `/api/api-keys` | GET/POST | Manage API keys |

## Domain provisioning

When you add or remove a domain, Lumimail calls Cloudflare directly:

| Action | Cloudflare API |
|--------|---------------|
| Enable inbound routing (MX, SPF, DKIM) | `POST /zones/{zone_id}/email/routing/dns` |
| Disable routing | `DELETE /zones/{zone_id}/email/routing/dns` |
| Enable sending (subdomain DNS) | `POST /zones/{zone_id}/email/sending/subdomains` |
| Remove sending | `DELETE /zones/{zone_id}/email/sending/subdomains/{tag}` |

The domain must already be a Cloudflare zone on the same account as `CF_TOKEN`.

## Troubleshooting

**Cloudflare API 403 — code 9109 (Invalid access token)**

The deploy button provisions the Worker but doesn't create a runtime `CF_TOKEN`. Create one manually in the Cloudflare dashboard (User API Tokens), then set it as a deploy secret. Verify:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer <CF_TOKEN>"
```

**Cloudflare API 403 — code 10000 on email/routing/dns**

Missing permissions. Update `CF_TOKEN` scope:

- Account: Email Sending:Edit, DNS Settings:Edit, Email Routing Addresses:Edit
- Zone: DNS Settings:Edit, Email Routing Rules:Edit, Zone Settings:Edit, DNS:Edit

## FAQ

**Is Lumimail a real Gmail alternative?**
Yes. It delivers Gmail-class webmail — compose, reply/forward, threads, search, labels, stars, filters, vacation responder, contacts, attachments with inline preview, bulk actions — plus IMAP/SMTP for desktop and mobile clients.

**Is Lumimail a Google Workspace alternative for teams?**
Yes. It's multi-tenant: organizations, member invites, roles, and strict per-user cross-tenant isolation, with admin tools for domains, mailboxes, aliases, routing, and webhooks.

**Where does my email live?**
On your own Cloudflare account — D1 for metadata, R2 for raw messages and attachments. No third party holds your mail.

**Why is it cheaper at scale?**
Cost is Cloudflare infrastructure, not per-seat licensing. Adding mailboxes doesn't add a recurring per-head fee.

**What does it run on?**
Next.js 16 on Cloudflare Workers (OpenNext), D1, R2, Queues. Serverless — no VPS, no mail server to patch.

**Can I connect Apple Mail / Thunderbird / Outlook?**
Yes, through the IMAP/SMTP bridge, authenticating with an API key.

**What's the license — can I use it commercially?**
Lumimail is **AGPL-3.0** open source: self-host, modify, and redistribute freely. The catch that keeps it sustainable — if you run a modified version *as a network service*, you must publish your changes. Want to offer a hosted Lumimail without that obligation? A commercial license is available — email **vh3969@gmail.com**.

## Contributing

Lumimail is built in the open and **contributions are genuinely welcome** — bug fixes, features, docs, translations, or just a sharp issue report. The full guide is in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Good first steps:

1. ⭐ Star the repo and open a [GitHub issue](https://github.com/cschanhniem/lumimail/issues) for bugs or ideas.
2. Fork, branch, and send a PR. Run `npm run verify` before opening it.
3. Sign off on the [Contributor License Agreement](./CLA.md) — it keeps copyright consolidated so the project can stay **both open source and commercially sustainable** (the commercial license is what funds the open one).

Every contribution keeps email a little more open.

### Built for AI coding agents

Lumimail is designed so autonomous agents can contribute as first-class collaborators:

- **[`AGENTS.md`](./AGENTS.md)** — the canonical agent contract: default behavior, rules, codebase map.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — request/mail data-flow diagrams and where every behavior lives.
- **[`docs/AGENT_TASKS.md`](./docs/AGENT_TASKS.md)** — a curated, self-contained task surface sized for single PRs.
- **Grab live work:** issues labeled [`ai-agent-friendly`](https://github.com/cschanhniem/lumimail/issues?q=is%3Aopen+label%3Aai-agent-friendly) and [`good first issue`](https://github.com/cschanhniem/lumimail/issues?q=is%3Aopen+label%3A%22good+first+issue%22).
- **[`docs/ENGINEERING.md`](./docs/ENGINEERING.md)** — the spec → tests → implement → verify lifecycle every change follows.
- **One-command verification:** `npm run verify` is the definition of done (typecheck + lint + 100%-coverage tests).

## Support

- **Email:** vh3969@gmail.com
- **Commercial licensing & partnerships:** vh3969@gmail.com
- **Bugs & features:** open a GitHub issue

## License

**AGPL-3.0** (GNU Affero General Public License v3.0). Copyright (c) 2026 Le Viet Hong. Commercial licenses available — see [LICENSE](./LICENSE) and contact vh3969@gmail.com.
