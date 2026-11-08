import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messageFilters, messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { newId } from "@/lib/ids";
import { normalizedSender } from "./service";

type Actor = { id: string; organizationId: string | null };
type SenderScope = { sender: string; mailboxId: string | null };
type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type UnsubscribeOutcome =
	| { method: "one_click"; ok: boolean }
	| { method: "link"; url: string }
	| { method: "mailto"; url: string }
	| { method: "none" };

function senderMessages(db: ReturnType<typeof getDb>, actor: Actor, scope: SenderScope) {
	return and(
		messageAccessCondition(db, actor.id, actor.organizationId, "read"),
		eq(messages.direction, "inbound"),
		eq(normalizedSender, scope.sender.trim().toLowerCase()),
		scope.mailboxId ? eq(messages.mailboxId, scope.mailboxId) : undefined,
	);
}

/**
 * Unsubscribes from a sender using the newest message it sent that carries List-Unsubscribe
 * (F98). An RFC 8058 one-click target is POSTed by the Worker; otherwise the https link or
 * mailto target is returned for the reader to open.
 */
export async function unsubscribeSender(
	env: CloudflareEnv,
	actor: Actor,
	scope: SenderScope,
	fetcher: ExternalFetch = fetch,
): Promise<UnsubscribeOutcome> {
	const db = getDb(env);
	const [latest] = await db.select({
		url: messages.unsubscribeUrl,
		mailto: messages.unsubscribeMailto,
		oneClick: messages.unsubscribeOneClick,
	}).from(messages)
		.where(and(
			senderMessages(db, actor, scope),
			or(isNotNull(messages.unsubscribeUrl), isNotNull(messages.unsubscribeMailto)),
		))
		.orderBy(desc(messages.createdAt))
		.limit(1);
	if (!latest) return { method: "none" };
	if (latest.url && latest.oneClick) {
		try {
			const response = await fetcher(latest.url, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: "List-Unsubscribe=One-Click",
				credentials: "omit",
				redirect: "follow",
				signal: AbortSignal.timeout(10_000),
			});
			return { method: "one_click", ok: response.ok };
		} catch {
			return { method: "one_click", ok: false };
		}
	}
	if (latest.url) return { method: "link", url: latest.url };
	return { method: "mailto", url: latest.mailto as string };
}

/**
 * Archives a sender's received mail and, optionally, files its future mail the same way with an
 * ordinary message filter (F98). Archiving is reversible from the Archive folder.
 */
export async function archiveSender(
	env: CloudflareEnv,
	actor: Actor,
	scope: SenderScope & { createFilter: boolean },
): Promise<{ archived: number; filterId: string | null }> {
	const db = getDb(env);
	const archived = await db.update(messages)
		.set({ status: "archived" })
		.where(and(senderMessages(db, actor, scope), eq(messages.status, "received")))
		.returning({ id: messages.id });
	if (!scope.createFilter) return { archived: archived.length, filterId: null };

	const sender = scope.sender.trim().toLowerCase();
	const [existing] = await db.select({ id: messageFilters.id }).from(messageFilters)
		.where(and(
			eq(messageFilters.userId, actor.id),
			sql`lower(${messageFilters.fromContains}) = ${sender}`,
			eq(messageFilters.actionArchive, true),
		))
		.limit(1);
	if (existing) return { archived: archived.length, filterId: existing.id };
	const filterId = newId("filter");
	await db.insert(messageFilters).values({
		id: filterId,
		userId: actor.id,
		name: `Auto-archive ${sender}`,
		fromContains: sender,
		actionArchive: true,
	});
	return { archived: archived.length, filterId };
}
