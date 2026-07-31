import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
	domains,
	mailboxes,
	messageBodies,
	messages,
	outboundJobs,
	users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { buildSnippet } from "@/lib/email/parse";
import { newId } from "@/lib/ids";
import {
	demoCredentials,
	demoDomain,
	seedMailboxDefinitions,
	seedMessages,
} from "@/lib/seed-fixtures";
import type { SeedMailboxMap } from "@/lib/seed-types";

export { demoCredentials } from "@/lib/seed-fixtures";

export async function ensureDemoUser(env: CloudflareEnv) {
	const db = getDb(env);
	const [existing] = await db
		.select()
		.from(users)
		.where(eq(users.email, demoCredentials.email))
		.limit(1);
	if (existing) return existing;

	const id = newId("usr");
	await db.insert(users).values({
		id,
		email: demoCredentials.email,
		passwordHash: hashPassword(demoCredentials.password),
		name: "Demo User",
	});

	const [created] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return created!;
}

export async function ensureDemoDomain(env: CloudflareEnv, userId: string, organizationId: string) {
	const db = getDb(env);
	const [existing] = await db
		.select()
		.from(domains)
		.where(eq(domains.hostname, demoDomain))
		.limit(1);
	if (existing) return existing;

	const id = newId("dom");
	await db.insert(domains).values({
		id,
		userId,
		organizationId,
		hostname: demoDomain,
		zoneId: "00000000000000000000000000000000",
		status: "active",
		routingEnabled: true,
		sendingEnabled: true,
	});

	const [created] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
	return created!;
}

export async function ensureDemoMailboxes(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	domainId: string,
): Promise<SeedMailboxMap> {
	const db = getDb(env);
	const entries = await Promise.all(
		seedMailboxDefinitions.map(async (definition) => {
			const [existing] = await db
				.select()
				.from(mailboxes)
				.where(
					and(
						eq(mailboxes.domainId, domainId),
						eq(mailboxes.localPart, definition.localPart),
					),
				)
				.limit(1);
			if (existing) return [definition.key, existing] as const;

			const id = newId("mbx");
			await db.insert(mailboxes).values({
				id,
				userId,
				organizationId,
				domainId,
				localPart: definition.localPart,
				displayName: definition.displayName,
			});

			const [created] = await db
				.select()
				.from(mailboxes)
				.where(eq(mailboxes.id, id))
				.limit(1);
			return [definition.key, created!] as const;
		}),
	);

	return Object.fromEntries(entries) as SeedMailboxMap;
}

export async function insertDemoMessages(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	mailboxMap: SeedMailboxMap,
): Promise<number> {
	const db = getDb(env);
	const now = Date.now();

	for (const seedMessage of seedMessages) {
		const id = newId("msg");
		const createdAt = new Date(now - seedMessage.minutesAgo * 60 * 1000);
		const mailbox = mailboxMap[seedMessage.mailbox];

		await db.insert(messages).values({
			id,
			userId,
			organizationId,
			mailboxId: mailbox.id,
			direction: seedMessage.direction,
			providerMessageId: seedMessage.providerMessageId ?? null,
			fromAddr: seedMessage.fromAddr,
			toAddr: seedMessage.toAddr,
			subject: seedMessage.subject,
			snippet: buildSnippet(seedMessage.textBody, null),
			status: seedMessage.status,
			/* v8 ignore next -- every seed message defines `read`; the ?? default is defensive */
			read: seedMessage.read ?? true,
			threadId: seedMessage.providerMessageId ?? null,
			createdAt,
		});

		await db.insert(messageBodies).values({
			id: newId(),
			messageId: id,
			textBody: seedMessage.textBody,
			htmlBody: null,
		});

		if (seedMessage.status === "queued" || seedMessage.status === "failed") {
			await db.insert(outboundJobs).values({
				id: newId("job"),
				userId,
				organizationId,
				messageId: id,
				status: seedMessage.status,
				payload: JSON.stringify({
					from: seedMessage.fromAddr,
					to: seedMessage.toAddr,
					subject: seedMessage.subject,
					text: seedMessage.textBody,
				}),
				error:
					seedMessage.status === "failed"
						? "Seeded delivery failure for UI and API testing"
						: null,
				createdAt,
				updatedAt: createdAt,
			});
		}

		await upsertContactFromAddress(env, {
			userId,
			address: seedMessage.direction === "inbound" ? seedMessage.fromAddr : seedMessage.toAddr,
			source: seedMessage.direction === "inbound" ? "inbound" : "outbound",
		});
	}

	return seedMessages.length;
}
