# F69 — Navigation Ergonomics

> Status: `Shipped`
> Owner area: `src/app/(dashboard)/layout.tsx`, `src/app/(admin)/layout.tsx`, `src/components/*nav*`

## 1. Problem & User Job

The sidebar is a fixed 256px column at every desktop width, and on phones the only
way to navigate is a hamburger that opens a slide-in drawer.

Both cost the user. The mail list is the widest thing in the app and gives up a
quarter of a 1024px viewport to a nav the user already knows by heart. On a phone,
every folder change is two taps and a drawer animation, and the drawer covers the
content it is navigating.

**User job:** as a user on a laptop, I want to give the message list more room without
losing my way around; as a user on a phone, I want to move between the folders I use
constantly in one tap.

## 2. User Stories & Acceptance Criteria

- Given a desktop viewport, When I collapse the sidebar, Then it becomes an icon rail
  and the content column widens by the difference.
- Given I have collapsed the sidebar, When I return in a later session, Then it is
  still collapsed.
- Given the sidebar is collapsed, When I use a screen reader or a keyboard, Then every
  destination still has its full name.
- Given a phone viewport in the mail section, When any mail page renders, Then a bottom
  bar offers my most-used folders in one tap.
- Given the bottom bar, When I need a destination it does not carry, Then **More**
  opens the existing drawer with everything.
- Given the bottom bar, When content scrolls to its end, Then the bar does not cover
  the last row.

## 3. Scope Boundaries

**In scope:** collapse-to-rail in both sections, persisted; a mobile bottom bar in the
mail section; the drawer as overflow.

**Out of scope:** drag-to-resize (considered and declined — the nav content is
fixed-width, so most widths only add empty space); a bottom bar in the admin section
(a low-traffic, form-heavy area where a permanent bar costs more height than it
returns); replacing the drawer.

## 4. Design decisions

**The rail keeps its accessible names.** Collapsing hides labels visually with
`sr-only` rather than removing them. A rail whose destinations are unnamed is unusable
with a screen reader, and it would also silently break every `getByRole("link", { name })`
in the suites — the same signal.

**The bottom bar is rendered by media query, not by `md:hidden`.** A CSS-hidden bar
would still put a second "Drafts" link and a second "Compose" button in the DOM at
desktop. Playwright locators are strict, so `getByRole("link", { name: "Drafts" })`
would resolve to two elements and existing assertions would fail — correctly, because
duplicated landmarks are also a real accessibility problem. The bar is therefore
mounted only below the `md` breakpoint.

**No pre-paint script is needed.** `AuthGuard` returns `null` until the session check
resolves, so the shell's first paint already happens after mount. State read from
`localStorage` in an effect is applied before the sidebar is ever painted. This is
unlike the theme, which paints on `/login` before any guard runs and therefore does
need its inline script.

**The collapse toggle reuses the header slot the mobile hamburger occupies.** That
slot is empty at desktop today. Reusing it avoids adding chrome, and the control sits
directly beside the thing it collapses.

**Tabs are chosen, not hardcoded.** The bar takes the first four destinations from a
priority order that survive capability filtering, so a viewer — who has no Compose and
no Drafts — gets a full bar of things they can actually use rather than gaps.

## 5. Test Plan

Pure selection and persistence logic lives in `*-utils.ts` files and is unit tested to
the 100% gate. Behaviour is covered by contracts in
`tests/e2e-local/navigation.spec.ts` against the real backend:

- collapsing narrows the sidebar and widens the content column
- the collapsed state survives a reload
- every destination keeps its accessible name while collapsed
- at a phone viewport the bar renders, and its tabs match the user's capabilities
- **More** opens the drawer
- the bar does not overlap page content
- at desktop the bar is absent from the DOM, so no nav name appears twice

## 6. Implementation and Verification Log

### 2026-07-26 — Local implementation

Selection and persistence logic was written first, as pure functions under the 100%
gate: `nav-sidebar-utils.ts` (21 assertions with `mobile-tab-bar-utils.ts`) covers a
storage that throws — Safari private mode raises on `getItem`, and a nav that refuses
to render over a missing preference would be a far worse failure than one that opens
expanded.

| Piece | Where |
|-------|-------|
| Collapse state, persistence, grid geometry | `src/components/nav-sidebar-utils.ts` |
| Tab selection from capability-filtered links | `src/components/mobile-tab-bar-utils.ts` |
| Breakpoint as a mount decision | `src/hooks/use-media-query.ts` |
| Rail rendering | `NavItem`, `DashboardNav`, `AdminNav` (`collapsed` prop) |
| Bar | `src/components/mobile-tab-bar.tsx` |
| Shared link source | `useMailNavLinks()` in `dashboard-nav.tsx` |

`nav.more` was added to all eleven locales.

Two corrections during implementation:

- The mobile hamburger was initially kept alongside the bar's **More** button. Two
  controls for the same drawer, both competing for width on a 390px header. The
  hamburger is gone from the mail shell; admin keeps its own, since admin has no bar.
- The collapse preference is shared between the two sections rather than stored per
  section. Collapsing in Mail and then opening Admin to a full sidebar would read as
  the setting not having taken.

**Verification:** `npm run verify` — 166 files, 1,484 tests, 100% configured coverage,
lint clean. Mocked E2E 46 passed; local E2E 47 passed, including 12 new contracts.
Both sections captured expanded, railed, and at a 390px viewport in light and dark.

**Not done:** the admin section has no bottom bar, by the decision in §3. Drag-to-resize
was declined rather than deferred — the nav content is fixed-width, so additional width
only adds empty space.

### 2026-08-01 — Deployed

Deployed to production. This entry records the deployment only; the rail, tab bar, and
persistence contracts remain local gates, and no separate production audit was performed.
