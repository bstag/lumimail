# Security Policy

Lumimail handles email — among the most sensitive data a person owns. We take vulnerabilities seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Report privately to **vh3969@gmail.com** (or via GitHub's [private vulnerability reporting](https://github.com/cschanhniem/lumimail/security/advisories/new) if enabled).

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version / commit.
- Any suggested remediation.

We aim to acknowledge reports within **72 hours** and to provide a remediation timeline after triage. We will credit reporters who wish to be named once a fix ships.

## Scope

In scope:

- Cross-tenant data exposure (the strongest invariant in this codebase — every query must filter by the authenticated user).
- Authentication / session / API-key bypass.
- Injection (SQL, header, template), SSRF, path traversal.
- Secret leakage or insecure storage.
- Privilege escalation across organization roles.

Out of scope:

- Issues requiring a compromised Cloudflare account or host.
- Self-inflicted misconfiguration of your own deployment.
- Missing hardening headers without a demonstrated exploit (still welcome as a normal issue/PR).

## Handling secrets

- Never commit secrets. `.dev.vars` and `wrangler.jsonc` are gitignored; use the `.example` files.
- `CF_TOKEN` is the most sensitive runtime secret. Scope it minimally (see README → Required secrets).
- If you discover an exposed secret in history, report it privately so it can be rotated.

## Supported versions

This project moves fast and is pre-1.0. Security fixes target the `main` branch. Self-hosters should track `main` or tagged releases.
