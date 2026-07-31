import type { SeedMailboxKey, SeedMessageDefinition } from "@/lib/seed-types";

/**
 * Demo-seed fixture literals (T-43). Pure data — the seeding logic that
 * consumes these lives in `src/lib/seed-utils.ts`.
 */

export const demoCredentials = {
	email: "admin@example.com",
	password: "demo-password-change-me",
};

export const demoDomain = "example.com";

export const seedMailboxDefinitions: {
	key: SeedMailboxKey;
	localPart: string;
	displayName: string;
}[] = [
	{ key: "support", localPart: "support", displayName: "Support" },
	{ key: "billing", localPart: "billing", displayName: "Billing" },
];

export const seedMessages: SeedMessageDefinition[] = [
	{
		mailbox: "support",
		direction: "inbound",
		status: "received",
		fromAddr: `"Maya Chen" <maya@acme.test>`,
		toAddr: `"Support" <support@${demoDomain}>`,
		subject: "Cannot access workspace",
		textBody:
			"I reset my password this morning, but the login page still loops back to the sign-in screen. Can you check whether the account is locked?",
		read: false,
		minutesAgo: 12,
		providerMessageId: "<seed-inbox-access@example.test>",
	},
	{
		mailbox: "support",
		direction: "inbound",
		status: "received",
		fromAddr: `"Northwind DevOps" <devops@northwind.test>`,
		toAddr: `"Support" <support@${demoDomain}>`,
		subject: "Webhook retry question",
		textBody:
			"We noticed three delivery attempts for the same event. Is there a way to confirm whether retries stop after a 2xx response?",
		read: true,
		minutesAgo: 47,
		providerMessageId: "<seed-inbox-webhook@example.test>",
	},
	{
		mailbox: "billing",
		direction: "inbound",
		status: "received",
		fromAddr: `"Contoso Finance" <finance@contoso.test>`,
		toAddr: `"Billing" <billing@${demoDomain}>`,
		subject: "Invoice address update",
		textBody:
			"Please update our invoice contact to finance-team@contoso.test before the next billing cycle closes.",
		read: false,
		minutesAgo: 94,
		providerMessageId: "<seed-inbox-invoice@example.test>",
	},
	{
		mailbox: "support",
		direction: "outbound",
		status: "sent",
		fromAddr: `"Support" <support@${demoDomain}>`,
		toAddr: `"Maya Chen" <maya@acme.test>`,
		subject: "Re: Cannot access workspace",
		textBody:
			"I cleared the stale session and sent a fresh password reset link. Please try again from an incognito window.",
		read: true,
		minutesAgo: 8,
		providerMessageId: "<seed-sent-access@example.test>",
	},
	{
		mailbox: "billing",
		direction: "outbound",
		status: "sent",
		fromAddr: `"Billing" <billing@${demoDomain}>`,
		toAddr: `"Contoso Finance" <finance@contoso.test>`,
		subject: "Re: Invoice address update",
		textBody:
			"The billing contact is updated. Future invoices will go to finance-team@contoso.test.",
		read: true,
		minutesAgo: 35,
		providerMessageId: "<seed-sent-invoice@example.test>",
	},
	{
		mailbox: "support",
		direction: "outbound",
		status: "draft",
		fromAddr: `"Support" <support@${demoDomain}>`,
		toAddr: `"Northwind DevOps" <devops@northwind.test>`,
		subject: "Re: Webhook retry question",
		textBody:
			"Draft note: include retry backoff details, delivery log location, and the recommendation to return HTTP 204 after processing.",
		read: true,
		minutesAgo: 22,
	},
	{
		mailbox: "billing",
		direction: "outbound",
		status: "draft",
		fromAddr: `"Billing" <billing@${demoDomain}>`,
		toAddr: `"Globex Procurement" <procurement@globex.test>`,
		subject: "Annual plan renewal",
		textBody:
			"Draft renewal response with seat count, purchase order reference, and requested renewal date.",
		read: true,
		minutesAgo: 128,
	},
	{
		mailbox: "support",
		direction: "inbound",
		status: "spam",
		fromAddr: `"Traffic Promotions" <promo@unknown-sender.test>`,
		toAddr: `"Support" <support@${demoDomain}>`,
		subject: "Urgent traffic boost offer",
		textBody:
			"We can send thousands of visitors to your dashboard today. Reply now for the limited campaign rate.",
		read: false,
		minutesAgo: 166,
		providerMessageId: "<seed-spam-promo@example.test>",
	},
	{
		mailbox: "billing",
		direction: "inbound",
		status: "spam",
		fromAddr: `"Fake Bank Alerts" <alerts@fake-bank.test>`,
		toAddr: `"Billing" <billing@${demoDomain}>`,
		subject: "Payment account verification required",
		textBody:
			"Your payout account requires verification. Open the attached link and confirm your banking credentials.",
		read: true,
		minutesAgo: 219,
		providerMessageId: "<seed-spam-bank@example.test>",
	},
	{
		mailbox: "support",
		direction: "inbound",
		status: "trash",
		fromAddr: `"Vendor Migration" <old-thread@vendor.test>`,
		toAddr: `"Support" <support@${demoDomain}>`,
		subject: "Legacy migration thread",
		textBody:
			"This message was moved to trash after the migration checklist was completed and archived.",
		read: true,
		minutesAgo: 266,
		providerMessageId: "<seed-trash-migration@example.test>",
	},
	{
		mailbox: "billing",
		direction: "outbound",
		status: "trash",
		fromAddr: `"Billing" <billing@${demoDomain}>`,
		toAddr: `"Initech Ops" <ops@initech.test>`,
		subject: "Old billing draft",
		textBody:
			"Discarded copy of an earlier billing reply that was replaced by the final invoice response.",
		read: true,
		minutesAgo: 314,
	},
	{
		mailbox: "support",
		direction: "outbound",
		status: "queued",
		fromAddr: `"Support" <support@${demoDomain}>`,
		toAddr: `"Customer Status" <status@customer.test>`,
		subject: "Queued delivery status",
		textBody:
			"This seeded message represents an outbound email waiting for the worker queue to process.",
		read: true,
		minutesAgo: 4,
	},
	{
		mailbox: "billing",
		direction: "outbound",
		status: "queued",
		fromAddr: `"Billing" <billing@${demoDomain}>`,
		toAddr: `"Umbrella AP" <ap@umbrella.test>`,
		subject: "Queued payment receipt",
		textBody:
			"This seeded receipt is queued so API and background-job views can exercise pending delivery states.",
		read: true,
		minutesAgo: 17,
	},
	{
		mailbox: "support",
		direction: "outbound",
		status: "failed",
		fromAddr: `"Support" <support@${demoDomain}>`,
		toAddr: `"Invalid Bounce" <bounce@invalid.test>`,
		subject: "Failed SMTP handoff",
		textBody:
			"This seeded message failed delivery after the provider rejected the recipient address.",
		read: true,
		minutesAgo: 73,
	},
	{
		mailbox: "billing",
		direction: "outbound",
		status: "failed",
		fromAddr: `"Billing" <billing@${demoDomain}>`,
		toAddr: `"Closed Partner Account" <closed-account@partner.test>`,
		subject: "Failed billing notice",
		textBody:
			"This seeded billing notice failed because the destination mailbox no longer exists.",
		read: true,
		minutesAgo: 181,
	},
];
