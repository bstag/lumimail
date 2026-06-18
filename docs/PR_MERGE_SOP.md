# SOP — Reviewing & Merging Pull Requests (for agents)

> Audience: AI agents (and humans) with merge rights on Lumimail.
> Scope: every PR merged into `main`. Lumimail is a multi-tenant **email** platform —
> a bad merge can leak cross-tenant data, enable spam/spoofing, ship an XSS, or
> poison the build via a dependency. Treat every merge as outward-facing and
> hard to reverse.

This SOP is the gate. Do not merge until every **MUST** below is satisfied, or
the deviation is explicitly approved by the requester and recorded in the PR.

---

## 0. Golden rules

1. **Never run `npm install` / `npm ci` / `npx` / build scripts to "review" a PR
   branch.** Installing a PR's dependencies *executes* that PR's code — npm
   lifecycle scripts (`preinstall`/`install`/`postinstall`) and the
   transitive dependency tree run arbitrary code on your machine. That is the
   primary **supply-chain poisoning** vector. Review by **reading** code and
   tests; let **CI** (sandboxed) do the running. See §3 and §5.
2. **Read the actual diff, not just the PR description.** The description is the
   author's claim; the diff is the truth. Verify claims ("100% coverage", "no
   new deps", "behavior unchanged") against the diff and against CI.
3. **Drafts are a signal.** A PR left as *Draft*, or with a "What was NOT
   verified" section, is the author telling you it isn't done. Marking it ready
   and merging transfers that risk to you — surface it to the requester first.
4. **Default to confirming before merging to `main`** on anything touching auth,
   tenancy, email send/receive, sanitization, secrets, or dependencies.
5. **Faithful reporting.** If CI didn't run, say so. If you reviewed by reading
   only, say so. Never claim verification you didn't perform.

---

## 1. Triage

```bash
gh pr list --state open --json number,title,author,isDraft,additions,deletions,changedFiles
gh pr view <N> --json title,body,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,labels,files
```

- [ ] Understand **what** and **why** from the body, then map it to the files.
- [ ] Note `isDraft`, `mergeable`, `mergeStateStatus`, and which checks exist.
- [ ] Flag the high-risk surfaces this PR touches (see §2 checklist headers).

## 2. Security review (MUST, read-only)

Pull the full diff and read all of it:

```bash
gh pr diff <N>
```

### Cross-tenant isolation (Lumimail's #1 invariant)
- [ ] Every new/changed query that reads or writes mailbox / message / domain /
      routing / contact data filters by the authenticated **user or org**.
- [ ] New endpoints have a **cross-tenant denial test** (per `CLAUDE.md`).
- [ ] Authorization is enforced **before** the side effect, not after.

### Email-specific abuse
- [ ] **Sender authorization**: any outbound path still gates the `from` address
      to a mailbox the caller owns (`validateSenderDomain()` in `send.ts`) *before*
      handing off to a provider. Providers must not be trusted to re-check this.
- [ ] **Recipient / header injection**: recipient and header values go in the
      structured request body, never concatenated into a URL or raw header.
- [ ] **HTML sanitization (XSS)**: mail HTML is the XSS boundary. Confirm
      sanitization runs on both **store** (`parse.ts`) and **render**
      (`inbox/[messageId]`). Be suspicious of swaps to the sanitizer's backing
      DOM/parser — a parser differential from the browser is a mutation-XSS
      (mXSS) vector. Require XSS unit tests when this code changes.

### Secrets & SSRF
- [ ] Secrets (`*_API_KEY`, tokens) are read from `env`, sent only as needed, and
      **never logged or returned** in responses or error messages.
- [ ] Any externally-fetched URL is **operator config**, not request input
      (no user-controlled SSRF). Confirm where the URL comes from.

### Output the verdict
- [ ] For each finding: file:line, why it matters, and blocker vs. follow-up.

## 3. Supply-chain review (MUST when deps change)

Trigger: any change to `package.json`, `package-lock.json`, or a new `import`
of a third-party module.

- [ ] **Do not install to investigate.** Inspect statically.
- [ ] Diff the lockfile. For every **added** package ask: is the publisher
      reputable and widely used? Is the version **pinned** (prefer exact for
      direct security-relevant deps like a sanitizer)? Does the transitive tree
      look proportionate to the feature?
- [ ] Prefer changes that **add zero runtime deps** (e.g. using `fetch` over an
      SDK). Call out net new production dependencies explicitly.
- [ ] Confirm the **Socket Security** checks (Project Report + PR Alerts) are
      green — these flag install scripts, malware, and risky maintainer changes
      in a sandbox so you don't have to.
