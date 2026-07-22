interface CloudflareEnv {
	DB: D1Database;
	EMAIL: SendEmail;
	BUCKET: R2Bucket;
	INBOUND_QUEUE: Queue<import("./src/lib/email/inbound").InboundQueueMessage>;
	OUTBOUND_QUEUE: Queue<import("./src/lib/email/send").OutboundQueueMessage>;
	ASSETS: Fetcher;
	IMAGES: ImagesBinding;
	WORKER_SELF_REFERENCE: Fetcher;
	CF_TOKEN?: string;
	CF_API_KEY?: string;
	CF_EMAIL?: string;
	CF_ACCOUNT_ID?: string;
	CF_EMAIL_WORKER_NAME?: string;
	/** Outbound mail provider: "cloudflare" (default) or "resend". */
	MAIL_PROVIDER?: string;
	/** Resend API key. Required when MAIL_PROVIDER=resend. */
	RESEND_API_KEY?: string;
	/** Override the Resend API base URL (defaults to https://api.resend.com). */
	RESEND_BASE_URL?: string;
	/** Canonical HTTPS origin used to create credential-bearing links. */
	PUBLIC_APP_URL?: string;
	/** Verified sender address used for password recovery messages. */
	PASSWORD_RESET_FROM?: string;
}
