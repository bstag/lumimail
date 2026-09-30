export type LegalLink = { label: string; href: string };

export type LegalSection = {
	id: string;
	title: string;
	paragraphs?: readonly string[];
	items?: readonly string[];
	links?: readonly LegalLink[];
};

export type LegalDocument = {
	title: string;
	summary: string;
	effectiveDate: string;
	sections: readonly LegalSection[];
};

export const LEGAL_OPERATOR = {
	company: "Stagware",
	service: "Picket",
	contactEmail: "support@henriksen.dev",
	origin: "https://mail.henriksen.dev",
} as const;

const contactLink: LegalLink = {
	label: LEGAL_OPERATOR.contactEmail,
	href: `mailto:${LEGAL_OPERATOR.contactEmail}`,
};

/**
 * Every Google scope the connection requests, with the plain-language purpose shown in the
 * privacy policy. A unit test compares this list to the scopes in `oauth-provider.ts` so the
 * policy cannot drift from what the consent screen asks for.
 */
export const googleScopeDisclosures = [
	{
		scope: "openid",
		purpose: "confirms which Google account you are connecting",
	},
	{
		scope: "email",
		purpose: "reads the email address of that Google account so it can be shown and matched to the connection",
	},
	{
		scope: "https://www.googleapis.com/auth/gmail.readonly",
		purpose: "reads messages so copies of your Gmail mail can be imported into your Picket mailbox",
	},
	{
		scope: "https://www.googleapis.com/auth/gmail.send",
		purpose: "sends messages that you choose to send from your Gmail address through Picket",
	},
] as const;

