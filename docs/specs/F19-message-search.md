# F19 — Message search

The mail search box supports free text, `:read`, `:unread`, and `title:` with an optional quoted value. An operator-only search currently also sends the raw text as a free-text predicate. Send only the parsed remainder as `q`, omitting it when empty. Preserve explicitly supplied filters and the precedence of typed operators.

The existing message-list, sender-group, and bulk-view API parameters and mailbox access checks apply. Empty or whitespace-only searches add no free-text predicate. Mixed searches retain their remaining text.

Test the serialized operator-only and mixed queries in unit tests and an operator-only search in Playwright.

## Change log

- 2026-11-24 — Corrected query serialization for operator-only searches. The Inbox and its bulk and grouped views share the corrected parameters.
