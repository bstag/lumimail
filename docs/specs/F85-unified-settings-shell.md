# F85 — Unified Settings Shell

> Status: Shipped
> Owner area: `src/components/settings/`, `/settings`, existing owner/admin routes

## 1. Current Behavior

Personal mailbox, vacation, password, and API-key settings live under `/settings`, while
organization access, domains, routing, integrations, security, operations, and release evidence are
reachable only through the separate administration navigation. Authorization is correct, but the
product does not present these concerns as one understandable lifecycle.

## 2. Desired Behavior

- `/settings` presents a stable Settings shell with Personal, Mailbox, Integrations, Organization,
  Security, Operations, and Updates categories.
- Personal and mailbox forms remain on `/settings`; personal API keys remain at
  `/settings/api-keys`.
- Organization/admin links reuse their existing routes and server authorization. The shell never
  reimplements or implies access.
- Members see only personal, mailbox, and personal-integration destinations. Organization admins
  additionally see organization destinations. Owners additionally see security, operations, queue,
  recovery, and release-evidence destinations.
- The shell works at 390px as a horizontally scrollable category rail and at desktop as a bounded
  navigation column beside the selected content.
- Existing direct routes and navigation remain valid.

## 3. Edge and Error States

- A missing session renders no privileged links.
- A member cannot reveal owner/admin links by navigating directly or changing client state; existing
  route guards remain authoritative.
- Long localized labels wrap or scroll without overlapping content.
- The selected category is indicated with `aria-current` and not color alone.
- Updates link to read-only signed-release evidence in Operations; no deploy/update mutation is
  added.

## 4. Scope Boundaries

In scope: one shared shell, capability-filtered category model, wrapping personal settings and API
keys, deep links to existing administrative surfaces, and Operations evidence anchors.

Out of scope: moving route handlers, changing roles, adding deployment controls, duplicating admin
pages under new URLs, or changing any mutation contract.

## 5. Test Plan

| Layer | Coverage |
|---|---|
| Unit | category filtering and active-category selection for member/admin/owner |
| E2E | member sees only personal destinations; owner sees all categories; API-key route retains shell; 390px rail remains usable |
| Existing security | restricted admin navigation and direct-route denial remain passing |
| Full | `npm run verify`, `npm run e2e`, and migrated-local-D1 E2E |

## 6. Decisions

- Decision: link to existing guarded routes instead of creating authorization aliases. — 2026-08-13
- Decision: Updates is a read-only link to signed-release evidence until F81 defines protected
  publication and promotion. — 2026-08-13

## 7. Bug / Change Log

### 2026-08-13 — Specify the consolidated Settings experience

Type: Feature

- Reserve F85 after F84 became production performance evidence.
- Define a role-filtered presentation shell without changing server authorization or route
  contracts.
- Implement the shared desktop/mobile shell across personal settings and personal API keys. Members
  receive three personal destinations, admins add Organization, and owners receive the full seven-
  category lifecycle without changing any guarded route.
- Surface the existing profile and recovery-email form on the Personal section; add bounded deep
  links for Security and signed-release evidence.
- Five unit contracts, four focused Chromium scenarios, all 90 mocked Chromium scenarios, and full
  verification pass. Verification includes 2,122 application tests at 100% configured coverage and
  21 bridge tests; lint reports zero errors.