export const privacyPolicy: LegalDocument = {
	title: "Privacy Policy",
	summary:
		"How Stagware collects, uses, stores, and shares information when you use Picket, including the Gmail data you choose to connect.",
	effectiveDate: "2026-09-30",
	sections: [
		{
			id: "who-we-are",
			title: "Who we are",
			paragraphs: [
				"Picket is a multi-tenant email service operated by Stagware (\"Stagware\", \"we\", \"us\") at https://mail.henriksen.dev. It lets teams receive, read, and send email for their own domains, and optionally connect an existing Google account.",
				"In this policy, \"you\" means a person who uses Picket. If you use Picket through a workspace run by your organization, your organization's administrators also control that workspace's mailboxes and settings.",
			],
			links: [contactLink],
		},
		{
			id: "information-we-collect",
			title: "Information we collect",
			items: [
				"Account information: your email address, your name if you provide one, and your password, which is stored only as a salted hash and can never be read back.",
				"Mail content: the messages, attachments, drafts, labels, and contacts in the mailboxes you use, including the headers, subjects, addresses, and bodies of mail you send and receive.",
				"Workspace information: your organization, its members and roles, its domains, mailboxes, routing rules, and the settings you configure.",
				"Security and session records: your sign-in sessions and security events, such as when you signed in or changed a security setting.",
				"Connected-account data: if you connect a Google account, the data described in the Google user data section below.",
				"Operational logs: our hosting platform retains service logs. They can include the recipient address of an inbound message that could not be delivered, storage object keys, queue names, and error classifications. They do not include message bodies, subjects, passwords, or access tokens.",
			],
		},
		{
			id: "google-user-data",
			title: "Google user data and Gmail access",
			paragraphs: [
				"Connecting a Google account is optional and starts only when you choose it. Picket asks Google for the following permissions and uses each one only for the purpose shown:",
			],
			items: googleScopeDisclosures.map((item) => `${item.scope} — ${item.purpose}.`),
			links: [
				{ label: "Google API Services User Data Policy", href: "https://developers.google.com/terms/api-services-user-data-policy" },
			],
		},
		{
			id: "what-we-do-with-google-data",
			title: "What we do with Google data",
			items: [
				"Import: we copy mail from your Gmail account into the Picket mailbox you chose. You select whether to import only new mail or also the last 30 days, and new mail keeps syncing until you disconnect or pause the connection.",
				"Send: when you compose a message from your connected Gmail address, we send it through Google on your behalf.",
				"No changes to Gmail: Picket never asks for permission to modify, label, move, or delete anything in your Gmail account.",
				"Storage: your Google refresh credential is encrypted at rest and is never sent to your browser. Imported messages are stored like the rest of your Picket mail. If you turn on \"Retain original copies\", we also keep an exact copy of each newly imported message and a checksum of it.",
				"Who can read imported mail: everyone with read access to the Picket mailbox you connect can read the mail imported into it. We show this before you connect.",
				"Human access: Stagware does not read your Google data. We access it only if you ask us to help with a specific problem, where needed to investigate abuse or a security incident, or where the law requires it.",
				"AI: we do not use Google user data to develop, improve, or train generalized AI or machine-learning models.",
				"Advertising and sale: we do not use Google user data for advertising, and we never sell it.",
				"Third-party clients you authorize: if you choose to connect an assistant or another client to your Picket mailbox (for example through an API key, the MCP integration, or the IMAP and SMTP bridge), that client can read the mail in that mailbox, including imported Gmail mail, to the extent you authorize it.",
			],
			paragraphs: [
				"Picket's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
			],
		},
		{
			id: "how-we-use-information",
			title: "How we use information",
			items: [
				"To provide Picket: receive, store, display, search, and send your mail and keep your workspace working.",
				"To keep the service secure: authenticate you, prevent abuse, and investigate incidents.",
				"To support you: answer questions you send us and diagnose problems you report.",
				"To meet legal obligations.",
			],
			paragraphs: [
				"We do not sell your information, we do not show advertising, and we do not build advertising profiles.",
			],
		},
		{
			id: "who-we-share-with",
			title: "Who we share information with",
			items: [
				"Hosting and infrastructure: Picket runs on Cloudflare, which stores and processes data for us as a service provider, including for Workers, D1, R2, Queues, and Email Routing.",
				"Outbound mail delivery: messages you send are handed to the configured mail provider (Cloudflare Email Sending, or another provider the operator configures) and to the recipients you address.",
				"Integrations you configure: if you add a webhook, its address receives the sender, recipient, and subject of matching messages; message bodies and attachments are never sent to webhooks. If you enable push notifications, they contain no message content.",
				"Legal and safety: we may disclose information where the law requires it or to protect the rights, safety, and security of users and the service.",
				"We do not share your information with anyone else.",
			],
		},
		{
			id: "retention-and-deletion",
			title: "Retention and deletion",
			items: [
				"Your mail and workspace data are kept until you or your organization's administrators delete them or until the account is closed.",
				"Raw copies of inbound messages held only for processing are deleted after processing succeeds.",
				"Disconnect: you can disconnect a connected Google account at any time from Settings, External accounts. Disconnecting stops all access immediately and asks Google to revoke the credential. It never deletes anything in Gmail. Mail already imported stays in your Picket mailbox until it is deleted.",
				"You can also remove Picket's access from the Google side at any time.",
				"To have your account and its data deleted, email us. We will confirm the request and complete deletion within 30 days. Copies in backups can persist for a limited period afterward.",
			],
			links: [
				{ label: "myaccount.google.com/permissions", href: "https://myaccount.google.com/permissions" },
				contactLink,
			],
		},
		{
			id: "security",
			title: "Security",
			paragraphs: [
				"Traffic to Picket uses HTTPS. Passwords are stored as salted hashes, connected-account credentials are encrypted at rest, and every mailbox, message, and domain is isolated by organization and by your permissions. No system is perfectly secure, so we cannot guarantee absolute security, but we design Picket to limit what any one failure could expose.",
			],
		},
		{
			id: "cookies-and-storage",
			title: "Cookies and local storage",
			paragraphs: [
				"Picket sets one strictly necessary session cookie to keep you signed in. Your browser's local storage keeps interface preferences such as your theme and sidebar state. Picket does not use advertising cookies, analytics scripts, or third-party trackers.",
			],
		},
		{
			id: "your-choices-and-rights",
			title: "Your choices and rights",
			paragraphs: [
				"You can view and edit most of your information in Picket. Depending on where you live, you may also have the right to access, correct, export, or delete your personal information, to object to or restrict certain processing, and to lodge a complaint with a data protection authority. To use any of these rights, email us.",
			],
			links: [contactLink],
		},
		{
			id: "children",
			title: "Children",
			paragraphs: [
				"Picket is not directed to children under 16, and we do not knowingly collect personal information from them. If you believe a child has given us information, email us and we will delete it.",
			],
		},
		{
			id: "changes",
			title: "Changes to this policy",
			paragraphs: [
				"We may update this policy. The effective date above shows when it last changed. If a change materially affects how we handle your information, we will notify you in the service or by email before it takes effect.",
			],
		},
		{
			id: "contact",
			title: "Contact",
			paragraphs: ["Stagware, operator of Picket. Questions, requests, and complaints about privacy:"],
			links: [contactLink],
		},
	],
};

