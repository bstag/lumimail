# F92 — Mantle Presentation Layer

> Status: `Shipped`
> Owner area: `mantle/`, `public/`, `src/app/`, `src/components/`, `src/app/globals.css`

## 1. Problem & User Job

Picket has a completed visible-name rebrand but still uses the inherited neutral visual system. The
Mantle package supplies a brand direction, palette, typography, and sigil family that should become
the application's presentation layer without changing mail behavior, authorization, routing, data,
or deployment identifiers.

The original expanded Mantle package remains under `mantle/` as immutable design-source material.
Application-ready derivatives belong in `public/brand/` or code-native brand components; they must
not overwrite or silently modify the source package.

## 2. Current Behavior

- The application uses Geist Sans/Mono and a warm-neutral light palette with blue accents.
- Theme selection supports system, explicit light, and explicit dark modes through `data-theme`.
- The landing page, dashboard navigation, PWA assets, offline shell, and metadata use the existing
  square application icon.
- Semantic colors for danger, success, warning, and information are distinct from the brand accent.
- UI geometry is owned by existing component primitives and responsive shells.

## 3. Desired Behavior

- Picket presents one coherent identity across landing, authentication, dashboard, settings, PWA,
  offline, and installed-app surfaces.
- The shield/route sigil cropped from the supplied primary lockup is the visual authority for the
  canonical small mark. App-ready derivatives preserve its exact silhouette through deterministic
  alpha masks rather than approximating it with hand-redrawn geometry or shipping the traced SVG.
- Large lockups compose the clean sigil with live text so localization, accessibility, responsive
  layout, and future tagline changes do not require regenerating an image.
- Light, dark, and system themes use Mantle-derived semantic tokens while preserving existing theme
  preference behavior and avoiding a flash of the wrong theme.
- Plus Jakarta Sans is used for brand display/headings and IBM Plex Sans for interface/body text where
  the current locale has suitable glyph coverage; unsupported scripts use explicit system fallbacks.
- Brand accent, status colors, focus indication, and text-on-accent colors remain separate semantic
  roles and meet WCAG AA.
- Existing workflows, page structure, routes, authorization, storage keys, and Cloudflare identifiers
  remain unchanged.

## 4. Source Package Assessment

The following package content is reference material rather than implementation instructions:

- `mantle/mantle-identity.json`: positioning, voice, palette, theme, and typography data.
- `mantle/mantle.css`: illustrative tokens; it is not imported directly.
- `mantle/README.md`: generated brand guidance.
- `mantle/sigils/`: five concepts in PNG, transparent PNG, and traced SVG forms.

Known normalization work:

- Generated prose contains the superseded mixed-case product spelling; application copy remains
  `Picket`.
- Every supplied SVG is an ImageTracer conversion with 699–2,656 paths, a fixed 1024-pixel canvas,
  traced background artifacts, and no reusable text or geometric structure.
- The primary lockup bakes `Email on your terms.` into the artwork, while the identity's selected
  tagline is `Own the route. Control the inbox.`
- The rendered sigils primarily use a blue/slate treatment that does not directly express the declared
  navy/amber/teal system.
- The supplied CSS supports only OS dark preference, not the application's explicit theme override,
  uses a serif fallback for a sans-serif heading font, and references an undefined
  `--text-on-accent` token in its usage example.
- Waypoint Amber `#E06A3B` has 3.34:1 contrast with white, so normal-size white button text cannot be
  placed on that accent. Perimeter Navy on Waypoint Amber is 5.47:1 and is the proposed CTA pairing.
- The first Stage 1 hand-normalized four-path SVG materially changed the supplied mark: it collapsed
  the double-line shield and double chevron into heavy filled regions. It is not an acceptable visual
  match and must be replaced before production promotion. — identified 2026-09-01

## 5. Presentation Architecture

### 5.1 Brand assets

- Preserve `mantle/` verbatim as the design-source archive.
- Extract the primary sigil from the supplied transparent lockup without resampling or altering its
  geometry. Preserve that crop under `mantle/derived/` as the comparison oracle.
- Split its boundary/route and waypoint into aligned alpha masks so theme-safe application colors can
  change without changing the supplied silhouette.
- Create theme-safe `BrandMark` and `BrandLockup` components; decorative marks use empty alt text and
  linked lockups receive an accessible label.
- Derive favicon, Apple touch icon, regular PWA icons, and maskable PWA icons from the canonical mark.
- Keep required safe zones in maskable assets and test legibility at 16, 24, 28, 48, and 192 pixels.
- Do not ship the generated traced SVGs to application clients.

