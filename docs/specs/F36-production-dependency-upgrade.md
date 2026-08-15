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
