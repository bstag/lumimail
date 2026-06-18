# Lumimail docs

Navigation hub for everything under `docs/`. New contributor? Read in this order:

1. [`../AGENTS.md`](../AGENTS.md) — the agent/contributor contract (start here).
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the system fits together (data-flow diagrams).
3. [`ENGINEERING.md`](./ENGINEERING.md) — the spec → tests → implement → verify lifecycle.
4. [`AGENT_TASKS.md`](./AGENT_TASKS.md) — pick a self-contained task and open a PR.

## Reference

| Doc | What's in it |
|-----|--------------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Worker entry points, request lifecycle, inbound/outbound mail flow, storage model, where-things-live map |
| [`ENGINEERING.md`](./ENGINEERING.md) | Mandatory development lifecycle and verification rules |
| [`AGENT_TASKS.md`](./AGENT_TASKS.md) | Curated task surface sized for single autonomous PRs |
| [`MVP_SCOPE.md`](./MVP_SCOPE.md) | Feature registry and scope tracking |
| [`DESIGN.md`](./DESIGN.md) / [`TASTE.md`](./TASTE.md) | Product design direction and UX taste |
| [`tests/README.md`](./tests/README.md) | Test layout and conventions |

## Feature specs (`specs/`)

Source of truth for behavior. Each follows [`specs/TEMPLATE.md`](./specs/TEMPLATE.md).

| Spec | Feature |
|------|---------|
| [`F01-auth`](./specs/F01-auth.md) | Authentication & sessions |
| [`F02-domains`](./specs/F02-domains.md) | Domain provisioning |
| [`F02-github-ci`](./specs/F02-github-ci.md) | CI pipeline |
| [`F03-mailboxes`](./specs/F03-mailboxes.md) | Mailboxes |
| [`F04-mail-folders`](./specs/F04-mail-folders.md) | Folders |
| [`F05-compose-send`](./specs/F05-compose-send.md) | Compose & send |
| [`F06-api-keys`](./specs/F06-api-keys.md) | API keys |
| [`F09-settings`](./specs/F09-settings.md) | Settings |
| [`F12-multi-user-workspace`](./specs/F12-multi-user-workspace.md) | Multi-tenant orgs |
| [`F13-imap-smtp-bridge`](./specs/F13-imap-smtp-bridge.md) | IMAP/SMTP bridge |

## Implementation notes (`implementation/`)

Deeper notes on specific surfaces — see [`implementation/README.md`](./implementation/README.md):
aliases, group aliases, attachments, filters/vacation/contacts, labels, reply/forward, starred messages.
