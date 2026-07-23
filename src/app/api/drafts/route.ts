import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import {
	getMailboxAccess,
	hasMailboxCapability,
	messageAccessCondition,
} from "@/lib/auth/mailbox-access";

type DraftPayload = {
	mailboxId?: string | null;
	from?: string;
	to?: string;
	subject?: string;
	text?: string;
	html?: string;
};

export async function GET(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const db = getDb(env);
	const conditions = [
		messageAccessCondition(db, user.id, user.organizationId, "send"),
		eq(messages.direction, "outbound" as const),
		eq(messages.status, "draft"),
	];
	if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(100);

	return NextResponse.json({ drafts: rows });
}

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	const input = (await request.json()) as DraftPayload;
	const db = getDb(env);
	if (input.mailboxId) {
		const access = user.organizationId
			? await getMailboxAccess(db, user.id, user.organizationId, input.mailboxId)
			: null;
		if (!access || !hasMailboxCapability(access.role, "send")) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
	}
	const draftId = newId("msg");
	const text = input.text ?? "";
	const html = input.html ?? "";

	await db.insert(messages).values({
		id: draftId,
		userId: user.id,
		organizationId: input.mailboxId ? user.organizationId : null,
		mailboxId: input.mailboxId ?? null,
		direction: "outbound",
		fromAddr: input.from ?? "",
		toAddr: input.to ?? "",
		subject: input.subject ?? null,
		snippet: buildSnippet(text || null, html || null),
		status: "draft",
		read: true,
	});

	await db.insert(messageBodies).values({
		id: newId(),
		messageId: draftId,
		textBody: text || null,
		htmlBody: html || null,
	});

	return NextResponse.json({ draft: { id: draftId } });
}
