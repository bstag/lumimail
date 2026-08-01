# F68 — UI Geometry Consistency

> Status: `Shipped`
> Owner area: `src/components/ui/*`, `src/app/globals.css`, `src/app/(admin)/**`, `src/app/(dashboard)/**`

## 1. Problem & User Job

[F53](./F53-theme-token-consistency.md) made every colour flow through a semantic
token, and that has held — an audit found zero raw Tailwind palette colours in `src/`.
Geometry never got the same treatment. Sizing, spacing, and layout are decided per
file, so equivalent controls disagree with each other and pages disagree about how
wide their content is.

Measured from computed styles rather than read from class lists:

| Control | State before |
|---------|--------------|
| `Input` | 36px tall, 6px radius, `--border-strong`, `--surface-raised` — consistent everywhere |
| `<select>` | 40px ×7, 38px ×1, 28px ×2; backgrounds transparent ×4, `--surface` ×4, `--surface-subtle` ×2; `--border` on all ten |
| `Button` | five radii (full, 12px, 16px, 8px, 0), five heights, three font sizes |

There is no `Select` primitive: 19 raw `<select>` elements are styled by hand. Where a
select sits beside an input on one row — Domain/Pattern and Action/Priority on
`/routing` — the two controls are visibly different heights with different border
weights.

Page layout disagrees the same way. The admin `<main>` has `padding: 32px 48px` and
`border-radius: 24px 24px 0 0`; the dashboard `<main>` has no padding and
`24px 0 0 0`, so moving between Mail and Admin changes the container's shape and
whether content is inset. Within the admin section, content right edges measure 1232,
1072, and 976 at a 1280px viewport because `max-w-*` is chosen per page. On
`/settings`, one card measures 608px wide while the three below it measure 672px.

**User job:** as any user, controls of the same kind should look and align the same
way, and moving between pages should not shift the content frame under me.

## 2. User Stories & Acceptance Criteria

- Given any two form controls of the same kind on any page, When they render, Then
  they share height, border colour, background, and corner radius.
- Given a select and a text input on the same row, When they render, Then their top
  and bottom edges align.
- Given any page in a section, When it renders, Then its content occupies the same
  horizontal bounds as every other page in that section.
- Given the `/settings` page, When it renders, Then every card shares the same left
  and right edge.
- Given a modal in dark mode, When it opens, Then the page behind it is dimmed rather
  than lightened.
- Given a modal taller than the viewport, When it opens, Then it stays within the
  viewport and scrolls internally.

## 3. Scope Boundaries

**In scope:** a `Select` primitive matched to `Input`; one button radius; one page
container per section; a shared page header; removing the inert `[data-slot=…]` block;
the dialog scrim and dialog height constraint.

**Out of scope:** redesigning the visual language, changing the token palette, the
mail list's full-bleed rows (deliberate, and the reason the dashboard `<main>` is
unpadded), and `rounded-full` icon buttons (a distinct shape, not a rectangular button
with the wrong radius).

## 4. Design decisions

**One radius scale.** Cards and inputs are 6px, dialogs 8px. Buttons were 12px/8px
depending on size, which is why a button never lines up with the input beside it.
Rectangular buttons become 6px so a button and an input in one row share a silhouette.
Circular icon buttons keep `rounded-full`.

**Selects match inputs exactly.** `36px`, `6px`, `--border-strong`, `--surface-raised`
— the same values as `Input`, because a select *is* an input as far as a form row is
concerned. A `sm` size (28px) exists for the compact in-row controls on `/members`,
and matches `Button`'s `sm`.

**`[data-slot]` rules are deleted, not wired up.** `globals.css` styled
`[data-slot="card"|"dialog-content"|"input"|"button"]`, but no component in the
codebase sets `data-slot` — the whole block was inert. Its values were separately
duplicated in the primitives as Tailwind classes, which is why most of them appeared
to work. Buttons already disagreed: the CSS asked for 6px and the component shipped
12px. Rather than restore a second source of truth, the primitives become the only
one.

