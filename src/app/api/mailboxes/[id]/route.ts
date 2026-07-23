import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mailboxes } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { getEnv } from "@/lib/cloudflare";
import { updateMailboxSchema } from "@/lib/validators";
import type { MailboxRouteParams } from "./types";
import { getMailboxUpdateValues, selectMailboxForOrganization, selectMailboxForUser } from "./utils";

export async function GET(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	if (!user.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });
	const db = getDb(env);
	const [mailbox] = await selectMailboxForUser(db, user.organizationId, user.id, id, ["viewer", "responder", "manager"]);

	if (!mailbox) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	return NextResponse.json({
		mailbox: {
			...mailbox,
			isPrimary: `${mailbox.localPart}@${mailbox.hostname}` === user.email,
		},
	});
}

export async function PATCH(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	if (!user.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });
	const parsed = updateMailboxSchema.safeParse(await request.json());

	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const db = getDb(env);
	const [existing] = await selectMailboxForUser(db, user.organizationId, user.id, id, ["manager"]);

	if (!existing) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	const updateValues = getMailboxUpdateValues(parsed.data);
	if (Object.keys(updateValues).length > 0) {
		await db
			.update(mailboxes)
			.set(updateValues)
			.where(eq(mailboxes.id, id));
	}

	const [mailbox] = await selectMailboxForUser(db, user.organizationId, user.id, id, ["manager"]);

	return NextResponse.json({
		mailbox: {
			...mailbox,
			isPrimary: `${mailbox!.localPart}@${mailbox!.hostname}` === user.email,
		},
	});
}

export async function DELETE(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const [mailbox] = await selectMailboxForOrganization(db, orgUser.organizationId as string, id);

	if (!mailbox) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	let body: { confirmAddress?: unknown };
	try {
		body = await request.json() as { confirmAddress?: unknown };
	} catch {
		return NextResponse.json({ error: "Address confirmation required" }, { status: 400 });
	}
	const expectedAddress = `${mailbox.localPart}@${mailbox.hostname}`.toLowerCase();
	const confirmedAddress = typeof body.confirmAddress === "string"
		? body.confirmAddress.trim().toLowerCase()
		: "";
	if (confirmedAddress !== expectedAddress) {
		return NextResponse.json({ error: "Address confirmation does not match" }, { status: 400 });
	}

	await db.delete(mailboxes).where(eq(mailboxes.id, id));
	return NextResponse.json({ ok: true });
}
