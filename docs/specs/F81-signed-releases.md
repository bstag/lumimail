# F81 — Signed Releases and Deliberate Promotion

> Status: In Progress — first signed release verified; deliberate signed promotion pending
> Owner area: `scripts/release-manifest.mjs`, `.github/workflows/`, `docs/OPERATIONS.md`

## 1. Problem & User Job

Lumimail currently deploys from source and can prove the active Worker after deployment, but it does
not bind a build artifact to its source commit, schema contract, release notes, and trusted signer.
An operator needs to know exactly what was built and must be able to reject a substituted, corrupted,
wrong-product, or schema-incompatible artifact before any upload or promotion.

## 2. User Stories & Acceptance Criteria

- As a release operator, I can create one canonical `lumimail-release-v1` manifest for an immutable
  Worker archive so the artifact digest, source, build runtime, and schema compatibility are bound.
- As CI, I can sign the canonical manifest with an Ed25519 private key supplied only at signing time;
  neither the key nor its value is written to logs or committed.
- As a deploy operator, I can verify the detached signature against a pinned key ID and public key,
  then verify the artifact's exact size/SHA-256 and product/schema/version constraints before upload.
- Given any unknown field, malformed value, unknown key, invalid signature, digest/size mismatch,
  wrong product, or incompatible schema, verification fails before Wrangler is invoked.
- Upload does not promote traffic. Promotion requires a separately recorded version ID, smoke,
  recovery point/evidence, compatibility result, and explicit operator action.

## 3. Scope Boundaries

**In scope:**

- Strict canonical release manifest and detached signature formats.
- Artifact byte size and SHA-256, source commit, semantic release version, UTC build timestamp,
  current/minimum/maximum schema versions, build-tool versions, and bounded release notes.
- Ed25519 signing/verification through Node's built-in `crypto`; no new dependency.
- CI workflow stages for verify, build/archive, manifest, sign, and immutable artifact publication.
- Pre-upload verification, `versions upload` without promotion, version smoke, and deliberate
  `versions deploy` promotion contract.
- Disposable upgrade rehearsal from the previous supported release and pre-promotion recovery
  evidence as later F81 layers.

**Layer 2.4 deterministic archive contract:**

- Archive only an explicit build directory (normally `.open-next`) and write only to an explicit,
  previously absent output file outside that directory.
- Walk with `lstat`; accept regular files and directories only. Reject symbolic links, junctions,
  sockets, devices, path traversal, backslashes, absolute paths, duplicates, and USTAR-unrepresentable
  names before publishing an archive.
- Sort normalized forward-slash paths bytewise. Use USTAR with uid/gid/mtime zero, empty owner/group,
  directory mode `0755`, file mode `0644`, deterministic padding/checksum, and two zero end blocks.
- Gzip at a fixed level with zero timestamp and normalized OS header byte. The same tree bytes must
  yield identical `.tar.gz` bytes regardless of enumeration order or source mtimes.
- Build in a randomized partial sibling, derive manifest metadata from the completed archive bytes,
  and atomically rename only after a second deterministic pass matches. Remove only the command's
  partial file on failure; never alter the source build directory or an existing output.
- Publish one previously absent release-bundle directory containing exactly
  `lumimail-worker.tar.gz` and canonical `manifest.json`. Build both inside a randomized partial
  sibling, reparse the written manifest, re-read the archive, and require its exact size/SHA-256
  before atomically renaming the directory. The unsigned bundle is not releasable until a detached
  trusted signature is added and verified.

**Layer 2.9 operator key custody contract:**

- Signing authority is a single operator key held offline, not a CI secret or managed service.
  Releases are built for this deployment only, so there is no third-party consumer, no publication
  channel, and no key-distribution problem to solve. CI verifies; it never signs.
- `release:keygen` generates one Ed25519 pair, writes the private key with owner-only permissions to
  an explicit path, and refuses to overwrite an existing file or to write anywhere inside the
  repository working tree.
