# Mail categorization and tuning

Open **Mail insights** in the dashboard, or `/insights`. The mailbox picker scopes
the overview, sample tests, and existing-mail jobs. These actions organize mail
stored in Lumimail, including Gmail/Microsoft imports; they do not change Gmail's
labels or folders.

## Start with local rules

Choose **Questions & rules**. Disable or remove the starter AI questions to use
rules alone. Add an exact sender/domain, subject substring, or body substring rule
and choose the tag to apply. All filled conditions must match; an empty rule is
invalid. From **Overview**, **Draft rule** pre-fills a sender after you inspect its
recent messages. Choose its tag before activation.

Use **Test on recent mail** to compare current and proposed tags on up to five
messages without changing mail. Activate the configuration when satisfied. Enable
automatic new-arrival processing if desired, or use **Processing → Reclassify
existing mail** to explicitly process the selected scope. The minute scheduler
continues jobs while the browser is closed. **Process next batch** advances up to
five messages immediately; failures back off and require an explicit retry after
three failed attempts. Cancel jobs from the same page.

Automatic classification applies across all mailboxes you can read in the workspace.
The mailbox picker limits sample tests and explicit existing-mail jobs.

Tags appear in the existing Labels navigation. Use the label manager to choose
colors or nest them. There is no automatic archive, deletion, or spam-folder move.

## Enable Jev

The operator must apply the migrations before deploying code, then configure the
optional server secret. For development, add `TYPESAFE_API_KEY` to the local
`.dev.vars`; never place it in client code, a public environment variable, or
checked-in configuration. For a deployment, use Wrangler's interactive secret
entry so the key is not part of a shell command:

```sh
npm run db:migrate:remote
npx wrangler secret put TYPESAFE_API_KEY
```

Use the intended Wrangler environment flags when targeting staging. These commands
are operator instructions; this implementation task did not run remote migrations,
set a key, or deploy. `npm run deploy` also applies remote migrations before its
build/deployment step.

In **Questions & rules**, edit the question instructions, category definitions,
answer-to-tag mapping, and minimum probability. Yes/no questions can attach a tag;
scores retain an ordered assessment without attaching a tag. The default model is
`jev-1.13.0`; the editor accepts pinned version names and `jev-latest`. Results keep
the returned model name and configuration version. Choose the content-disclosure
checkbox before AI samples or consenting to an active AI configuration.

Each request sends only sender, recipient, subject, and up to 8,000 characters of
plain text, using the stored snippet when text is unavailable. Attachments, HTML,
and full threads are excluded. TypeSafe's
[privacy policy](https://typesafe.ai/legal/privacy-policy) describes provider
processing and retention; Picket does not promise zero retention. Rules alone do
not call an external classifier.

## Tune over time

The overview compares received volume across 7, 30, and 90 days, groups exact
senders, and shows weekly volume and personal tag counts. Counts can overlap
because a message may have several tags. New native and imported messages retain
a valid original email Date for these reports. Older records without that metadata
fall back to their ingestion date; sender-supplied dates do not establish trust.

Inspect **Why these results?** for matched reasons and provider answers. Use
**Correct tags** to save a personal override; it survives later reclassification.
**Restore automatic tags** removes that override and restores the recorded result.
Other personal/manual labels and other users' labels are preserved.

Edit questions, test the candidate, then activate a new immutable version. Editing
after testing marks the sample stale. **Previous configuration → Restore as draft**
lets you review an older configuration and activate a new version from it. Existing
mail is reclassified only when explicitly requested. Corrections do not train Jev.

## Operational limits

- At most eight questions, twenty rules, five messages per processing batch, and
  one active job per user. History lists the fifty latest configurations and thirty
  latest jobs; sender groups paginate in batches of twenty-five.
- Automatic classification begins with mail stored after opt-in and ignores mail
  already classified. It includes newly imported historical mail based on when
  the import was stored, independently of its original Date.
- Provider/DB failures leave the cursor at the last committed message. Durable
  leases prevent duplicate concurrent processing; retries reuse recorded results
  for the same message/version.
- Retrying a failed job requires an idle job slot. A failed automatic job blocks
  new automatic work until you retry it, cancel it, or activate a replacement
  configuration. Eligibility is rechecked before each provider request and commit.
- New controls are initially English; existing locale selection and direction
  remain intact. Localization of these controls is a follow-up.
- Live provider integration and production Cron behavior need a consented
  deployment smoke test. Unit and mocked browser tests do not establish them.
