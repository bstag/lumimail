# F81 — Signed Releases and Deliberate Promotion

> Status: In Progress — provenance, deterministic bundles, and clean-checkout metadata complete; protected CI workflow next
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
- Open question: GitHub Release, R2, or another operator-controlled immutable store for public/self-
  hosted release distribution.
- Open question: managed signing service versus protected CI secret, rotation period, and revocation
  publication. These security/authority choices block live signing but not the pure format core.

## 13. Bug / Change Log

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

- Current compatibility policy is exactly schema `0028`; widening it requires explicit evidence
  that the release operates correctly against the additional schema version.