- It merges only the public key into the committed trust store, refusing a duplicate key ID, a
  malformed store, and a store already at the 32-key bound. Output names the key ID and public-key
  fingerprint only; private-key material is never printed, logged, or returned.
- Rotation adds a key ID and retains prior public keys so previously signed releases still verify.
  Revocation is removal from the committed store; no external publication is required.

**Layer 2.10 verified promotion contract:**

- A signature that does not gate promotion proves an artifact that was never deployed. Promotion
  therefore refuses unless, in order: pinned-trust verification passes; the checkout is clean and its
  HEAD equals the signed manifest commit; and a deterministic re-archive of the build tree reproduces
  the exact size and SHA-256 recorded in the signed manifest.
- Only then may the version be uploaded without traffic, smoked at its own version-specific origin,
  and promoted as a separate deliberate step. A failure at any stage leaves production traffic
  unchanged; an uploaded but unpromoted version is an accepted outcome.
- The command performs no migration, no data mutation, and no rollback. It reports version identity,
  schema identity, digest status, and smoke counts only.

**Layer 2.5 clean-checkout metadata contract:**

- Refuse a dirty Git worktree, detached/unresolved/non-full commit, missing package/lock metadata,
  non-contiguous migration sequence, schema policy drift, malformed notes, or missing deterministic
  build epoch before reading build output.
- Derive commit from `git rev-parse HEAD`; release version from `package.json`; Node from the running
  process; Next/OpenNext/Wrangler from exact `package-lock.json` installed-package versions; and
  current schema from the highest contiguous migration prefix.
- Keep an explicit strict `release.schema.json` with minimum/maximum compatible schema. Require the
  derived current schema to be inside that range; never infer compatibility merely because a
  migration exists.
- Derive `builtAt` from integer `SOURCE_DATE_EPOCH` seconds so rebuilds of the same release inputs can
  produce identical canonical manifest bytes. Release notes come from a strict JSON string array,
  not shell-delimited text.

**Layer 2.6 operator preparation command:**

- Expose one offline command with exactly three positional inputs: OpenNext build directory, release-
  notes JSON file, and previously absent output directory. Resolve all paths from the checkout root.
- Refuse unknown/missing arguments, a dirty checkout, malformed notes, missing build input, an
  existing output, or any provenance/schema/runtime failure before publishing a bundle.
- Derive `SOURCE_DATE_EPOCH` from the committed HEAD timestamp. The command does not accept commit,
  version, schema, runtime, digest, or build timestamp overrides.
- Print only a content-free success report containing version, abbreviated commit, schema range,
  archive size/entry count, and output path. On failure print one stable content-free error and exit
  nonzero; never print release-note contents or arbitrary caught errors.
- This command produces an unsigned two-file bundle only. It neither signs, uploads, deploys, nor
  promotes traffic.

**Layer 2.7 offline detached signing command:**

- Accept exactly an unsigned bundle directory, a bounded key ID, and a previously absent detached-
  signature output path. Read the private key only from standard input, never argv or environment.
- Reparse the canonical manifest, re-read and verify its artifact, sign the canonical bytes with
  Ed25519, and self-verify using the public key derived in memory before atomic signature output.
- Refuse an invalid key, noncanonical/invalid bundle, artifact substitution, existing output, or
  output inside the unsigned bundle. Emit no key material, manifest, notes, or caught error text.
- Signing remains offline: no publication, provider credential, upload, deploy, or promotion path.

**Layer 2.8 pinned-trust verification command:**

- Accept exactly a bundle directory, detached signature file, strict trust-store JSON file, expected
  semantic version, and expected four-digit schema version. Product identity is fixed to Lumimail.
- The trust store has one exact format marker and a bounded object mapping key IDs to PEM-encoded
  Ed25519 public keys. Reject unknown store fields, unknown key IDs, malformed/non-Ed25519 keys, and
  never accept an embedded key from the signature or bundle.
