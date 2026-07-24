# F53 — Theme Token Consistency

> Status: `Shipped`
> Owner area: `src/app/globals.css`, `src/app/**`, `src/components/**`

## 1. Problem & User Job

The app ships a semantic design-token system in `src/app/globals.css` with a full
light **and** dark palette (dark via `@media (prefers-color-scheme: dark)`). The shared
UI primitives (`src/components/ui/*`) consume those tokens correctly, but ~365 usages
across ~45 page and feature files bypass the tokens with hardcoded Tailwind color
utilities (`bg-white`, `text-neutral-900`, `bg-[#f6f8fc]`, `bg-blue-600`,
`border-neutral-200`, `text-red-600`, …).

Hardcoded utilities are frozen light-mode values. On an OS set to dark, the
token-driven chrome flips dark while the hardcoded regions stay light, producing a
jarring light/dark mix — most visibly, token-colored text becomes near-invisible on
frozen-white panels. Forms, labels, and buttons are the worst affected.

**User job:** as any user, the app should render as one coherent theme that correctly
follows my OS light/dark preference, so form-based screens are legible and usable.

## 2. User Stories & Acceptance Criteria

- As a user on a light OS, every screen renders in the light palette with consistent
  surfaces, text hierarchy, borders, and accent colors.
- As a user on a dark OS, every screen renders in the dark palette — no frozen-white
  panels, no invisible text, no light chips on dark backgrounds.
- Given any page/component, When it needs a color, Then it references a semantic token
  utility (e.g. `bg-surface-raised`, `text-ink-muted`, `bg-accent`) rather than a raw
  Tailwind palette color or hex literal.
- Given the popup composer is open, When a global language or theme control shares
  its screen area, Then the composer is layered above that control so Send, attachment,
  and other composer actions remain clickable.

## 3. Scope Boundaries

**In scope:**
- Add the missing semantic tokens needed for a complete mapping (muted danger/success,
  warning + muted, inverse surface/ink) to `globals.css` for both palettes and register
  them in `@theme inline`.
- Replace hardcoded color utilities with token utilities across all `src/**/*.tsx`.

**Out of scope:**
- ~~A manual (in-app) light/dark toggle.~~ Added 2026-07-23 (see change log) — a
  System/Light/Dark toggle now overrides system preference for easy testing.
- Wholesale palette redesign (existing hues are kept; dark surfaces were softened
  from near-black and muted ink brightened for readability).

## 4. Design Tokens

Existing (unchanged): `surface`, `surface-raised`, `surface-subtle`, `ink`,
`ink-muted`, `ink-faint`, `border`, `border-strong`, `accent`, `accent-muted`,
`danger`, `success`.

New tokens added by this feature:

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--danger-muted` | `#fef2f2` | `#3a1d1d` | danger alert/badge fills |
| `--success-muted` | `#f0fdf4` | `#153021` | success alert/badge fills |
| `--warning` | `#d97706` | `#f59e0b` | warning text/icons (stars, amber) |
| `--warning-muted` | `#fffbeb` | `#37290f` | warning alert/badge fills |
| `--info` | `#7c3aed` | `#a78bfa` | third-category badge accent (e.g. contact "Outbound") |
| `--info-muted` | `#f5f3ff` | `#2a2145` | info badge fills |
| `--surface-inverse` | `#26262b` | `#e8e8e4` | dark "chips"/tooltips that must invert |
| `--ink-inverse` | `#fafaf8` | `#1a1a18` | text on `surface-inverse` |

## 5. Mapping (hardcoded → token utility)

**Surfaces**
- `bg-white` → `bg-surface-raised`
- `bg-[#f6f8fc]`, `bg-[#f8fbff]` (page/shell) → `bg-surface`
- `bg-[#f2f6fc]`, `bg-[#eaf1fb]`, `bg-neutral-50`, `bg-neutral-100` → `bg-surface-subtle`
- `hover:bg-neutral-200`, `hover:bg-[#f2f6fc]`, `hover:bg-[#f8fbff]` → `hover:bg-surface-subtle`
- `bg-neutral-800`, `bg-neutral-900` (dark chip/tooltip/active) → `bg-surface-inverse`
- `bg-black/40` (modal scrim) → unchanged

