# Lumimail IMAP/SMTP Bridge

The bridge is a separate Node.js TCP service that lets a standard mail client use one Lumimail mailbox. It translates IMAP and SMTP operations into the mailbox-scoped HTTPS API served by the Cloudflare Worker.

It does not run inside Cloudflare Workers: Workers serve the API and store/process mail, while this container must run on a long-running Docker host or VPS that can accept TCP connections.

## Security model

- Username: the complete mailbox address assigned to the user, such as `support@example.com`.
- Password: that user's Lumimail API key.
- One client account is bound to one mailbox address. A user assigned several mailboxes configures one client account per address.
- IMAP requires the key's `read` scope and viewer, responder, or manager mailbox access.
- SMTP requires the key's `send` scope and responder or manager mailbox access.
- Production requires an HTTPS Lumimail origin and a TLS key/certificate pair.
- Production IMAP uses implicit TLS. SMTP submission uses STARTTLS.
- Plaintext transport is limited to explicit loopback-only development mode.
- The bridge sends credentials and message data only to `LUMIMAIL_API_URL` and does not persist API keys.

## Create a personal API key

In Lumimail, open **Settings → Personal API keys → Manage API keys**, create a key, and save the one-time secret. New keys currently contain the `read` and `send` scopes; the mailbox role still limits what the key can do.

Restricted organization members use this personal settings route. `/api-keys` remains an organization-administration route.

## Production configuration

Copy `.env.example` to `.env` and set:

```dotenv
LUMIMAIL_API_URL=https://mail.example.com
IMAPS_PORT=993
SMTP_PORT=587
BRIDGE_HOST=0.0.0.0
TLS_KEY_PATH=/etc/ssl/private/bridge.key
TLS_CERT_PATH=/etc/ssl/certs/bridge.crt
ALLOW_INSECURE_LOCALHOST=false
```

Both TLS files must be readable when the process starts. A missing/incomplete pair or a non-HTTPS API URL stops production startup.

## Run with Docker

Build from the `imap-bridge` directory:

```bash
docker build -t lumimail-bridge .
docker run --restart unless-stopped \
  -p 993:993 \
  -p 587:587 \
  --env-file .env \
  -v /path/to/certs:/etc/ssl:ro \
  lumimail-bridge
```

Do not publish plaintext development ports.

## Loopback-only development

For a local Lumimail instance:

```dotenv
LUMIMAIL_API_URL=http://127.0.0.1:3000
ALLOW_INSECURE_LOCALHOST=true
IMAP_PORT=1143
SMTP_PORT=1587
```

The bridge ignores a public `BRIDGE_HOST` in this mode and binds `127.0.0.1`.

## Client settings

| Direction | Server | Port | Security | Authentication |
|---|---|---:|---|---|
| Incoming | bridge hostname | 993 | SSL/TLS | Normal password |
| Outgoing | bridge hostname | 587 | STARTTLS | Normal password |

Use the assigned mailbox address as both usernames and the personal API key as both passwords.

The current SMTP contract deliberately accepts exactly one recipient per submitted message. Attachments are not promised until Lumimail completes inbound/outbound attachment delivery work.

## Implemented IMAP behavior

- `CAPABILITY`, `LOGIN`, `NAMESPACE`, `LIST`, `LSUB`
- `SELECT`, `EXAMINE`, `STATUS`
- sequence and `UID` forms of `FETCH`, `STORE`, and `SEARCH`
- `SEARCH ALL`, `SEARCH SEEN`, and `SEARCH UNSEEN`
- `NOOP`, `CLOSE`, `EXPUNGE`, `LOGOUT`
- persistent API-backed UIDs
- `\Seen` updates and recoverable `\Deleted` → Trash behavior

The bridge does not advertise IMAP STARTTLS, IDLE/push, SASL authentication, arbitrary search criteria, or literal-plus. Unsupported behavior returns an error instead of a false success.

## Tests

```bash
npm ci
npm test
```

The repository root `npm run verify` also runs the bridge suite.