- [ ] Watch for: a dependency swap that quietly changes a security boundary
      (e.g. the sanitizer's DOM), typosquatted names, or a lockfile diff far
      larger than the stated change.

## 4. Bug & correctness review (MUST)

- [ ] Trace the changed code path end to end for the happy path **and** error
      paths. Does a failure leave data consistent (job/message marked `failed`,
      no partial writes)?
- [ ] Check edge cases: null/empty inputs, whitespace/case in config values,
      trailing slashes in URLs, missing fields in API responses.
- [ ] Confirm the change is **minimal** and doesn't alter unrelated behavior.
- [ ] Confirm spec + `docs/MVP_SCOPE.md` registry are updated (project protocol).

## 5. Test verification (MUST) — trust CI, read the tests

We verify **without installing**. Two independent signals:

1. **CI ran the project gate.** Confirm the `verify` check
   (`typecheck + lint + test:cov`, with the 100%-coverage gate on included
   files) is **SUCCESS** on the PR's merge state. If a fork PR's checks were
   skipped because it's a draft / first-time contributor, marking it ready or
   pushing the rebase typically triggers them — then **wait for green** (§7).
2. **You read the tests.** CI green only proves the tests that exist pass. Read
   them and confirm they actually exercise the risk:
   - [ ] New security-relevant code has tests for the **denial** case, not just
         the happy path (cross-tenant denied, bad sender rejected, malformed
         input rejected).
   - [ ] Sanitizer / parser changes have **payload** tests (`<script>`,
         `onerror=`, `javascript:`, mXSS classics).
   - [ ] New modules are added to the coverage `include` list (else "100%" is
         hollow).
   - [ ] Tests assert behavior, not just that a function was called.
- [ ] If a critical path is only "manually verified" or "not verified" by the
      author, treat that as an open risk and raise it before merging.

> Local `npm run verify` is the human/CI path. As a review agent on an untrusted
> branch, **do not** install to run it — rely on CI + test reading instead. If
> you genuinely need a local run, do it in a sandboxed/throwaway environment,
> never on the working machine.

## 6. Decision

- [ ] All MUSTs satisfied and checks green → proceed to merge.
- [ ] Draft, or unresolved blocker, or a security/supply-chain concern →
      **stop**, summarize findings, and get explicit approval (or request
      changes) before merging.

## 7. Merge mechanics

```bash
# Drafts must be readied first; this is also your moment to confirm CI runs.
gh pr ready <N>

# Wait for checks to actually finish — never merge an UNSTABLE/pending state.
gh pr view <N> --json mergeable,mergeStateStatus,statusCheckRollup

# Squash to keep main history clean; give an explicit, conventional subject.
gh pr merge <N> --squash --subject "<type>: <summary> (#<N>)"
```

- [ ] **Merge order** when multiple PRs are open: lowest-risk / smallest-surface
      first, and merge the one that unblocks production (e.g. a boot-crash fix)
      promptly. Expect later PRs to need a rebase.
- [ ] **Conflicts** (common on shared files like `docs/MVP_SCOPE.md`): check out
      the branch, `git merge origin/main`, resolve **keeping both sides' intent**
      (e.g. keep both feature rows in numeric order), commit, push, then
      **re-wait for CI green** before merging.
- [ ] After each merge: `git fetch && git log origin/main --oneline` and confirm
      the new files/rows actually landed. If you resolved a conflict, double-check
      the merged content on `main`.

## 8. Close the loop — thank the author (MUST)

After a successful merge, comment on the PR:

```bash
gh pr comment <N> --body-file <file>
```

- [ ] **Thank the author genuinely** and name the impact of their work.
- [ ] **Be specific and constructive.** Summarize the security review outcome.
      If something is wrong or risky, say so **kindly and precisely** — file:line,
      why it matters, and a concrete suggested fix — framed as follow-up, not
      blame. "Merged as-is; these are constructive follow-ups, not blockers" is a
      good tone when the residual risk is acceptable.
- [ ] Record what was **not** verified (e.g. "no live send tested") so the next
      person knows the real state.
- [ ] If you rebased/resolved conflicts on their branch, say what you changed and
      why.

## 9. Report back

- [ ] Tell the requester: what merged (with commit SHAs), the security verdict,
      any residual risks / recommended follow-ups, and exactly which verification
      you relied on (CI checks + code/test reading — and that you did **not**
      install anything).

---

### Quick checklist (TL;DR)

```
[ ] Read the full diff (not just the description)
[ ] Cross-tenant isolation + denial tests present
[ ] Email abuse: sender gated, no header injection, HTML sanitized on store+render
[ ] Secrets never logged/returned; no user-controlled SSRF
[ ] Deps: reputable + pinned, prefer zero new runtime deps, Socket green — NO local install
[ ] Bugs: error paths leave data consistent; edge cases covered
[ ] Tests: CI `verify` green AND tests actually cover the denial/abuse cases
[ ] Drafts / "not verified" risks surfaced to the requester
[ ] Squash-merge with a clean subject; resolve conflicts keeping both intents
[ ] Wait for green after any rebase; confirm content landed on main
[ ] Thank the author — specific, kind, constructive; note what wasn't verified
[ ] Report SHAs + verdict + residual risks + what verification you relied on
```
