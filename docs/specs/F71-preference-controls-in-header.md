# F71 — Preference Controls in the Header

> Status: `Shipped`
> Owner area: `src/components/language-switcher.tsx`, `src/components/theme-toggle.tsx`, all four shells

## 1. Problem & User Job

Language and theme lived in three different places depending on the screen. On the
landing page and the auth screens they floated over the bottom corners, pinned with
`fixed`. In the signed-in app they were rows inside the profile dropdown, two clicks
away and in a menu about mailboxes and sign-out. Nothing about either control belongs
to a mailbox, and floating controls sat on top of the content they were beside — F53
had already had to order z-indexes to stop the language selector covering the popup
composer's Send button.

**User job:** as any user, on any screen, I want to change language or theme from the
same place — the top of the page — without hunting for it or having it sit on top of
what I am reading.

## 2. User Stories & Acceptance Criteria

- Given any screen — landing, auth, mail, or admin — When it renders, Then both
  controls are in the top header.
- Given a 390px viewport, When the header renders, Then both controls fit without
  pushing anything off-screen.
- Given the popup composer is open, When I reach for Send, Then no preference control
  can be over it.
- Given the language control, When it is closed, Then it occupies an icon's width;
  When open, Then every language is listed by its own name.

## 3. Design decisions

**The language control is a real `<select>`, laid transparently over its own icon.**
The closed state is what occupies the header, so only that is compressed. Replacing
the element with a hand-built menu would have cost the platform picker on phones, the
full language names in the open list — a flag alone is a poor way to find a language
you cannot already read — and native keyboard and screen-reader behaviour. The
`opacity-0` select keeps all three and stays a `<select>`, so
`selectOption("pt")` in `locale-pwa-preland.spec.ts` continues to work unchanged.

**The trigger shows the locale code, not the flag.** Regional-indicator emoji have no
glyph on Windows and degrade to the region's letters, so English rendered as `GB` —
which names a country rather than a language, and looked different on every platform.
`EN` renders identically everywhere and is the same width.

**The landing header drops its buttons below `sm`.** Adding two controls pushed
"Create account" off a 390px viewport. The hero repeats both actions immediately
below at full width, so hiding the header pair costs nothing and the overflow goes
away without shrinking anything.

**`AuthShell` gained a header.** It had none — which is why the controls floated there
in the first place.

## 4. Test Plan

The layering test from F53 is rewritten rather than kept. It pinned the z-index
ordering between the floating language selector and the composer; with the controls in
normal flow that ordering no longer exists, and asserting the old values would test a
layout that is gone. It now asserts the stronger property the original was protecting:
neither control is `fixed`-positioned at all, so neither can overlap the composer at
any z-index.

## 5. Implementation and Verification Log

### 2026-07-26 — Local implementation

Both components collapsed to a single rendering each; the `variant` prop and its
`floating` and `inline` branches are gone, since every call site now wants the header
form. Placed in the landing header, a new `AuthShell` header, and the dashboard and
admin headers beside Help and the mailbox selector.

Caught by rendering rather than by tests: the flag emoji fallback (`GB`), and the
landing header overflowing at 390px with "Create account" clipped.

**Verification:** `npm run verify` — 167 files, 1,488 tests, 100% configured coverage,
lint clean. Mocked E2E 46 passed, including the two locale-switching tests unchanged;
local E2E 47 passed. All four surfaces captured at 1280px and 390px in light and dark.

### 2026-08-01 — Deployed

Deployed to production. This entry records the deployment only; the locale-switching and
non-fixed-position contracts remain local gates, and no separate production audit was
performed.
