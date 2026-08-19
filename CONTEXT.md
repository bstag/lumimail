# Lumimail

Lumimail is a multi-tenant mail platform that hosts mailboxes and can aggregate delegated external mail into the same workspace.

## External mail

**External Account**:
A delegated provider identity connected by its consenting owner to exactly one Lumimail Mailbox.
_Avoid_: Integration, linked inbox

**Sync Job**:
A durable request to import a bounded set of changes from one External Account into Lumimail.
_Avoid_: Queue message, poll

**Sync Page**:
A bounded provider result whose message changes and continuation position form one progress step of a Sync Job.
_Avoid_: Batch, chunk

**Retained Original**:
An exact provider MIME copy kept after explicit opt-in, independently of later provider deletion.
_Avoid_: Backup, archive

**Delegated Credential**:
A secret granted by a mail provider to the owner of an External Account for bounded provider access.
_Avoid_: Account password, shared credential