**Text**
- `text-neutral-950/900/800` → `text-ink`
- `text-neutral-700/600/500` → `text-ink-muted`
- `text-neutral-400/300` → `text-ink-faint`
- `text-white` on an accent/danger/success fill → unchanged
- `text-white` on `bg-neutral-800/900` (now inverse) → `text-ink-inverse`

**Accent (blue)**
- `bg-blue-600/700` → `bg-accent`; `hover:bg-blue-700` → `hover:brightness-90`
- `bg-blue-50/100` → `bg-accent-muted`
- `text-blue-600/700/800/950` → `text-accent`
- `border-blue-500/600` → `border-accent`; `border-blue-100/200` → `border-accent/30`
- `ring-blue-500/20` → `ring-accent/20`

**Danger (red)**
- `bg-red-600` → `bg-danger`; `bg-red-50` → `bg-danger-muted`
- `text-red-500/600/700` → `text-danger`
- `border-red-100/200` → `border-danger/30`

**Success (green)**
- `bg-green-600` → `bg-success`; `bg-green-50/100` → `bg-success-muted`
- `text-green-600/700/800` → `text-success`
- `border-green-100` → `border-success/30`

**Warning (amber/yellow)**
- `bg-amber-100` → `bg-warning-muted`
- `text-amber-500/800`, `text-yellow-400`, `fill-yellow-400` → `text-warning` / `fill-warning`

**Neutrals — borders / rings / divides**
- `border-neutral-100/200`, `border-white` → `border-border`
- `border-neutral-300`, `ring-neutral-300` → `border-border-strong` / `ring-border-strong`
- `divide-neutral-100` → `divide-border`

**Cleanup**
- Remove now-redundant `dark:` variants that duplicated a hardcoded light value
  (e.g. `bg-neutral-50 dark:bg-neutral-900` → `bg-surface-subtle`), since tokens
  already encode both palettes.

## 6. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Static | `npm run typecheck` | no type regressions from edits |
| Static | `npm run lint` | className strings remain valid |
| Unit | `npm run test` | existing suites unaffected (no logic change) |
| Manual/E2E | dashboard + a form screen in light and dark OS mode | coherent single theme, legible forms |
| Unit | `tests/unit/components/floating-controls-layering.test.ts` | global preference controls remain below the popup composer |

Coverage target: unchanged; this feature edits only className strings, not covered logic.

## 8. Current Behavior

Tokens exist and primitives use them, but page/feature files hardcode light-mode
colors, so dark mode is broken and inconsistent.

## 13. Bug / Change Log

### 2026-07-23 — Route all UI color through semantic tokens

Type: `Refactor`

Summary:
- Added muted danger/success, warning + muted, and inverse surface/ink tokens.
- Replaced ~365 hardcoded color utilities across ~45 files with token utilities.

Reason:
- Hardcoded light-mode colors ignored the dark palette, producing an inconsistent,
  hard-to-use light/dark mix on form screens.

Impact:
- The app now renders one coherent theme that follows OS light/dark preference.

### 2026-07-23 — Manual theme toggle + dark-palette readability

Type: `Feature`

Summary:
- Added an app-wide floating System/Light/Dark toggle (`src/components/theme-toggle.tsx`),
  persisted in `localStorage` and applied before first paint via an inline script.
- Restructured `globals.css`: light `:root` is default; dark applies on system
  preference when unset (`:root:not([data-theme])`) or explicitly via
  `:root[data-theme="dark"]`, with `color-scheme` set per theme.
- Fixed the root layout that pinned `viewport.colorScheme = "light"` (which fought
  the dark palette) and removed the stale hardcoded `light` body class.