### 5.2 Semantic token mapping

Keep the established application token API so most components inherit the new identity safely:

| Existing role | Mantle-derived light | Mantle-derived dark |
|---------------|----------------------|---------------------|
| `surface` | Canvas Mist `#F6F8FB` | `#090E17` |
| `surface-raised` | `#FFFFFF` | `#121C2D` |
| `ink` | Perimeter Navy `#0D1524` | `#F1F5F9` |
| `ink-muted` | Coordinate Slate `#5A6B82` | `#94A3B8` |
| `border` | `#E2E8F0` | `#1E2E45` |
| `accent` (routine interaction) | Steward Teal `#1F4E66` | a separately validated lighter teal |
| `brand-signal` | Waypoint Amber `#E06A3B` | `#F07B4F` |
| `brand-signal-ink` | Perimeter Navy `#0D1524` | Perimeter Navy `#0D1524` |

`surface-subtle`, `ink-faint`, `border-strong`, accent-muted states, inverse roles, hover states, and
disabled states are derived and contrast-tested rather than copied blindly. Waypoint Amber is a
brand/routing signal rather than the universal link color because it does not meet normal-text contrast
on white. Danger, success, warning, and information colors remain semantic and are reviewed
independently.

### 5.3 Typography

- Load fonts through `next/font` so production does not depend on a runtime Google Fonts request.
- Use a display variable for the wordmark, landing headline, and H1–H3 hierarchy.
- Use a body/interface variable for navigation, tables, forms, message lists, and operational screens.
- Preserve the mono role for addresses, DNS records, API keys, and diagnostic data.
- Define per-script fallbacks for the eleven supported locales and verify no tofu, clipping, or weight
  substitution in Arabic, Bengali, Chinese, Hindi, Japanese, Russian, and Vietnamese.

### 5.4 Component and page application

- Brand components: header lockup, compact navigation mark, empty-state mark, and optional route motif.
- Primitives: buttons, inputs, cards, badges, dialogs, menus, focus rings, and selected states.
- Shells: landing/auth, mailbox dashboard, settings/admin, mobile drawer, and mobile tab bar.
- Dense mail surfaces retain restrained backgrounds and readable hierarchy; branding must not reduce
  scan speed or compete with message content.
- Steward Teal carries routine interactive roles; Waypoint Amber remains the rarer route/brand signal
  and is not used as a competing generic action color.
- Decorative route geometry is limited to landing/auth/empty states and excluded from email bodies,
  data tables, and critical dialogs.

## 6. Delivery Stages and Checkpoints

### Stage 0 — Preserve and decide

- Keep the expanded source package in `mantle/`.
- Choose the canonical simplified mark and one public tagline.
- Approve normalized light and dark lockups before application changes.
- No deployment required; source and plan only.

### Stage 1 — Asset normalization and PWA identity

- Build the clean SVG/component and generate favicon/PWA derivatives.
- Update metadata, manifest theme colors, offline branding, and navigation/landing marks.
- Add static asset, dimensions, maskable-zone, and accessible-name tests.
- Deploy to staging; inspect installed-icon, browser-tab, light/dark, and cache-update behavior.

### Stage 2 — Semantic colors and typography

- Replace global color/font token values while preserving their public names.
- Add explicit `accent-ink` and governed/access roles.
- Verify contrast programmatically and inspect all supported scripts.
- Deploy to staging; compare landing, login, inbox, message detail, compose, settings, and operations in
  light, dark, and system modes at phone and desktop widths.

### Stage 3 — Brand components and shells

- Apply lockups and restrained route motifs to landing/auth shells.
- Refine dashboard/settings shell surfaces, selected navigation, and primary actions through shared
  primitives rather than page-specific overrides.
- Deploy to staging; run the full visual and interaction matrix.

### Stage 4 — Production promotion

- Run `npm run verify`, `npm run e2e`, production build, and deployment dry-runs.
- Promote the exact staging-tested artifact to production.
- Run public smoke checks and confirm live manifest, icons, theme colors, and both theme modes.

Each stage is independently reversible and receives its own reviewable commit after staging approval.

## 7. Test Plan

| Layer | Coverage |
|-------|----------|
| Unit/static | canonical asset presence, metadata, manifest, offline shell, token values, no traced SVG use |
| Component | brand accessible names, decorative-image behavior, theme-aware variants |
| E2E | theme cycling/persistence, landing/auth/dashboard/settings marks, mobile overflow, PWA contract |
| Accessibility | WCAG AA contrast, focus visibility, forced-colors behavior, reduced motion |
| Visual review | light/dark/system; desktop/phone; RTL; representative non-Latin locales; installed PWA |
| Regression | compose, message reading, dense lists, dialogs, status badges, and destructive actions |

