# F13 — IMAP/SMTP Bridge for Email Client Support

**Status:** In Progress  
**Priority:** High — required for full Google Workspace replacement  

> Contract repair: the authentication, API, protocol, TLS, and verification details below were
> found to be incomplete or incorrect. [F52](./F52-imap-smtp-bridge-contract-repair.md) is the
> authoritative current contract; this file remains the original feature overview.

## Overview

Lumimail's core runs on Cloudflare Workers, which only supports HTTP. To support standard email clients (Thunderbird, Apple Mail, Outlook, mobile mail apps), we need a separate TCP server that implements IMAP4rev1 (RFC 3501) and SMTP (RFC 5321) and bridges to the Lumimail HTTP API.

## Architecture

```
Email Client (Thunderbird, Apple Mail, etc.)
        │
        │  IMAP (port 993/SSL) or SMTP (port 587/STARTTLS)
        ▼
┌─────────────────────┐
│  Lumimail Bridge    │  Node.js / Deno TCP server
│  (imap-bridge/)     │  - IMAP4rev1 server
│                     │  - SMTP relay
│                     │  - Uses Lumimail API keys for auth
└─────────────────────┘
        │
        │  HTTPS REST API
        ▼
┌─────────────────────┐
│  Lumimail API       │  Cloudflare Workers
│  (main app)         │  - /api/messages (read/list)
│                     │  - /api/v1/send (send)
│                     │  - /api/auth/me (auth)
└─────────────────────┘
```

## Authentication

Email clients authenticate with:
- **Username:** the full email address (e.g., `alice@example.com`)
- **Password:** a Lumimail API key (from Settings → API Keys)

The bridge validates credentials by calling `GET /api/auth/me` with `Authorization: Bearer <api-key>`.

## IMAP Folder Mapping

| IMAP Folder       | Lumimail folder | Query params                          |
|-------------------|-----------------|---------------------------------------|
| INBOX             | inbox           | `direction=inbound&status=received`   |
| Sent              | sent            | `direction=outbound&status=sent`      |
| Drafts            | drafts          | `direction=outbound&status=draft`     |
| Spam / Junk       | spam            | `status=spam`                         |
| Trash             | trash           | `status=trash`                        |
| Starred           | starred         | `starred=true`                        |

## SMTP Sending

The SMTP server accepts outbound mail and forwards it to `POST /api/v1/send` using the authenticated user's API key.

## Implementation

The bridge lives in `imap-bridge/` as a separate Node.js package. It is deployed independently (e.g., as a Docker container, Railway app, or VPS).

### Key packages

- `node-imap` or custom IMAP server using `net`/`tls` modules
- `smtp-server` from nodemailer for the SMTP side
- `mailparser` for parsing outbound messages

## Setup Instructions

1. Generate an API key in Lumimail (Settings → API Keys, scope: `messages:read,send`)
2. Configure your email client:
   - **IMAP server:** `imap.yourdomain.com` port `993` SSL
   - **SMTP server:** `smtp.yourdomain.com` port `587` STARTTLS
   - **Username:** your full email address
   - **Password:** your Lumimail API key

## Security

- TLS required for all connections (no plaintext)
- API keys are scoped — use `messages:read` + `send` scopes only
- Rate limiting inherits from Lumimail API
- Bridge never stores credentials

## Deployment

See `imap-bridge/README.md` for Docker deployment instructions.