- Softened dark surfaces away from near-black (`--surface #111110 → #17171a`) and
  brightened muted/faint ink (`--ink-muted #91918a → #a3a39c`, `--ink-faint
  #505050 → #70706a`) so low-emphasis text (e.g. inbox label chips) is legible.

Reason:
- Users testing on a dark OS found the near-black surfaces too stark and some muted
  labels hard to read, and had no way to switch themes without changing OS settings.

## 14. Implementation and Verification Log

### 2026-07-23 — Local implementation

- Added the missing semantic danger, success, warning, information, and inverse color tokens for both system palettes.
- Replaced hardcoded light-palette color utilities across 46 application/component files.
- A final repository scan found and replaced six remaining `shadow-neutral-*` color utilities; the F53 hardcoded-color scan now returns no matches.
- `npm run verify` passed with 135 application test files, 1,110 tests, 100% statements/branches/functions/lines, 16 bridge tests, and 36 pre-existing lint warnings with zero errors.
- In the complete 34-scenario Chromium run, 33 scenarios passed and one API-key error-flow scenario hit its 30-second timeout under concurrency. The timed-out scenario passed alone in 1.8 seconds. Both Playwright commands then remained open until command timeout because the known local Wrangler remote-proxy helper could not initialize or stop cleanly in the non-interactive sandbox.
- An OpenNext production build passed while the F53 working tree was present. The final six class-only shadow-token corrections were covered by the subsequent typecheck, lint, and test verification; the production build was not rerun after those six substitutions.
- A deliberate light/dark production visual comparison remains pending, so F53 is not yet marked production-validated.

### 2026-07-24 — Production usability validation

- The operator completed production light/dark usability review after the semantic-token,
  manual theme-selector, typography, responsive-layout, and stale-service-worker fixes.
- The resulting interface was confirmed materially more usable, closing the remaining
  manual validation boundary for this feature.

### 2026-07-24 — Floating language selector blocked popup Send

Type: `Bug`

Current behavior:
- `LanguageSwitcher` is fixed at the bottom-right with `z-50`.
- The popup composer occupies the same corner at `z-40`, allowing the language
  selector to cover and intercept clicks intended for Send.
- The theme control has the same global `z-50` layering and can produce the same
  obstruction when the popup spans a narrow viewport.

Desired behavior:
- Global language and theme controls remain below popup/dialog content.
- Closing the popup restores normal access to the global controls.

Edge cases:
- Desktop popup composer in the bottom-right corner.
- Narrow viewports where the popup spans nearly the full width.
- Keyboard access remains available and DOM order is unchanged.

Error states:
- This is a layout-only correction; no new runtime error state is introduced.

Test plan:
- Add a static component regression test asserting both global controls use a lower
  layer than the popup composer.
- Run `npm run verify`.
- Rebuild/deploy and confirm Send is clickable with the language selector present.

Decision:
- Preserve control placement and lower the global controls from `z-50` to `z-30`.
  The composer already uses `z-40`, so this is the smallest reversible fix and avoids
  viewport-specific positioning rules.

Final behavior:
- The language and theme controls use `z-30`.
- The popup composer remains at `z-40`, keeping all composer actions above both
  floating controls without changing DOM order or keyboard access.

Verification:
- The new unit regression test failed before implementation and passed afterward.
- `npm run verify` passed with 140 application test files, 1,154 tests, 100% statement,
  branch, function, and line coverage, 16 bridge tests, and 35 pre-existing lint
  warnings with zero errors.
- All 36 Chromium E2E scenarios passed, including the popup composer layering
  scenario. The runner remained open until command timeout because of the known
  local Wrangler remote-proxy shutdown/auth limitation after the scenarios completed.
- Commit `bee7d53` deployed as Worker `73a3d71a-411b-4de7-8ada-0e1decdf39e1`.
  After reloading production, the same saved draft's Send action was clickable and
  completed successfully while the language selector occupied the same screen area.
