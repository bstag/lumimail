# F35 — PWA Installability

> Status: `Shipped`
> Owner area: `public/`, `src/app/layout.tsx`, `src/components/service-worker-registration.tsx`, `src/middleware.ts`

## 1. Problem & User Job

Lumimail is responsive, but mobile users cannot install it as a standalone app
or get a predictable offline entry point. This feature lets mailbox owners and
admins add Lumimail to the home screen on iOS and Android while keeping mailbox
data network-only.

## 2. User Stories & Acceptance Criteria

- As a mobile mailbox owner, I can install Lumimail from the browser so that it
  launches like a standalone app.
- As an admin, I can open an installed Lumimail app while offline and see a
  branded reconnect shell instead of a browser error.
- Given the app is installed, when the device is offline, then navigations fall
  back to a generic offline shell without showing cached mailbox data.
- Given an API, auth, or mutating request is made, when the service worker sees
  it, then the request is passed to the network and its response is not cached.

## 3. Scope Boundaries

**In scope:**
- Web app manifest and install-size icons, including maskable icons.
- iOS home-screen metadata and Apple touch icon.
- Browser service worker registration.
- Static offline shell/fallback and conservative static asset caching.
- Tests for manifest, icons, headers, and service worker cache policy.

**Out of scope:**
- Offline message reading, sending, drafts, background sync, push notifications,
  mailbox persistence, or API response caching.
- Auth/session redesign.
- Deployment, PR creation, or Lighthouse CI wiring.

## 4. Data Model

No database tables are read or written.

| Table | Columns touched | Notes |
|-------|------------------|-------|
| N/A | N/A | Static PWA assets only. |

## 5. API Contract

No new API routes are added.

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| N/A | N/A | N/A | N/A | N/A | N/A |

## 6. UI/UX

- Routes: global layout only.
- Components touched: root layout and a null-rendering service worker
  registration component.
- Offline fallback: `public/offline.html` uses the existing Lumimail icon,
  app colors, and a short reconnect message.
- Mobile notes: manifest uses standalone display; iOS gets Apple touch icon and
  mobile web app metadata.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/pwa-static-assets.test.ts` | Manifest values, icon files/dimensions, static headers, and real `public/sw.js` install/activate/fetch behavior in a VM sandbox. |
| E2E | `tests/e2e/pwa.spec.ts` | Manifest is linked, service worker registers, and offline navigation returns the offline shell. |
| E2E | `tests/e2e/locale-pwa-preland.spec.ts` | Flat routes return 200, locale cookie switching survives reloads, Arabic remains RTL, and mobile web app metadata is not duplicated. |
| Runtime smoke | OpenNext/Cloudflare preview | `/` and `/sw.js` return 200, with `Service-Worker-Allowed: /` on the service worker response. |

Coverage target: no new runtime logic files are added under the covered
`src/**/*.ts` globs. Static PWA behavior is covered through file-contract tests.

## 8. Current Behavior

Lumimail serves a favicon and two small PNG icons (`48x48`, `96x96`). It does
not serve a manifest, Apple touch icon, install-size icon set, service worker, or
offline fallback.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| Offline navigation | Offline shell prompts the user to reconnect. | 200 from cached shell | No |
| Offline API/auth request | Browser/client request fails normally. | Network failure | No |
| Unsupported service worker browser | App runs as a normal website. | N/A | No |

## 10. Edge Cases

- Non-GET requests are never cached.
- `/api/**`, auth routes, Next data routes, and route handlers that can expose
  mailbox data are never cached.
- Cross-origin requests are never cached by Lumimail's service worker.
- Failed navigations receive only the generic offline shell.
- Static `/_next/static/**` assets can be cached, but document responses are
  network-only to avoid storing authenticated pages.
- The service worker file must not be immutable-cached so updates can roll out.

## 11. Permissions & Security

No new permission is introduced. The service worker must never persist API
responses, mailbox/message/attachment data, auth/session responses, or mutating
request responses. Offline support is limited to static shell assets.

## 12. Open Questions / Decisions

- Decision: Use `public/` for manifest, icons, service worker, and offline
  shell to stay compatible with Next App Router and OpenNext/Cloudflare Workers.
  Date: 2026-07-03.
- Decision: Return a generic offline HTML shell for failed navigations instead
  of caching authenticated route HTML. Date: 2026-07-03.
- Decision: Generate install-size PNGs from the existing envelope mark rather
  than introducing a new asset pipeline or dependency. Date: 2026-07-03.
- Decision: Keep locale selection cookie-based on the current route rather than
  rewriting to missing locale-prefixed routes, because the PWA `start_url` must
  load `/`. Date: 2026-07-03.

## 13. Final Behavior

- `public/manifest.webmanifest` exposes Lumimail install metadata with standalone
  display, `/` start URL/scope, theme/background colors, and any/maskable PNG
  icons at install sizes.
- `src/app/layout.tsx` publishes manifest, icon, Apple touch icon, iOS web-app,
  theme color, and viewport metadata.
- `src/components/service-worker-registration.tsx` registers `/sw.js` on secure
  origins and localhost.
- `public/sw.js` precaches only public PWA shell assets, caches safe static
  assets, keeps documents network-only, and returns `public/offline.html` for
  failed GET navigations.
- API routes, auth paths, Next data paths, non-GET requests, cross-origin
  requests, and mailbox/admin data routes are never cached by the service worker.
- `src/middleware.ts` preserves CSRF checks while avoiding locale rewrites to
  non-existent routes so `/` remains a valid PWA start URL.

## 14. Bug / Change Log

### 2026-07-04 — Pre-land PWA hardening

Type: `Test`

Summary:
- Exercise the real service worker in unit tests and add targeted locale/PWA
  metadata E2E coverage for the flat-route PWA start URL.

Reason:
- Pre-land review requires proof that removing next-intl URL rewrites keeps
  locale switching intact and that the Cloudflare target serves the service
  worker with the expected scope header.

Impact:
- The installable PWA path now has direct regression coverage for safe service
  worker caching, locale reload behavior, RTL rendering, and duplicate mobile
  metadata.

Tests:
- `npx vitest run tests/unit/pwa-static-assets.test.ts`
- `PLAYWRIGHT_PORT=3100 npx playwright test tests/e2e/locale-pwa-preland.spec.ts --project=chromium --workers=1`
- `PLAYWRIGHT_PORT=3100 npm run e2e`

### 2026-07-03 — Installable PWA shell

Type: `Feature`

Summary:
- Add manifest, install icons, iOS metadata, service worker registration, and an
  offline shell.

Reason:
- GitHub issue 24 requests mobile installability and offline shell behavior.

Impact:
- Users can install Lumimail on mobile and get a safe offline fallback.

Tests:
- `npm run verify` passed on 2026-07-03.
- `PLAYWRIGHT_PORT=3100 npm run e2e` passed on 2026-07-03.

Notes:
- Offline mailbox access remains out of scope.
