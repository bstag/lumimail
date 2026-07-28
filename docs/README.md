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

Source of truth for behavior. Each follows
[`specs/TEMPLATE.md`](./specs/TEMPLATE.md); current shipping status lives in
[`MVP_SCOPE.md`](./MVP_SCOPE.md).

- Foundation: [`F01-auth`](./specs/F01-auth.md),
  [`F02-domains`](./specs/F02-domains.md),
  [`F02-github-ci`](./specs/F02-github-ci.md),
  [`F03-mailboxes`](./specs/F03-mailboxes.md),
  [`F04-mail-folders`](./specs/F04-mail-folders.md),
  [`F05-compose-send`](./specs/F05-compose-send.md),
  [`F06-api-keys`](./specs/F06-api-keys.md),
  [`F09-settings`](./specs/F09-settings.md),
  [`F12-multi-user-workspace`](./specs/F12-multi-user-workspace.md),
  [`F13-imap-smtp-bridge`](./specs/F13-imap-smtp-bridge.md).
- Provider and deployment contracts:
  [`F33-outbound-mail-providers`](./specs/F33-outbound-mail-providers.md),
  [`F34-workers-html-sanitization`](./specs/F34-workers-html-sanitization.md),
  [`F35-pwa-installability`](./specs/F35-pwa-installability.md),
  [`F36-production-dependency-upgrade`](./specs/F36-production-dependency-upgrade.md),
  [`F37-registration-domain-response`](./specs/F37-registration-domain-response.md),
  [`F38-production-schema-reconciliation`](./specs/F38-production-schema-reconciliation.md),
  [`F39-password-reset-schema-reconciliation`](./specs/F39-password-reset-schema-reconciliation.md),
  [`F40-api-response-contract`](./specs/F40-api-response-contract.md),
  [`F41-api-client-contract-repairs`](./specs/F41-api-client-contract-repairs.md),
  [`F42-schema-drift-detection`](./specs/F42-schema-drift-detection.md),
  [`F43-password-recovery`](./specs/F43-password-recovery.md),
  [`F44-api-key-lifecycle`](./specs/F44-api-key-lifecycle.md),
  [`F45-cloudflare-sending-domain-readiness`](./specs/F45-cloudflare-sending-domain-readiness.md),
  [`F46-domain-catch-all-routing`](./specs/F46-domain-catch-all-routing.md).
- Authorization and interface:
  [`F47-mailbox-access-control`](./specs/F47-mailbox-access-control.md),
  [`F48-role-aware-mail-actions-and-shared-draft-refresh`](./specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md),
  [`F49-identity-bound-organization-invitations`](./specs/F49-identity-bound-organization-invitations.md),
  [`F50-account-switch-cache-isolation`](./specs/F50-account-switch-cache-isolation.md),
  [`F51-restricted-member-admin-navigation`](./specs/F51-restricted-member-admin-navigation.md),
  [`F52-imap-smtp-bridge-contract-repair`](./specs/F52-imap-smtp-bridge-contract-repair.md),
  [`F53-theme-token-consistency`](./specs/F53-theme-token-consistency.md).
- Delivery and mail flow:
  [`F54-durable-outbound-delivery`](./specs/F54-durable-outbound-delivery.md),
  [`F55-outbound-attachment-delivery`](./specs/F55-outbound-attachment-delivery.md),
  [`F56-queue-health-monitoring`](./specs/F56-queue-health-monitoring.md),
  [`F57-inbound-attachment-ingestion`](./specs/F57-inbound-attachment-ingestion.md),
  [`F58-rfc-aware-conversation-grouping`](./specs/F58-rfc-aware-conversation-grouping.md),
  [`F59-html-preserving-replies`](./specs/F59-html-preserving-replies.md),
  [`F60-internal-alias-and-group-provisioning`](./specs/F60-internal-alias-and-group-provisioning.md),
  [`F61-outbound-delivery-recovery`](./specs/F61-outbound-delivery-recovery.md),
  [`F62-external-forwarding`](./specs/F62-external-forwarding.md),
  [`F63-r2-retention-and-cleanup`](./specs/F63-r2-retention-and-cleanup.md),
  [`F64-vacation-responder-safety`](./specs/F64-vacation-responder-safety.md).
- Operations and experience:
  [`F66-query-performance-and-indexes`](./specs/F66-query-performance-and-indexes.md),
  [`F67-staging-environment`](./specs/F67-staging-environment.md),
  [`F68-ui-geometry-consistency`](./specs/F68-ui-geometry-consistency.md),
   [`F69-navigation-ergonomics`](./specs/F69-navigation-ergonomics.md),
   [`F70-documentation-status-sweep`](./specs/F70-documentation-status-sweep.md),
   [`F71-preference-controls-in-header`](./specs/F71-preference-controls-in-header.md),
   [`F72-mail-ui-state-synchronization`](./specs/F72-mail-ui-state-synchronization.md).

## Implementation notes (`implementation/`)

Deeper notes on specific surfaces — see [`implementation/README.md`](./implementation/README.md):
aliases, group aliases, attachments, filters/vacation/contacts, labels, reply/forward, starred messages.
