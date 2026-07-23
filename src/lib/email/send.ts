import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxMemberships, mailboxes, messageBodies, messages, outboundJobs, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { selectOutboundProvider } from "@/lib/email/providers";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { parseAddress } from "@/lib/utils";

async function getUserOrgId(env: CloudflareEnv, userId: string): Promise<string | null> {
	const db = getDb(env);
	const [user] = await db
		.select({ organizationId: users.organizationId })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	return user?.organizationId ?? null;
}

export type SendEmailInput = {
	userId: string;
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
	mailboxId?: string;
};

type SenderAuthorization = { mailboxId: string; organizationId: string | null };

export class SenderNotAllowedError extends Error {
	constructor(from: string) {
		super(`Sender address is not an active mailbox for your account: ${from}`);
		this.name = "SenderNotAllowedError";
	}
}

async function resolveSenderAuthorization(
	env: CloudflareEnv,
	userId: string,
	from: string,
	mailboxId?: string,
): Promise<SenderAuthorization | null> {
	const parsed = parseAddress(from);
	if (!parsed) return null;
	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.hostname, parsed.domain), eq(domains.status, "active")))
		.limit(1);
	if (!domain) return null;

	const orgId = await getUserOrgId(env, userId);
	const baseConditions = [
		eq(mailboxes.domainId, domain.id),
		eq(mailboxes.localPart, parsed.local),
		...(mailboxId ? [eq(mailboxes.id, mailboxId)] : []),
	];
	const mailboxQuery = db.select({ id: mailboxes.id }).from(mailboxes);
	const [mailbox] = orgId
		? await mailboxQuery
			.innerJoin(mailboxMemberships, eq(mailboxMemberships.mailboxId, mailboxes.id))
			.where(and(
				...baseConditions,
				eq(mailboxes.organizationId, orgId),
				eq(mailboxMemberships.userId, userId),
				inArray(mailboxMemberships.role, ["responder", "manager"]),
			))
			.limit(1)
		: await mailboxQuery
			.where(and(...baseConditions, eq(mailboxes.userId, userId)))
			.limit(1);

	if (!mailbox) return null;

	await ensureEmailRoutingRuleToWorker(env, domain.zoneId, `${parsed.local}@${parsed.domain}`);
	return { mailboxId: mailbox.id, organizationId: orgId };
}

export async function validateSenderDomain(
	env: CloudflareEnv,
	userId: string,
	from: string,
	mailboxId?: string,
): Promise<boolean> {
	return !!await resolveSenderAuthorization(env, userId, from, mailboxId);
}

export async function sendEmail(env: CloudflareEnv, input: SendEmailInput): Promise<{ messageId: string }> {
	const db = getDb(env);
	const authorization = await resolveSenderAuthorization(env, input.userId, input.from, input.mailboxId);
	if (!authorization) {
		throw new SenderNotAllowedError(input.from);
	}

	const authorizedInput = { ...input, mailboxId: authorization.mailboxId };
	const sender = await getSenderContext(env, authorizedInput);
	const fromAddr = sender.fromAddr;
	await upsertContactFromAddress(env, {
		userId: input.userId,
		address: input.to,
		source: "outbound",
	});
	const messageId = newId("msg");
	const snippet = buildSnippet(input.text ?? null, input.html ?? null);

	await db.insert(messages).values({
		id: messageId,
		userId: input.userId,
		organizationId: sender.organizationId,
		mailboxId: authorization.mailboxId,
		direction: "outbound",
		fromAddr,
		toAddr: input.to,
		subject: input.subject,
		snippet,
		status: "queued",
	});

	await db.insert(messageBodies).values({
		id: newId(),
		messageId,
		textBody: input.text ?? null,
		htmlBody: input.html ?? null,
	});

	const jobId = newId("job");
	await db.insert(outboundJobs).values({
		id: jobId,
		userId: input.userId,
		organizationId: sender.organizationId,
		messageId,
		status: "queued",
		payload: JSON.stringify(authorizedInput),
	});

	try {
		const provider = selectOutboundProvider(env);
		const response = await provider.send({
			from: fromAddr,
			to: input.to,
			subject: input.subject,
			html: input.html,
			text: input.text,
		});

		await db
			.update(messages)
			.set({ status: "sent", providerMessageId: response.providerMessageId })
			.where(eq(messages.id, messageId));
		await db.update(outboundJobs).set({ status: "sent", updatedAt: new Date() }).where(eq(outboundJobs.id, jobId));

		await dispatchWebhooks(env, input.userId, "message.outbound", {
			messageId,
			providerMessageId: response.providerMessageId,
			to: input.to,
		});

		return { messageId };
	} catch (err) {
		const error = err instanceof Error ? err.message : "Send failed";
		await db.update(messages).set({ status: "failed" }).where(eq(messages.id, messageId));
		await db
			.update(outboundJobs)
			.set({ status: "failed", error, updatedAt: new Date() })
			.where(eq(outboundJobs.id, jobId));
		await dispatchWebhooks(env, input.userId, "message.failed", { messageId, error });
		throw err;
	}
}

async function getSenderContext(
	env: CloudflareEnv,
	input: SendEmailInput & { mailboxId: string },
): Promise<{ fromAddr: string; organizationId: string | null }> {
	const db = getDb(env);
	const orgId = await getUserOrgId(env, input.userId);
	const [mailbox] = await db
		.select({
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			hostname: domains.hostname,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.leftJoin(mailboxMemberships, eq(mailboxMemberships.mailboxId, mailboxes.id))
		.where(
			and(
				eq(mailboxes.id, input.mailboxId),
				orgId
					? and(
						eq(mailboxes.organizationId, orgId),
						eq(mailboxMemberships.userId, input.userId),
						inArray(mailboxMemberships.role, ["responder", "manager"]),
					)
					: eq(mailboxes.userId, input.userId),
			),
		)
		.limit(1);

	if (!mailbox) return { fromAddr: input.from, organizationId: orgId };

	const requestedAddress = getEmailAddress(input.from);
	const mailboxAddress = `${mailbox.localPart}@${mailbox.hostname}`;
	if (requestedAddress.toLowerCase() !== mailboxAddress.toLowerCase()) {
		return { fromAddr: input.from, organizationId: orgId };
	}

	return {
		fromAddr: formatEmailAddress(mailboxAddress, mailbox.displayName ?? mailbox.localPart),
		organizationId: orgId,
	};
}

export type OutboundQueueMessage = SendEmailInput & { jobId?: string };

export async function processOutboundQueue(
	env: CloudflareEnv,
	payload: OutboundQueueMessage,
): Promise<void> {
	await sendEmail(env, payload);
}
