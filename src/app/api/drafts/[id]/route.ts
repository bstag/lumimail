import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { buildSnippet } from "@/lib/email/parse";
import type { DraftPayload, DraftRouteParams } from "./types";
import { selectDraftWithBody } from "./utils";
import {
	getMailboxAccess,
	hasMailboxCapability,
	messageAccessCondition,
} from "@/lib/auth/mailbox-access";

export async function GET(request: Request, { params }: DraftRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	const db = getDb(env);
	const draft = await selectDraftWithBody(db, user.id, user.organizationId, id);

	if (!draft) {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}

	return NextResponse.json({ draft });
}

export async function PATCH(request: Request, { params }: DraftRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	const input = (await request.json()) as DraftPayload;
	const db = getDb(env);
	const [draft] = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, id), messageAccessCondition(db, user.id, user.organizationId, "send")))
		.limit(1);

	if (!draft || draft.status !== "draft") {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}
	if (input.mailboxId) {
		const access = user.organizationId
			? await getMailboxAccess(db, user.id, user.organizationId, input.mailboxId)
			: null;
		if (!access || !hasMailboxCapability(access.role, "send")) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
	}

	const text = input.text ?? "";
	const html = input.html ?? "";
	await db
		.update(messages)
		.set({
			mailboxId: input.mailboxId ?? null,
			organizationId: input.mailboxId ? user.organizationId : null,
			fromAddr: input.from ?? "",
			toAddr: input.to ?? "",
			subject: input.subject ?? null,
			snippet: buildSnippet(text || null, html || null),
		})
		.where(eq(messages.id, id));

	await db
		.update(messageBodies)
		.set({
			textBody: text || null,
			htmlBody: html || null,
		})
		.where(eq(messageBodies.messageId, id));

	return NextResponse.json({ draft: { id } });
}

export async function DELETE(request: Request, { params }: DraftRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	const db = getDb(env);
	const [draft] = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, id), messageAccessCondition(db, user.id, user.organizationId, "send")))
		.limit(1);

	if (!draft || draft.status !== "draft") {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}

	await db.delete(messages).where(eq(messages.id, id));
	return NextResponse.json({ ok: true });
}