- Require the unsigned bundle's exact two-file inventory and canonical manifest bytes, then verify
  signature, manifest digest, product/version/schema compatibility, artifact size, and SHA-256.
- Perform no writes or provider calls. Print one bounded verification report or one stable content-
  free failure; never print public-key contents, notes, manifests, or caught error text.

**Out of scope:**

- Storing signing private keys in source, artifacts, app bindings, D1, or ordinary application
  sessions.
- In-app update/install controls, automatic production promotion, auto-rollback, or schema rollback.
- Signing private mail backups; F79 recovery artifacts remain operator-controlled production data.
- Choosing a managed key service or public release channel until ownership/cost/distribution is set.

## 4. Data Model

No application schema change. Release evidence is an immutable external artifact, not a D1 row.

## 5. Artifact Contracts

`lumimail-release-v1` is strict and canonical. The unsigned manifest contains:

- `format`, `product`, semantic `version`, UTC `builtAt`, and exact Git commit.
- `artifact`: safe basename, non-negative byte size, SHA-256.
- `schema`: four-digit `current`, `minimum`, and `maximum`; minimum ≤ current ≤ maximum.
- `runtime`: exact Node, Next.js, OpenNext, and Wrangler versions used to build.
- `notes`: at most 100 non-empty single-line entries, each at most 500 characters.

The detached `lumimail-release-signature-v1` envelope contains only `format`, `algorithm=Ed25519`,
`keyId`, canonical-manifest SHA-256, and Base64 signature. Verification selects a public key by exact
key ID; it never tries every key or accepts an embedded public key.

## 6. UI/UX

