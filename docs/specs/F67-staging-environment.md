# F67 — Staging Environment

> Status: In Progress — configuration and tooling built; blocked on the staging domain and token
> Owner area: `wrangler.jsonc`, `scripts/`, `tests/staging/`

## 1. Problem & User Job

Every remaining verification in the MVP has needed the operator to perform it by hand:
send a message, click a link, watch an inbox. That has been the rate limiter for days,
and it means each check happens once rather than on every change.

Two specific things are blocked without a live environment that is not production:

- **Inbound behaviour cannot be tested automatically.** Routing, forwarding, group
  fan-out, and the vacation responder are all driven by real mail arriving. They cannot
  be exercised by the Playwright suite, which mocks the API, nor by unit tests, which
  mock the queue.
- **The backup gate cannot be closed.** Restoring is only proven once it has been done
  into a live environment. Doing that against production is not a rehearsal, it is an
  outage.

A staging deployment gives both: a place to originate and receive real mail between
domains under our control, and a target to restore into.

## 2. Resources

| Resource | Production | Staging |
|---|---|---|
| Worker | `lumimail` | `lumimail-staging` |
| D1 | `lumimail-prod` | `lumimail-staging` |
| R2 | `lumimail-raw-prod` | `lumimail-raw-staging` |
| Queues | `lumimail-{inbound,outbound,outbound-dlq}-prod` | `…-staging` |
| Cron | every minute | every minute |
| Route | `mail.henriksen.dev` | `lumimail-staging.<subdomain>.workers.dev` |

Configured as a Wrangler environment (`env.staging`), so one config describes both and
`wrangler deploy --env staging` cannot accidentally target production bindings.

A `workers.dev` route avoids needing a hostname for the UI. Only *mail* routing needs a
real domain, which is the decision below.

## 3. The zone isolation decision — read before creating anything

Lumimail does not only read Cloudflare configuration, it **writes** it. Domain
onboarding provisions Email Routing rules, and F46 provisions a **catch-all** per zone.
A staging instance pointed at a zone that production also serves can therefore rewrite
the routing that carries real mail. The specific failure: staging onboards
`lucidkith.com`, provisions a catch-all to `lumimail-staging`, and every message to that
domain stops reaching production.

That is not a hypothetical — it is the ordinary behaviour of the onboarding flow.

Three ways to avoid it:

**A. Dedicated staging domain (recommended).** Register a cheap domain used only for
staging, and scope staging's `CF_TOKEN` to that zone. Production zones become
unreachable from staging by construction rather than by discipline. Costs roughly a
domain registration per year. Also allows testing domain-to-domain flow *within*
staging, since a second staging domain can be added later or a subdomain used as the
second party.

**B. Shared zones with explicit addresses only.** Add a handful of literal Email Routing
rules such as `staging1@lucidkith.com` pointing at the staging Worker; exact rules take
precedence over the production catch-all. No new cost. **But** staging's token can still
write to the production zone, so the protection is convention, not enforcement — and the
catch-all hazard above remains one onboarding click away. Sending would also originate
from the real domain, putting its reputation at risk during failure testing.

**C. Staging with no inbound.** Skip mail routing; test the API and UI only. Cheapest,
and worthless for the things that actually need testing, since those are all inbound.

**Recommendation: A.** The cost is small and it converts a discipline problem into a
structural one. B is viable only if staging's token is separately scoped to exclude
production zones, which is most of A's work without A's safety.

**Decided 2026-07-25: option A.** Staging gets its own domain and its own zone-scoped
token. Production zones are unreachable from staging by construction.

## 4. Data Model

None. Staging uses the same schema, created by running the same migrations against the
staging database.

## 5. API Contract

Unchanged. Staging exposes the same API at a different origin.

## 6. UI/UX

Identical. A visible environment banner is worth adding so a staging tab is not mistaken
for production, but that is a follow-on rather than a prerequisite.

## 7. Test Plan

Staging enables a class of test the current suites cannot express: real mail, end to end.

| Layer | Location | What it covers |
|-------|----------|-----------------|
| Staging integration | `tests/staging/` | Send from one staging mailbox to another and assert arrival, threading, and attachment bytes. |
| Staging integration | `tests/staging/` | Forwarding to a verified destination; group fan-out to several mailboxes; catch-all versus exact precedence. |
| Staging integration | `tests/staging/` | Vacation responder: exactly one reply between two enabled responders, and the frequency window on a second message. |
| Staging integration | `tests/staging/` | Restore rehearsal: restore a production backup into the staging database and assert integrity. |

These run against a deployed environment rather than in Vitest's mocked world, so they
are excluded from `npm run verify` and run on demand. They need an API key for a staging
account, supplied by environment variable — never committed.

Delivery is asynchronous, so assertions poll with a timeout rather than assuming
immediate arrival. A test that waits forever is worse than one that fails.

## 8. Current Behavior