## 8. Error States and Edge Cases

- Missing brand assets must not block navigation or authentication; the text product name remains.
- Old service-worker caches and installed icons may persist temporarily; cache-version behavior is
  tested and communicated without renaming compatibility keys.
- System theme changes continue to work when no explicit preference is stored.
- Explicit light/dark preference always overrides the OS preference.
- Email HTML and user-authored content do not inherit decorative brand typography or layout rules.
- High-contrast/forced-colors mode remains usable even when brand colors are suppressed.
- Long translations and RTL layouts do not depend on the lockup's horizontal wordmark.

## 9. Out of Scope

- Functional email, routing, account, authorization, database, or API changes.
- Renaming lowercase compatibility/infrastructure identifiers.
- Importing `mantle.css` directly or serving the traced SVG files as production assets.
- A full marketing-site rewrite, animation system, or page-by-page layout redesign.
- Changing transactional email HTML beyond a separately specified branded-email-template stage.

## 10. Open Questions / Decisions

- Decision proposed: use the simplified shield/route sigil as the canonical mark; retain the primary
  lockup and secondary crest only as visual references. — 2026-09-01
- Decision proposed: construct the wordmark and tagline from live text rather than embedded artwork. —
  2026-09-01
- Decision: use `Own the route. Control the inbox.` as the public tagline; retain `Email on your
  terms.` only as historical source-package material. — 2026-09-01
- Decision proposed: keep Waypoint Amber as a rarer brand/routing signal with navy foreground text;
  use Steward Teal for routine interactive text, controls, focus, and selected states. — 2026-09-01
- Decision: F91 was committed before the F92 source and implementation commits, retaining a clean
  functional boundary. — 2026-09-01

## 11. Bug / Change Log Draft

### 2026-09-01 — Adopt the Mantle visual identity

Type: `Presentation Change`

Summary:
- Preserve the original design package and introduce a normalized, accessible Picket identity across
  application, PWA, and offline surfaces in staged, reversible slices.

Reason:
- Make the maintained product visually distinct and align daily email operations with its ownership,
  boundaries, and dependable-routing position.

Impact:
- Presentation changes only; user data, behavior, permissions, routes, and infrastructure remain
  unchanged.

## 12. Implementation Evidence

### Stage 1 — Normalized identity and PWA assets

- Introduced the app-ready shield/route mark and PWA asset pipeline; the later source-fidelity
  correction below replaced the initial four-path interpretation before production promotion.
- Added reusable decorative mark and live-text lockup components to landing, dashboard, and settings
  navigation.
- Generated regular, maskable, Apple touch, and favicon assets reproducibly from the canonical SVG.
- Updated PWA/background theme metadata and advanced the service-worker cache from v2 to v3 so
  existing installations receive the replacement assets.
- `npm run verify` passes 2,669 tests with 100% statement/branch/function/line coverage, the CRAP gate,
  and all 21 bridge tests; lint reports 38 pre-existing warnings and no errors.
- `npm run e2e` passes all 102 Chromium scenarios.
- Staging Worker version `e0aba9c6-d752-429f-8587-355c0ab6e79c` passes the 8/8 public smoke contract.
- Live visual inspection passes in light and dark desktop modes and at the mobile breakpoint with no
  horizontal overflow.

### Stage 2 — Semantic colors and typography

- Replaced the inherited neutral/blue palette with Mantle-derived light and dark semantic tokens while
  preserving every existing component-facing token name.
- Added explicit action and signal foreground roles so Waypoint Amber uses Perimeter Navy text and
  Steward Teal can safely carry routine controls in either theme.
- Added programmatic WCAG AA guards for ink, muted ink, interaction, signal, danger, success, warning,
  and information text pairs in both explicit theme palettes; all tested pairs meet at least 4.5:1.
- Loaded IBM Plex Sans for interface/body text and Plus Jakarta Sans for display hierarchy through
  `next/font`, retaining browser/system glyph fallbacks and Geist Mono for data roles.
- Added an end-to-end contract proving system → light → dark cycling and persisted dark selection.
- `npm run verify` passes 2,673 tests with 100% statement/branch/function/line coverage, the CRAP gate,
  and all 21 bridge tests; lint reports 38 pre-existing warnings and no errors.
- `npm run e2e` passes all 103 Chromium scenarios, including Arabic RTL and representative localized
  pre-land flows.
- OpenNext build and staging deployment dry-run pass. The existing warning about intentionally absent
  staging `R2_SWEEP_ENABLED` and `SEED_ENABLED` values remains unchanged.
