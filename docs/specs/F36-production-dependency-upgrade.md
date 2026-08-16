# F36 — Production dependency upgrade

## Current behavior

- The application pins Next.js and `eslint-config-next` at `16.2.10`.
- `@opennextjs/cloudflare` resolves to `1.20.1`, whose current compatible release requires Next.js `16.2.11` or newer.
- DOMPurify is pinned at `3.4.11`, which is affected by GHSA-c2j3-45gr-mqc4.
- The production dependency audit reports additional transitive advisories, including Sharp/libvips and build-tool dependencies.
- The existing application passes `npm run verify` and an OpenNext Cloudflare build.

## Desired behavior

- Upgrade direct dependencies to the smallest current compatible patch releases that remove directly actionable production advisories.
- Preserve application behavior and Cloudflare deployment configuration.
- Produce a reproducible lockfile with no peer-dependency conflict between Next.js and OpenNext.
- Document any advisories that cannot safely be removed without an upstream or breaking upgrade.

## Decisions

- Prefer patch/minor upgrades within the architecture already used by the repository.
- Do not use `npm audit fix --force` or accept an automatic Next.js downgrade.
- Treat HTML sanitization dependencies as production-critical because inbound email HTML is untrusted.
- Do not change application behavior as part of this upgrade.

## Edge cases and error states

- OpenNext may reject an otherwise valid Next.js release through its peer dependency range.
- A dependency may fix an advisory only in a version outside the current declared range.
- Some reported packages may be build-time-only even when npm includes them in a production-tree audit.
- The OpenNext build may require authenticated remote bindings and may behave differently on Windows.

## Test plan

- Run `npm install` and confirm the dependency tree resolves without peer errors.
- Run `npm audit --omit=dev` and record remaining advisories.
- Run `npm run verify`.
- Run `npx opennextjs-cloudflare build` using the authenticated Cloudflare environment.
- Run a Wrangler deployment dry run against the generated `.open-next` output.

## Bug/Change Log entry draft

- Upgraded the Next.js/OpenNext deployment stack and DOMPurify to compatible patched releases, refreshed the lockfile, and verified the application and Cloudflare bundle.

## Open questions

- Which future supported Next.js/OpenNext release will move its bundled Sharp and PostCSS dependencies beyond the remaining advisory ranges?

## Final behavior

- Next.js and `eslint-config-next` are pinned at `16.3.0`.
- `@opennextjs/cloudflare` resolves to `1.20.2` with `@opennextjs/aws` `4.1.0`.
- DOMPurify is pinned at the patched `3.4.12` release.
- Wrangler is pinned at the smallest patched stable release, `4.114.0`; its Miniflare dependency is constrained to patched Undici `7.29.0` through npm overrides.
- Safe transitive audit fixes were applied without `--force`.
- Next.js 16.3.0 supplies patched PostCSS and Sharp versions, and compatible brace-expansion patch releases are locked transitively.
- As of 2026-08-06, both the complete root audit and `npm audit --omit=dev` report zero known vulnerabilities.

## Verification

- `npm run verify`: passed on the final graph (193 application files, 1,759 tests, 100% configured coverage; 21 bridge tests; existing lint warnings only).
- `npx opennextjs-cloudflare build`: passed on Next.js `16.3.0` and OpenNext `1.20.2`.
- `npx wrangler deploy --dry-run`: passed on Wrangler `4.114.0`; all production bindings were resolved.
- `npm audit`, `npm audit --omit=dev`, and the bridge production audit: zero known vulnerabilities on 2026-08-06.

## 2026-08-15 Node runtime floor correction

### Current behavior

- The root manifest declares Node `>=22`, while the locked Babel 8 build dependencies
  require Node `^22.18.0 || >=24.11.0`.
- Node 22.16 can install with engine warnings, and an interrupted npm repair can leave
  `node_modules/.bin` incomplete, making the pinned Wrangler/OpenNext commands appear
  missing.
- The doctor and release-metadata checks compare only the Node major version, so they
  cannot enforce a minor/patch runtime floor truthfully.

### Desired behavior

- Declare and consistently enforce Node `^22.18.0 || >=24.11.0` in the manifest,
  lockfile, doctor, and release pipeline, while pinning the tested local/CI line to
  Node `22.18.0`.
- Compare complete major/minor/patch versions and fail closed for malformed versions or
  Node 22.17 and earlier.
- Keep the repository-pinned Wrangler and OpenNext executables; do not replace them
  with floating global or unqualified `npx` installs.

### Edge cases and error states

- Node versions may include a leading `v` and prerelease/build suffixes; only the
  numeric core participates in the minimum comparison.
- A malformed engine string or runtime version fails readiness/release derivation.
- Node 23 and Node 24.0 through 24.10 fail because the locked dependencies do not
  support them; Node 24.11 and newer pass. The deploy environment should stay on the
  tested Node 22 line until separately verified.

### Test plan

- Add unit coverage for exact-minimum, below-minimum, newer-major, and malformed Node
  versions in doctor and release metadata.
- Verify the manifest, lockfile, `.nvmrc`, and CI version remain aligned.
- Run `npm run verify` under Node 22.18 or newer; do not claim the local gate passed
  while the executing runtime remains Node 22.16.

### Bug / Change Log entry draft

- Raised the declared Node floor to 22.18.0, aligned CI/local version hints, and taught
  operational release checks to enforce full semantic versions rather than only the
  major number.

### Final behavior and verification

- `package.json` and the root lockfile package declare `^22.18.0 || >=24.11.0`;
  `.nvmrc` and CI pin the tested runtime to Node 22.18.0.
- Doctor and release metadata compare the complete numeric Node version. Release
  metadata also normalizes an optional leading `v` before writing the manifest.
- Focused runtime/release tests passed: 72 tests across three files.
- `npm run verify` passed typecheck and lint (with existing warnings), then ran 2,554
  tests. Two unrelated existing queue-contract tests failed because `wrangler.jsonc`
  does not yet declare `EXTERNAL_SYNC_QUEUE` and `EXTERNAL_SYNC_DLQ_QUEUE`; 2,552 tests
  passed. The IMAP bridge test step did not run after that failure.
- The executing workstation remains on Node 22.16.0 and must be upgraded before the
  deploy command is run under the newly declared supported runtime.