There is one environment. Every inbound verification is manual, and the backup gate has
no live target that is not production.

## 9. Error States

| Condition | Result |
|---|---|
| Staging token can reach a production zone | **Design failure.** Option A prevents it; the others rely on care. |
| Staging deploy run without `--env staging` | Would target production bindings. The environment block makes this an explicit flag rather than a default. |
| Staging queue consumer stalls | Staging only; production is unaffected because the queues are separate resources. |

## 10. Edge Cases

- Staging and production must never share a queue, bucket, or database, or a staging test could consume production work.
- The staging cron runs the same retention sweep. `R2_SWEEP_ENABLED` should start unset there too, for the same reason it did in production.
- A restore rehearsal into staging overwrites staging data; that is the point, but it means staging state is disposable and must not accumulate anything worth keeping.
- Staging sending needs Email Sending enabled on the staging zone, which is a separate provisioning step from routing.

## 11. Permissions & Security

- Staging holds its own secrets. `CF_TOKEN` for staging must be a **separate token**, scoped to the staging zone only; reusing the production token defeats the isolation this exists to provide.
- Restoring production data into staging copies real message bodies and password hashes into a second environment. Either restore only for a rehearsal and then clear it, or scrub before loading. Treat staging as production data whenever a real backup has been restored into it.
- Staging must not be exposed as though it were production; the environment banner in §6 matters more once real data is present.

## 12. Open Questions / Decisions

- Decision: option A in §3 — a dedicated staging domain with a zone-scoped token. Isolation becomes structural rather than a matter of remembering. — 2026-07-25
- Decision: staging holds **synthetic accounts**, created by `scripts/seed-staging.mjs`. No production message bodies or password hashes are copied into a second environment, and tests own fixtures they are free to destroy. A restore rehearsal into staging remains possible later for the backup gate, but is then an explicit act with its own cleanup rather than the standing state. — 2026-07-25
- Decision: use a Wrangler environment rather than a second config file, so the two cannot drift and deploying to production stays the unflagged default. — 2026-07-25
- Decision: staging integration tests are excluded from `npm run verify`. They need a deployed environment and real delivery latency, and a suite that cannot run offline must not gate ordinary development. — 2026-07-25

## 14. Setup sequence

Steps marked **operator** need a purchase or a credential and cannot be automated here.

1. **Operator:** register the staging domain and add the zone to Cloudflare.
2. **Operator:** enable Email Routing on the zone, and Email Sending if outbound is to be tested.
3. **Operator:** create an API token scoped to *that zone only*, with Email Routing edit permission. Do not reuse the production token — §3 is the whole reason this environment exists.
4. Create the resources:

   ```bash
   wrangler d1 create lumimail-staging
   wrangler r2 bucket create lumimail-raw-staging
   wrangler queues create lumimail-inbound-staging
   wrangler queues create lumimail-outbound-staging
   wrangler queues create lumimail-outbound-dlq-staging
   ```

5. The repository now records the resolved staging D1 UUID in `wrangler.jsonc`; set
   `PASSWORD_RESET_FROM` only when a dedicated staging sending domain is introduced.
6. **Operator:** `wrangler secret put CF_TOKEN --env staging` with the token from step 3.
7. Apply migrations and deploy:

   ```bash
   wrangler d1 migrations apply DB --env staging --remote
   npx opennextjs-cloudflare build && wrangler deploy --env staging
   ```

8. Set `PUBLIC_APP_URL` to the deployed `workers.dev` origin and redeploy.
9. Seed synthetic accounts:

   ```bash
   node scripts/seed-staging.mjs --domain <staging-domain> --password '<throwaway>'
   ```

10. Point the staging zone's Email Routing catch-all at `lumimail-staging`.

## 13. Bug / Change Log

### 2026-07-25 — Staging environment configuration and seeding

Type: Feature

Summary:

- Add `env.staging` to `wrangler.jsonc` and the example, redeclaring every binding.
- Add `scripts/seed-staging.mjs` to create synthetic accounts, including a shared mailbox with two members.

Reason:

- Every remaining inbound verification has required an operator by hand, and the backup gate has no live restore target that is not production. Tracked as R-18/R-17 follow-on.

Impact:

- No production behaviour changes. A dry run confirms production still resolves to `lumimail-prod` and `lumimail-raw-prod`.
- Nothing is deployed: the environment is configuration until the domain and token exist.

Notes:

- Every binding is redeclared in the environment because Wrangler replaces binding arrays rather than merging them. An omitted array would silently inherit the production resource — precisely the accident this environment exists to prevent.
- Production remains the unflagged default, so `wrangler deploy` cannot accidentally mean staging.
- The seed writes rows directly rather than registering through the API, because registration triggers Cloudflare provisioning per domain and the seed is establishing the state those flows assume.
- The first attempt at splicing the environment into both configs produced mismatched braces, caught by parsing both files before going further.