No product UI. CLI output is content-free and identifies release version, commit, schema range,
artifact size/digest status, signer key ID, and verification outcome. Private-key material is never
accepted as a command-line argument because process lists and shell history may expose it.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/scripts/release-manifest.test.ts` | strict parsing/canonicalization, ordering, immutability, schema/version/note/path limits, artifact hash/size, Ed25519 sign/verify, wrong product/key/signature/artifact refusal |
| Unit | `tests/unit/scripts/release-archive.test.ts` | sorted USTAR/gzip determinism, normalized metadata, empty directories, changed bytes, unsafe/symlink/duplicate/long-path refusal, atomic output and partial cleanup |
| Unit | `tests/unit/scripts/release-prepare.test.ts` | exact two-file unsigned bundle, byte-derived canonical manifest, atomic directory publication, existing-output preservation, invalid metadata/source cleanup |
| Unit | `tests/unit/scripts/release-metadata.test.ts` | clean/full commit, deterministic epoch, exact installed tool versions, contiguous migration head, strict schema policy/range, bounded notes, caller immutability |
| Unit | `tests/unit/scripts/release-command.test.ts` | exact CLI arguments, checkout-derived inputs, notes privacy, stable success/error reporting, no signing/upload/promotion |
| Unit | `tests/unit/scripts/release-sign.test.ts` | stdin-only Ed25519 key handling, canonical detached envelope, self-verification, atomic refusal/cleanup, content-free output |
| Unit | `tests/unit/scripts/release-verify.test.ts` | strict pinned trust store, exact expected identity/schema, signature/artifact refusal, read-only and content-free CLI behavior |
| CI | workflow validation | clean install, verify, deterministic archive, manifest/signature creation, verification before publication |
| Operator | disposable Cloudflare release rehearsal | verified upload without traffic, smoke, upgrade rehearsal, recovery evidence, deliberate promotion/return |
| Full | repository commands | `npm run verify`; no E2E for the manifest core |

## 8. Current Behavior

CI runs typecheck, lint, and application coverage. `npm run upload` builds and uploads a Worker
version, while `npm run deploy` can apply migrations and deploy. Neither command requires a signed
manifest or immutable archive, and the current CI workflow does not publish release artifacts.

## 9. Error States

| Condition | Operator message | Mutation allowed? | Logged? |
|-----------|------------------|-------------------|---------|
| Invalid/unknown manifest field | manifest invalid | No | safe field path |
| Unknown signer key ID | signer not trusted | No | key ID only |
| Invalid signature/canonical digest | signature invalid | No | digest status only |
| Artifact size/hash mismatch | artifact verification failed | No | expected/observed digest status, not bytes |
| Wrong product/version | release identity rejected | No | safe identity |
| Schema outside supported range | schema incompatible | No | four-digit versions |
| Upload/smoke/rehearsal failure | promotion blocked | Upload may exist; traffic unchanged | version/status only |

## 10. Edge Cases

- CRLF/LF, JSON whitespace, object key order, and uppercase digest normalization.
- Path traversal, absolute paths, nested paths, duplicate/empty/multiline notes, and oversized notes.
- Malformed semantic versions, Git hashes, UTC timestamps, or schema prefixes.
- Minimum/current/maximum ordering and rollback across a destructive migration.
- Empty/truncated/repacked artifact after signing.
- Unknown/revoked key IDs and key rotation with overlapping verification-only public keys.
- CI rerun for the same version/commit must not overwrite an already published immutable release.
- Relative and absolute command paths, JSON values other than an array, extra positional arguments,
  and a failure containing private release-note text.
- Upload succeeds but smoke/recovery/upgrade rehearsal fails; traffic remains on the prior version.

## 11. Permissions & Security

Signing occurs only in protected CI or an operator-controlled signing environment. The private key
is provided through standard input or a protected file/secret binding, never argv. Public keys and
key IDs may be committed. Deployment credentials remain separate from signing credentials. Normal
Lumimail users, admins, API keys, and Worker runtime bindings have no signing or promotion authority.

## 12. Open Questions / Decisions

- Decision: use Ed25519 detached signatures and built-in Node crypto. — 2026-08-12
- Decision: sign canonical manifest bytes, which contain the artifact digest; do not sign a mutable
  directory or provider version response. — 2026-08-12
- Decision: upload and promotion are separate; successful upload never implies production traffic.
  — 2026-08-12
- Decision: schema compatibility is an explicit inclusive range, not inferred from migration names
  at deploy time. — 2026-08-12
- Decision: releases are built for this deployment only, with no third-party self-hosters. There is
  therefore no public distribution channel to choose and no external revocation to publish; signed
  bundles live in operator-controlled storage alongside recovery archives. — 2026-08-15
- Decision: signing authority is one offline operator key rather than a managed service or protected
  CI secret. A CI secret would let anything able to trigger CI sign a release, which defeats the
  purpose at this scale. CI verifies; it never signs. — 2026-08-15
- Decision: rotation adds a key ID to the committed trust store and retains prior public keys so
  older releases still verify. Revocation is a commit. — 2026-08-15
- Decision: the first signed release requires schema `0039` exactly. The deployed code depends on
  the external-sync job fields and uniqueness invariant introduced by migration `0039`, so it must
  not claim compatibility with the prior `0032` policy. — 2026-08-19
- Open question: whether the exit gate still requires a disposable-resource upgrade rehearsal. The
  recommendation is to drop it for a single-operator deployment with a proven Worker rollback drill
  and record that reason. Not yet applied.

## 13. Bug / Change Log

### 2026-08-19 — Produce the first operator-signed release

Type: Release / Operations

Summary:

- Generate the deployment's first offline Ed25519 operator key as `bstag-2026`, pin only its public
  key in `release.trust.json`, and keep the private key outside the repository.
- Bind release `0.1.0` to a clean source commit, the deterministic OpenNext artifact, and exact
  schema `0039`, then sign and verify the detached manifest.

Reason:

- Production is running the verified external-sync architecture change, but the direct deployment
  did not produce the signed artifact required by the F81 provenance contract.

Impact:

- Signing and verification are offline and do not upload, deploy, migrate, or alter production
  traffic. Migration `0039` was applied separately before the current Worker became active.

Verification plan:

- Run the repository verification suite, build OpenNext from the clean release commit, prepare the
  deterministic bundle, sign from standard input, and verify against the pinned public key with
  expected version `0.1.0` and schema `0039`.

Result:

- Generated offline operator key `bstag-2026`; its private half is stored outside the repository at
  `F:\lumimail-keys\release-signing.pem`, and only the public key is pinned in
  `release.trust.json`. The displayed public-key fingerprint begins `4e0f47ce88614b50`.
- Full verification passes with 300 application test files / 2,572 tests at 100% statement, branch,
  function, and line coverage, plus 21 IMAP/SMTP bridge tests. The OpenNext production build also
  completes from clean commit `04415c15590113b161e7cba7050a68cd8b808014`.
- Prepared and signed release `0.1.0` at `F:\lumimail-releases\0.1.0-04415c1` with detached
  signature `0.1.0-04415c1.signature.json`. Pinned verification passes for product Lumimail,
  version `0.1.0`, schema `0039`, signer `bstag-2026`, commit `04415c15`, and the exact
  8,500,815-byte artifact SHA-256.
- The signed bundle was not uploaded or promoted. Production remains on the separately deployed
  Worker version `12eeb49b-3ef5-4195-98a2-83abaa06d2a5` with migration `0039` already applied.

### 2026-08-12 — Define signed release provenance

Type: Feature

Summary:

- Define strict release/signature formats, Ed25519 trust boundary, artifact/schema verification,
  immutable publication, and upload-versus-promotion separation.

Reason:

- Continue the HQBase-inspired operator lifecycle with verifiable deployment provenance.

Impact:

- Specification only at this checkpoint; no build, deployment, signing secret, or traffic change.

Tests:

- Manifest/signature core begins with failing unit tests.

Notes:

- Live signing authority and artifact storage remain explicit operator/security decisions.

### 2026-08-12 — Implement strict manifest and Ed25519 verification core

Type: Feature

Summary:

- Add strict parsing, deterministic construction, and canonicalization for `lumimail-release-v1`, including artifact, commit,
  semantic version, build runtime, bounded notes, and inclusive schema compatibility.
- Add detached `lumimail-release-signature-v1` Ed25519 signing and pinned-key verification using
  built-in Node crypto.
- Verify canonical-manifest digest, signature, product/version/schema identity, and exact artifact
  size/SHA-256 before returning a content-free success report.

Reason:

- Establish the format and trust primitive before CI, storage, upload, or promotion is authorized.

Impact:

- Pure/offline module only. It has no filesystem, network, Cloudflare, signing-secret storage,
  upload, or promotion behavior.

Tests:

- Eighteen focused contracts pass after the missing-module failure was observed first.
- Tests cover strict/unknown fields, normalization, path/version/time/schema/note constraints,
  immutability, valid Ed25519 verification, unknown key, artifact substitution, wrong version/schema,
  and manifest tampering.

Notes:

- The API accepts key objects/bytes from its caller; a future CLI must use protected stdin/file
  input and must never put private-key material in argv.
- Manifest creation accepts exact artifact bytes and derives size/SHA-256 internally; callers cannot
  supply digest metadata for CI to sign blindly.

### 2026-08-12 — Implement deterministic OpenNext release archives

Type: Feature

Summary:

- Add a dependency-free deterministic USTAR/gzip writer with normalized paths, modes, ownership,
  timestamps, ordering, padding, checksums, compression settings, and gzip OS header.
- Add fail-closed directory walking for regular files/directories only, a double-build byte match,
  randomized partial sibling, and atomic publication to a previously absent output.
- Reject unsafe/duplicate/unrepresentable paths, links/special files, missing sources, output-inside-
  source, missing output parent, and existing output without changing source or existing bytes.

Reason:

- Give the signed manifest one stable immutable byte artifact rather than a mutable build directory.

Impact:

- Offline filesystem tooling only; no signing, CI publication, Cloudflare upload, or traffic change.

Tests:

- Eleven focused archive contracts pass after the missing-module failure was observed first.
- A real `.open-next` rehearsal archived 2,158 entries twice into 7,860,951-byte artifacts with the
  same SHA-256 `763c87ff6d64b77bf00914d02a7c6f1035beb4d41c9fe3c11c64ad7a712e7086`.
  Both command-created temporary archives were removed afterward.

Notes:

- The rehearsal proves deterministic packaging of the current local build tree; it does not label
  that pre-existing tree as a signed or publishable release.

### 2026-08-12 — Publish atomic unsigned release bundles

Type: Feature

Summary:

- Add a two-file unsigned bundle writer containing only `lumimail-worker.tar.gz` and canonical
  `manifest.json`.
- Derive manifest artifact size/hash from the written archive, then re-read/reparse both files and
  require the exact two-file inventory before atomically renaming the bundle directory.
- Reject unknown metadata, invalid identity/schema/runtime/notes, missing source, output-inside-
  source, missing parent, and existing output; clean only the command-created partial directory.

Reason:

- Give protected CI one complete immutable input to sign and publish as a unit.

Impact:

- Offline unsigned preparation only. A resulting directory is explicitly not a trusted release
  until a detached signature is added and verified under an approved key.

Tests:

- Five focused preparation contracts plus eighteen manifest contracts pass together (23 tests).

Notes:

- A future CLI/CI wrapper must derive commit/build/runtime inputs from a clean checkout rather than
  accepting operator claims; the pure bundle writer intentionally remains dependency-injected.

### 2026-08-12 — Derive release metadata from a clean checkout

Type: Feature

Summary:

- Add strict `release.schema.json` compatibility policy and a pure derivation guard for clean Git
  status/full HEAD, package/lock identity, required Node, exact installed Next/OpenNext/Wrangler,
  contiguous migration head, deterministic `SOURCE_DATE_EPOCH`, and bounded notes.
- Require the derived migration head to fall inside the explicit compatibility range and pass all
  metadata through the canonical manifest validator before returning a deeply frozen result.

Reason:

- Prevent CI or an operator from signing manually claimed commit, build time, runtime, or schema
  metadata.

Impact:

- Offline/read-only derivation only. No build, archive write, signature, publication, or provider
  operation.

Tests:

- Eleven focused metadata contracts pass; the combined provenance/preparation/metadata subset passes
  34 tests.

Notes:

- Current compatibility policy is exactly schema `0030`; widening it requires explicit evidence
  that the release operates correctly against the additional schema version.

### 2026-08-12 — Wire one offline release preparation command

Type: Feature

Summary:

- Add `npm run release:prepare -- <build-directory> <notes.json> <output-directory>` as the only
  operator-facing entry point for clean-checkout metadata derivation and atomic unsigned bundling.
- Derive the deterministic build timestamp from committed HEAD and reject missing/extra arguments,
  dirty or invalid provenance, malformed private notes, unsafe build input, and existing output.
- Emit one bounded success line or one stable content-free failure without forwarding caught errors.

Reason:

- Make the proven metadata/archive/bundle layers executable as one repeatable CI/operator action
  without allowing claimed provenance overrides.

Impact:

- Offline filesystem output only. The command cannot sign, upload, deploy, migrate, or promote.

Tests:

- Five focused command contracts pass alongside the metadata and bundle suites.

Notes:

- Protected signing/publication CI remains blocked on the signer authority and immutable artifact-
  storage decisions; those choices are not silently encoded here.

### 2026-08-12 — Add stdin-only detached release signing

Type: Feature

Summary:

- Add an offline `release:sign` command that reads an Ed25519 private key only from standard input,
  signs canonical manifest bytes, self-verifies the exact artifact, and atomically writes a detached
  signature outside the unsigned bundle.
- Refuse noncanonical bundles, substituted artifacts, invalid keys/key IDs, existing outputs, and
  output paths inside the immutable unsigned bundle with content-free failure reporting.

Reason:

- Close and test the signing mechanics without selecting, storing, or exercising a production key.

Impact:

- Offline detached-signature output only; no secret persistence, publication, provider, or traffic
  mutation behavior.

Tests:

- Four focused signing contracts and eighteen manifest/signature contracts pass together.

Notes:

- Production still needs an explicit signer authority/key rotation policy and immutable publication
  store before a protected workflow can call this command.

### 2026-08-12 — Add pinned-trust pre-publication verification

Type: Feature

Summary:

- Add `release:verify` for a strict pinned Ed25519 trust store, exact expected version/schema, fixed
  Lumimail product identity, canonical manifest, detached signature, and artifact size/SHA-256.
- Reject unknown trust fields/key IDs, malformed or non-Ed25519 keys, wrong identity/schema,
  substituted artifacts, invalid signatures, and noncanonical or non-exact bundle inventories.
- Keep verification read-only with bounded success output and one content-free failure.

Reason:

- Complete the offline chain of custody before any later workflow receives upload credentials.

Impact:

- Read-only local verification only; no signing secret, output write, provider call, upload, deploy,
  migration, or promotion.

Tests:

- Five focused verifier contracts pass with four signing and eighteen manifest contracts (27 total).

Notes:

- The trust-store format is implemented, but no production key is pinned until signer ownership and
  rotation/revocation policy are approved.

### 2026-08-15 — Resolve key custody and gate promotion on the signature

Type: Feature

Summary:

- Record the operator decision that releases are built for this deployment only. That removes the
  publication channel, key-distribution, managed-signing, and third-party revocation questions
  outright: signing authority is one offline operator key, and CI verifies but never signs.
- Add `release:keygen`, which generates one Ed25519 pair, writes the private key with owner-only
  permissions to an explicit path outside the repository, merges only the public key into the
  committed trust store, and prints only the key ID and public-key fingerprint.
- Add `release:promote`, which refuses to promote unless pinned-trust verification passes, the
  checkout is clean and at the signed manifest commit, and a deterministic re-archive of the build
  tree reproduces the exact signed size and SHA-256. Only then does it upload without traffic, smoke
  the uploaded version at its own preview origin, and promote as a separate step.

Reason:

- The offline trust chain was complete but inert: nothing consumed a signature, so a signed bundle
  proved an artifact that was never deployed. The checkout and digest bindings are what connect
  "what was signed" to "what is about to receive traffic".
- Key custody was the last blocking decision, and the single-operator answer makes the simplest
  option the correct one rather than a compromise.

Impact:

- No application, schema, or authorization change. Promotion runs no migration and no data command.
  Any failure leaves production on its current version; an uploaded but unpromoted version is an
  accepted outcome requiring no rollback.
- `wrangler versions upload` has no JSON output, so version identity is parsed from its exact
  labelled lines and refuses ambiguity. Version preview URLs must be enabled or promotion refuses,
  because an unsmoked version must not be promoted.

Tests:

- Twenty keygen contracts: owner-only private key, public-only publication, rotation retaining prior
  keys, refusal of overwrite, duplicate ID, in-repository paths, five malformed key IDs, four
  malformed stores left untouched, the 32-key bound, and content-free CLI failures.
- Fifteen promotion contracts: full ordered success, refusal before provider access for an
  unverified signature, dirty or mismatched checkout, changed digest or size, a verification report
  missing the compared fields, six malformed upload outputs, an unpromoted version after failed
  smoke, and a no-migration/no-data command assertion.
- `npm run verify` passes: typecheck, lint with 0 errors and 43 pre-existing warnings, 277 test
  files with 2,438 application tests at 100% statement/branch/function/line coverage, and 21 IMAP
  bridge tests.

Notes:

- No key exists yet. The operator generates one, commits `release.trust.json`, and backs up the
  private key before the first signed release.
- Open decision: whether the exit gate still requires a disposable-resource upgrade rehearsal. For a
  single-operator deployment with a proven Worker rollback drill (F79 L1.6), the recommendation is to
  drop it and record the reason rather than build rehearsal tooling for one run. Not applied.
