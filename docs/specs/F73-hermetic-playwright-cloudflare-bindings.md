# F73 — Hermetic Playwright Cloudflare Bindings

> Status: Shipped (local)

## 1. Problem & User Job

Playwright scenarios complete their browser assertions but the command does not
exit. `next dev` loads the production Wrangler configuration through
`initOpenNextCloudflareForDev()`, sees the Email Service binding marked
`remote: true`, and starts an authenticated Wrangler remote-binding proxy.
Credential-free and noninteractive test runs cannot initialize that proxy, so it
rejects asynchronously and prevents clean web-server teardown.

Contributors need `npm run e2e` to run hermetically, exit on its own, and never
connect to production Cloudflare services or send real email.

## 2. Current Behavior

- `playwright.config.ts` starts `npm run dev`.
- `next.config.ts` correctly calls `initOpenNextCloudflareForDev()`.
- The default and staging `send_email` bindings in `wrangler.jsonc` declare
  `remote: true`.
- Wrangler therefore requires `CLOUDFLARE_API_TOKEN` during ordinary Next.js
  development even when every application API request is mocked.
- In sandboxed Windows runs, Wrangler's default registry/log directory under
  `%APPDATA%` is not writable, which independently leaves the dev helper in a
  rejected state.

## 3. Desired Behavior

- Local Next.js development and Playwright use Wrangler's local binding
  simulations by default.
- The Playwright command exits after its scenarios complete without a Cloudflare
  account or API token.
- Deployments retain the `EMAIL` binding and production delivery behavior.
- Browser tests cannot send real email.
- Playwright gives its managed dev server a writable, ignored Wrangler
  configuration directory inside `.wrangler/`.
- The fully mocked suite does not start OpenNext's binding helper. Normal
  development and `npm run e2e:local` continue to initialize local bindings.

## 4. Scope Boundaries

In scope:

- Local/Playwright binding mode in `wrangler.jsonc`.
- Automated configuration regression coverage.
- Test and MVP documentation that currently records the hang.

Out of scope:

- Changing deployed Email Service binding names or provider behavior.
- Testing binary Email Service attachments in the local simulator.
- Requiring Cloudflare credentials for the mocked browser suite.

## 5. Decisions

- Omit `remote` from the Email Service binding in both default and staging
  configurations. Wrangler treats bindings as local simulations during local
  development, while deployed Workers still receive the configured binding.
- Do not create a duplicate Playwright Wrangler file: the safe default for all
  local development is simulated email, and a separate config would allow the
  two binding contracts to drift.
- Set `XDG_CONFIG_HOME` only on Playwright's managed web-server process. This
  keeps Wrangler state writable without changing the developer's global CLI
  configuration or leaking state into source control.
- Gate `initOpenNextCloudflareForDev()` with a test-server environment flag.
  Playwright derives the flag from the supported npm lifecycle: `e2e:local`
  needs real local bindings, while the default mocked `e2e` suite does not.
- Production-like testing that intentionally sends real email must use a
  deployed disposable environment rather than ordinary `next dev`.

## 6. Edge Cases and Error States

- The local Email Service simulator cannot serialize binary attachment
  `ArrayBuffer` values. Provider translation remains unit-tested, and real binary
  delivery requires a deployed environment.
- D1, R2, and queue bindings remain local because they are not marked remote.
- A future `remote: true` binding would reintroduce credentialed test startup and
  must fail the configuration contract test.

## 7. Test Plan

- Add a unit contract proving the active Wrangler file contains no remote
  bindings, retains the `EMAIL` binding, and gives Playwright a workspace-local
  Wrangler configuration directory.
- Run the focused contract test.
- Run a focused Playwright scenario and prove the process exits with code zero.
- Run `npm run verify`.
- Run the full mocked `npm run e2e` suite.

## 8. Bug / Change Log

### 2026-07-29 — Remove the credentialed Playwright remote proxy

Type: Bug.

Status: Implemented and verified locally.

Requested:
- Fix the Playwright process hanging after browser assertions complete.

Implemented:
- Removed remote Email Service mode from local development while retaining the
  deployed `EMAIL` binding in both default and staging environments.
- Gave Playwright-owned Wrangler helpers an ignored writable configuration
  directory.
- Skipped OpenNext binding initialization for the fully mocked suite while
  retaining it for normal development and `npm run e2e:local`.
- Replaced Playwright's hanging Windows `webServer` teardown with a bounded
  global setup that reuses a healthy server or starts Next.js directly, then
  terminates the exact process tree on Windows and the process group elsewhere.
- Added a configuration regression test.

Verification:
- The focused lifecycle test exits with code zero in 3.7 seconds.
- All 49 mocked Chromium scenarios pass and the command exits cleanly in 17.2
  seconds without Cloudflare credentials.
- The now-completing suite exposed a separate remote-image reader regression;
  F34 restores the CID-only browser defense and the hostile HTML scenario passes.
- `npm run verify` passes with 1,532 application tests at 100% configured
  coverage plus all 16 bridge tests; lint reports 25 existing warnings and no
  errors.
