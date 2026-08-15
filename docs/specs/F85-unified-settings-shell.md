# F85 — Unified Settings Shell

> Status: Shipped
> Owner area: `src/components/settings/`, `/settings`, existing owner/admin routes

## 1. Current Behavior

Personal mailbox, vacation, password, and API-key settings live under `/settings`, while
organization access, domains, routing, integrations, security, operations, and release evidence are
reachable only through the separate administration navigation. Authorization is correct, but the
product does not present these concerns as one understandable lifecycle.

## 2. Desired Behavior

- Personal settings and organization administration render inside one shared Settings shell: one
  header, one sidebar, and one content-width contract (`max-w-5xl`), so navigating between
  `/settings` and any administrative route never swaps chrome.
- The sidebar is a compact, role-filtered list of single-line items grouped into sections:
  - **Account** (all roles): Personal (`/settings#personal`), Mailbox (`/settings#mailbox`),
    Integrations (`/settings/api-keys`, also active for `/settings/mcp`).
  - **Organization** (admin and owner): Overview (`/admin`), Members (`/members`), Mailboxes
    (`/mailboxes`), Domains (`/domains`), Aliases (`/aliases`), Routing (`/routing`), Webhooks
    (`/webhooks`), API keys (`/api-keys`).
  - **Platform** (owner): Operations (`/operations`), Queue health (`/queue-health`).
  Security and release evidence are sections within Members and Operations rather than separate
  navigation entries.
- All existing URLs remain valid; only the presentation moves. Organization routes live in a nested
  route group whose layout adds the admin guard, and the owner-only pages keep their own owner
  guard. The shell never reimplements or implies access.
- The Settings area is entered from the profile menu ("Settings", visible to every role) and from
  the mail sidebar's Settings link; a back-to-mail control in the shell header returns to `/inbox`.
- On desktop the sidebar collapses to an icon rail with the same persisted preference as the mail
  shell; at 390px it is a drawer behind the header menu button and the content never scrolls
  horizontally.

## 3. Edge and Error States

- A missing session renders no privileged links.
- A member cannot reveal owner/admin links by navigating directly or changing client state; existing
  route guards remain authoritative.
- Long localized labels wrap or scroll without overlapping content.
- The selected category is indicated with `aria-current` and not color alone.
- Updates link to read-only signed-release evidence in Operations; no deploy/update mutation is
  added.

## 4. Scope Boundaries

In scope: one shared shell and layout for personal and administrative settings, the grouped
role-filtered navigation model, the profile-menu entry point, and moving page files between route
groups without changing any URL.

Out of scope: changing roles or server authorization, adding deployment controls, renaming or
aliasing any route, or changing any mutation contract.

## 5. Test Plan

| Layer | Coverage |
|---|---|
| Unit | section filtering and active-item selection for member/admin/owner; settings-path detection for the profile menu |
| E2E | member sees only Account items and the profile-menu Settings entry; owner sees all sections; administrative pages render inside the settings shell; direct-route denial still redirects |
| Existing security | restricted admin navigation and direct-route denial remain passing |
| Full | `npm run verify`, `npm run e2e`, and migrated-local-D1 E2E |

## 6. Decisions

- Decision: link to existing guarded routes instead of creating authorization aliases. — 2026-08-13
- Decision: Updates is a read-only link to signed-release evidence until F81 defines protected
  publication and promotion. — 2026-08-13
- Decision: superseding 2026-08-13 — deep-linking from the settings nav into the separate
  administration shell made navigation swap between two different frames. Administrative pages now
  render inside the settings shell itself (same URLs, same guards); the standalone administration
  sidebar is retired. — 2026-08-14
- Decision: Security and Updates are page sections (Members, Operations) rather than navigation
  entries, keeping the sidebar compact. — 2026-08-14

## 7. Bug / Change Log

### 2026-08-14 — Render administration inside the settings shell

Type: Change

- The first shipped shell linked out to the standalone administration frame, so moving between
  Personal and Organization swapped the entire chrome (different sidebar, different width). Replace
  both with one `(settings)` route group layout hosting `/settings*` and every administrative
  route; a nested `(org)` group carries the admin guard and the owner pages keep their owner guard.
- Replace the two-line category cards and the administration sidebar with one compact grouped
  navigation (Account / Organization / Platform), role-filtered, collapsible to an icon rail.
- The profile menu gains a Settings entry for every role and loses the separate Admin settings
  entry; the mail header's settings link uses a settings icon instead of a help icon.
- Standardize the remaining hand-rolled page headings (`/mailboxes`, `/mailboxes/[id]`,
  `/api-keys`, `/webhooks`) on `PageHeader`, and complete the Organization overview grid
  (Members, Aliases, Routing cards added; the redundant Account card removed).
- Verified: typecheck and lint clean; 2,184 unit tests pass; all 98 mocked Chromium E2E
  scenarios pass; the change was exercised live against a seeded local server as owner across
  `/settings`, `/admin`, `/members`, and `/domains`. The coverage gate currently fails only on
  the unrelated in-progress F87 MCP files that predate this change.

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