## 5. Test Plan

Consistency is asserted from **computed styles in a real browser**, not from class
strings, because the defects here were invisible in the source and only measurable
once rendered. `tests/e2e-local/design-consistency.spec.ts` sweeps a set of pages and
asserts:

- every enabled `<select>` shares one geometry with every text `<input>` of the same size
- every rectangular button shares one corner radius
- the dialog scrim darkens rather than lightens, in both light and dark
- every card on `/settings` shares left and right bounds
- every page in a section shares the same content bounds

These are contracts rather than snapshots: they fail on divergence, not on
redesign, so restyling deliberately does not break them but drifting does.

## 6. Implementation and Verification Log

### 2026-07-25 — Local implementation

Written test-first: the five contracts were added before any fix and four of them
failed, reproducing the audit exactly — `background at 40px`,
`radii in use: 12px,16px,0px`, `card bounds: 288-896,256-928,…`, and
`frames: /mailboxes=304-1232,/routing=304-976,/aliases=304-1072,…`.

The scrim contract initially **passed on the broken case**. It parsed the declared
colour, and Chrome reports these as `oklab(...)`, whose first channel is lightness —
so a naive numeric parse read a near-white scrim as near-black. It was rewritten to
composite the scrim over white on a canvas and read the resulting pixel, which asks
the question the requirement actually asks. It then failed in dark at luminance 252
(white, untouched) and passed in light.

Changes:

| Area | Change |
|------|--------|
| Scrim | `bg-[var(--ink)]/20` → `bg-black/40`, matching the sidebar overlays |
| Dialog | `max-h` + internal scroll; removed the one `sm:max-w-md` override so all dialogs are 520px |
| Select | New `src/components/ui/select.tsx` with `Input`'s geometry; all 19 raw selects converted |
| Button | Radius moved to the base and set to 6px; `h-10/h-8` → `h-9/h-7` to match `Input` |
| `globals.css` | Deleted the inert `[data-slot=…]` block |
| `/settings` | `CurrentMailboxForm` no longer wraps itself in `max-w-2xl p-8` inside the page's own `max-w-2xl` |
| Admin frame | Content column bounded once in the layout; per-page `max-w-*` removed |
| Content inset | Dashboard content pages moved from `p-8` to the admin shell's `px-4 py-6 sm:px-12 sm:py-8` |
| Shells | Dashboard `<main>` `rounded-tl-3xl` → `rounded-t-3xl` |
| Headers | New `PageHeader`; `/members` was an `h2` at `text-xl`, so that page had no `h1` at all |
| Colour | `#1a1a1a` swatch ring → `var(--ink)`; last three `[var(--x)]` usages outside `ui/` → utilities |
| `.editorconfig` | `indent_style` → `tab`; it asked for spaces while 430 of 462 source files use tabs |

Removing `p-8` from the settings form initially left that page flush against the
header, because the dashboard shell is deliberately unpadded so the mail panes can run
full-bleed — the form's own padding had been standing in for the page's. Caught in the
rendered screenshot, not by the contracts, which only assert agreement between
elements and had nothing to disagree about.

**Verification:** `npm run verify` — 164 files, 1,463 tests, 100% configured coverage,
lint clean. Mocked E2E 46 passed; local E2E 38 passed, including the 9 new contracts.
Thirty pages re-captured in light and dark at 1280px and 390px and compared against
the pre-change captures.

**Not done:** `bulk-message-toolbar.tsx` keeps a raw `<select>`. It is a borderless
inline menu affordance rather than a form field, and giving it a field's box would
make it look like an input in a toolbar. Four admin pages still inline their own
`<h1>` rather than using `PageHeader` — they already use the canonical style, and
converting them means restructuring header rows that host dialog triggers.

### 2026-08-01 — Deployed

Deployed to production. This entry records the deployment only; the nine computed-style
contracts remain a local gate, and no separate production styling audit was performed.