- Staging Worker version `9fd54aa3-57f0-4856-8be0-6f83ff29f6d7` passes the 8/8 public smoke contract.
- Live desktop dark and phone-breakpoint inspections confirm the new fonts and tokens, readable action
  hierarchy, and zero horizontal overflow.

### Stage 3 — Brand components and shells

- Added a sparse code-native route/boundary motif and restricted it to spacious landing and
  authentication surfaces; authenticated mail and settings shells explicitly remain motif-free.
- Added the live-text Picket lockup and chosen public tagline to the authentication shell, with a
  compact wordmark on narrow screens and no image-baked copy.
- Applied a restrained Waypoint Amber edge to authentication cards and selected navigation states,
  while retaining Steward Teal for primary actions and selected-state surfaces.
- Replaced remaining inherited white-on-action assumptions in the landing mock and compose navigation
  with the semantic `accent-ink` role.
- Added static/component contracts for motif decoration, shared shell identity, dense-surface exclusion,
  action foregrounds, and route markers; added a browser contract for authentication identity.
- `npm run verify` passes 2,677 tests with 100% statement/branch/function/line coverage, the CRAP gate,
  and all 21 bridge tests; lint reports 38 pre-existing warnings and no errors.
- `npm run e2e` passes all 104 Chromium scenarios.
- OpenNext build and staging deployment dry-run pass with the unchanged staging-vars warning described
  in Stage 2.
- Staging Worker version `5b179eeb-71ed-4504-8770-d62abe268e2e` passes the 8/8 public smoke contract.
- Live landing and authentication inspection passes in dark desktop and phone modes. Arabic RTL uses
  the intended glyph fallback, preserves logical alignment, and has zero horizontal overflow.

### Stage 3.1 — Source-fidelity correction

- Compared all five supplied Mantle concepts and the generated application icon at original size. The
  comparison proved that the initial four-path redraw collapsed the primary mark's double-line shield,
  double chevron, and negative spaces into a materially different heavy silhouette.
- Added `mantle/derived/primary-mark-reference.png`, an exact, unscaled 290×336 crop from the supplied
  transparent primary lockup. The original package remains unchanged.
- Replaced hand-authored geometry with deterministic, aligned boundary and waypoint alpha masks. The
  application can still apply accessible light/dark semantic colors without altering a source pixel's
  coverage or the relationship between the mark's parts.
- Added pixel-level regression tests proving the crop is byte-equivalent after raw decoding and that
  the two masks are disjoint while their alpha union exactly reconstructs the source crop.
- Regenerated favicon, regular, Apple touch, and maskable assets from the source-faithful masks and
  advanced the service-worker cache to v5.
- Live staging inspection caught an older envelope icon retained at the historical unversioned URL.
  Metadata, manifest, offline, notification, and precache references now use `picket-*-v1` filenames,
  forcing browsers and installed PWAs onto the corrected assets rather than relying on cache expiry.
- `npm run verify` passes 2,679 tests with 100% statement/branch/function/line coverage, the CRAP gate,
  and all 21 bridge tests; lint reports 38 pre-existing warnings and no errors.
- `npm run e2e` passes all 104 Chromium scenarios.
- Staging Worker version `0d329dd3-3819-42fb-beb9-4ada3de4b3cb` passes the 8/8 public smoke contract.
- Live staging exposes the source-faithful mark through both aligned masks, references only the new
  versioned favicon/application/touch icons, retains LTR/RTL layout, and has zero horizontal overflow.

### Stage 4 — Production promotion

- The clean `4289e65` checkpoint and staging-proven `.open-next/worker.js` artifact were promoted
  unchanged; the artifact SHA-256 is
  `D05223BF4D44C84108A102AB62AA3BC9C5568F0C3AC2064C37BE5CC65C64BC45`.
- The production dry run validated all Worker, D1, R2, email, queue, Images, KV, asset, schedule, and
  environment bindings without applying a database migration or rewriting application data.
- Production Worker version `2b68803a-6c04-4d50-822d-75648dc0f157` is active on
  `mail.henriksen.dev`; the previous version `9a76668b-d990-4cde-be74-f9c9bb7b5dfc` remains the
  recorded rollback point.
- The 8/8 public smoke contract passes in production, including anonymous authorization boundaries.
- Live production inspection confirms the Picket title, tagline, source-faithful mark, manifest,
  `picket-*-v1` favicon/application/touch icon references, 512×512 icon dimensions, explicit light
  and dark Mantle tokens, and zero horizontal overflow.
