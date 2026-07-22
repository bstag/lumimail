# F37 — Registration domain response handling

## Current behavior

`POST /api/setup/domain` uses the shared API response helpers and returns success data as `{ success: true, data: { domain } }` and errors as `{ success: false, error: { message } }`. The registration client casts the entire response body directly to `DomainSetupResult`, so a successful domain setup is displayed as a failure because `domain` is not top-level.

## Desired behavior

- Normalize the shared API envelope in the registration client.
- Return the inner domain data to the form on success.
- Return the nested API error message to the form on failure.
- Preserve the existing `submitPrimaryDomain` result contract used by the component.

## Edge cases and error states

- A successful response without domain data remains unusable and is handled by the component as failure.
- A failed response without a structured message falls back to the existing localized generic error.

## Test plan

- Add a unit test for an enveloped successful domain response.
- Add a unit test for an enveloped API error.
- Run `npm run verify`.
- Build and deploy the Cloudflare bundle.

## Bug/Change Log entry draft

- Fixed first-run registration incorrectly reporting “Domain setup failed” after Cloudflare successfully provisioned the domain.

## Final behavior

- `submitPrimaryDomain` unwraps successful shared API envelopes before returning domain data to the registration form.
- Structured API error messages are normalized to the existing client error contract.
- Missing success data and missing error messages retain the form's existing generic fallback behavior.

## Verification

- `npm run verify`: passed (105 files, 845 tests, 100% coverage; existing lint warnings only).
- OpenNext Cloudflare production build: passed.
- Deployed to `mail.henriksen.dev` as Worker version `a31bdb64-c918-479f-bb56-8d9db5f50dec`.