export const termsOfService: LegalDocument = {
	title: "Terms of Service",
	summary: "The rules for using Picket, the email service operated by Stagware.",
	effectiveDate: "2026-09-30",
	sections: [
		{
			id: "agreement",
			title: "Agreement",
			paragraphs: [
				"These terms are an agreement between you and Stagware (\"Stagware\", \"we\", \"us\") about your use of Picket at https://mail.henriksen.dev. By creating an account or using Picket you agree to them and to our Privacy Policy. If you use Picket on behalf of an organization, you confirm you may bind it.",
			],
		},
		{
			id: "the-service",
			title: "The service",
			paragraphs: [
				"Picket lets you receive, read, organize, and send email for domains and mailboxes in a shared workspace, and optionally import and send mail through an existing Google account. We may change, add, or remove features over time.",
			],
		},
		{
			id: "accounts-and-workspaces",
			title: "Accounts and workspaces",
			items: [
				"Give accurate information and keep your sign-in credentials secret. You are responsible for activity under your account.",
				"Workspace administrators decide who can access a workspace's mailboxes and settings. Anyone an administrator grants access to a mailbox can read that mailbox.",
				"Tell us promptly if you believe your account has been accessed without permission.",
			],
		},
		{
			id: "your-content",
			title: "Your mail and content",
			paragraphs: [
				"You keep all rights in the mail and other content you handle through Picket. You give us permission to store, process, and transmit it only as needed to provide the service to you. You are responsible for having the right to send, receive, and store that content.",
			],
		},
		{
			id: "acceptable-use",
			title: "Acceptable use",
			paragraphs: ["Do not use Picket to:"],
			items: [
				"send spam, bulk unsolicited mail, phishing, or messages intended to deceive;",
				"distribute malware or content that is unlawful, infringing, or harmful;",
				"harass or threaten anyone, or violate someone's privacy or rights;",
				"attack, probe, overload, or circumvent the limits or security of the service or other users;",
				"send from an address or domain you are not authorized to use; or",
				"resell or provide the service to others without our permission.",
			],
		},
		{
			id: "connected-accounts",
			title: "Connected Google accounts",
			items: [
				"You may connect only a Google account you own or are authorized to use, and you agree to Google's own terms for it.",
				"Connecting lets Picket read your Gmail mail into the chosen Picket mailbox and send mail you compose from that address. Picket never modifies or deletes mail in your Gmail account.",
				"Everyone with read access to the Picket mailbox you connect can read the imported mail. Connect only to a mailbox where that is acceptable.",
				"You can disconnect at any time. Details, and how Google data is handled, are in the Privacy Policy.",
			],
		},
		{
			id: "third-party-services",
			title: "Third-party services",
			paragraphs: [
				"Picket depends on services we do not control, including our hosting provider, mail delivery providers, and Google. Their outages, limits, and policies can affect Picket, and we are not responsible for them.",
			],
		},
		{
			id: "availability-and-delivery",
			title: "Availability, delivery, and backups",
			paragraphs: [
				"We work to keep Picket available, but we do not promise uninterrupted or error-free service. Email delivery depends on other systems and is not guaranteed. Picket is not a backup or archive service: the option to retain original copies of imported mail is not a complete or independently verified backup, so keep your own backups of anything important.",
			],
		},
		{
			id: "suspension-and-termination",
			title: "Suspension and termination",
			paragraphs: [
				"You may stop using Picket at any time and ask us to delete your account. We may suspend or end your access if you break these terms, put the service or others at risk, or if we must by law. We will give notice where we reasonably can.",
			],
		},
		{
			id: "disclaimers",
			title: "Disclaimers",
			paragraphs: [
				"Picket is provided \"as is\" and \"as available\", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement, to the extent the law allows.",
			],
		},
		{
			id: "limitation-of-liability",
			title: "Limitation of liability",
			paragraphs: [
				"To the extent the law allows, Stagware is not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost data, or lost mail, and our total liability for any claim relating to Picket is limited to the greater of the amount you paid us for Picket in the 12 months before the claim and 100 US dollars. Nothing in these terms limits liability that cannot be limited by law.",
			],
		},
		{
			id: "governing-law",
			title: "Governing law",
			paragraphs: [
				"These terms are governed by the laws that apply where Stagware is established, without regard to conflict-of-law rules, and disputes will be handled by the courts with jurisdiction there, unless mandatory consumer law gives you other rights.",
			],
		},
		{
			id: "changes",
			title: "Changes to these terms",
			paragraphs: [
				"We may update these terms. The effective date above shows when they last changed. If a change is material, we will notify you in the service or by email before it takes effect. Continued use after a change means you accept it.",
			],
		},
		{
			id: "contact",
			title: "Contact",
			paragraphs: ["Stagware, operator of Picket. Questions about these terms:"],
			links: [contactLink],
		},
	],
};
