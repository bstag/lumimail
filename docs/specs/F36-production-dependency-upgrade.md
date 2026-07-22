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

- Next.js and `eslint-config-next` are pinned at `16.2.11`.
- `@opennextjs/cloudflare` resolves to `1.20.2` with `@opennextjs/aws` `4.1.0`.
- DOMPurify is pinned at the patched `3.4.12` release.
- Wrangler is updated to `4.113.0` and Cloudflare Workers types to `5.20260722.1`.
- Safe transitive audit fixes were applied without `--force`.
- The production audit still reports eight transitive findings in Next.js-bundled PostCSS and Sharp/libvips. npm proposes an invalid forced downgrade to Next.js 9, so these remain documented pending an upstream compatible release.

## Verification

- `npm run verify`: passed (105 files, 843 tests, 100% configured coverage; existing lint warnings only).
- `npx opennextjs-cloudflare build`: passed on Next.js `16.2.11` and OpenNext `1.20.2`.
- `npx wrangler deploy --dry-run`: passed; all production bindings were resolved.
- `npm audit --omit=dev`: eight remaining transitive findings (three moderate, five high), with no safe non-forced resolution currently offered.
