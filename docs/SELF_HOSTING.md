# Self Hosting Guide

## Prerequisites

- Cloudflare account
- Domain added to Cloudflare
- Node.js installed
- Wrangler installed
- Access to DNS and Email Routing settings

## Install Wrangler

```bash
npm install -g wrangler
wrangler --version
```
## Cloudflare API Token

Create a Cloudflare API token with these permissions:

- Account: Email Sending: Edit
- Zone: Zone: Read
- Zone: DNS: Edit
- Zone: Email Routing Rules: Edit

Store the token safely. Do not commit it.

Keep this token handy; you will save it as a secret after Wrangler has been authenticated and configured.

## Wrangler Configuration

Authenticate Wrangler:

```bash
wrangler login
wrangler whoami
```

Copy the example configuration file (it does not exist by default after cloning):

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Update `wrangler.jsonc` with your specific settings, such as:

- account_id
- worker name
- D1 database ID and R2 bucket names
- environment variables

Now that Wrangler is authenticated and configured, store the Cloudflare API token
you created earlier as a secret:

```bash
npx wrangler secret put CF_TOKEN
```

Verify configuration:

```bash
wrangler deploy --dry-run
```
## DNS Setup

1. Open Cloudflare Dashboard.
2. Select your domain.
3. Open DNS settings.
4. Create or verify the required DNS records.
5. Wait for DNS propagation.
   
## Email Routing Setup

1. Open Email Routing in Cloudflare.
2. Enable Email Routing.
3. Add destination email addresses.
4. Create a routing rule that catches all (or specific) inbound emails and routes
   them to your deployed Lumimail Worker (not a plain destination address).
5. Verify email delivery.

## Deploy

`npm run deploy` applies the remote D1 database migrations
(`wrangler d1 migrations apply DB --remote`), then builds and deploys the Worker,
so your production database gets its tables on the first deploy:

```bash
npm install
npm run deploy
```

To run the database migration on its own first, you can:

```bash
npx wrangler d1 migrations apply DB --remote
```

## Verify Deployment

Check:

- Worker deployed successfully
- DNS records are active
- Email Routing is enabled
- Inbound email is routed correctly

## Troubleshooting

### 403 Invalid Token

Cause:
- Invalid or expired token

Fix:
- Generate a new token
- Verify token permissions

### 403 Missing Permissions

Cause:
- Missing DNS or Email Routing permissions

Fix:
- Add required permissions to the Cloudflare token

### Wrangler Authentication Errors
Fix:
- Run `wrangler login`
- Verify the correct Cloudflare account is being used

```bash
wrangler whoami
```

## Security Notes

Never commit:

- Cloudflare API tokens
- .env files
- .dev.vars files
- Private credentials
