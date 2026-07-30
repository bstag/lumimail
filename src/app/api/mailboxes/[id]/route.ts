import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { mailboxes } from "@/db/schema";
import { withOrgAdmin, withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { updateMailboxSchema } from "@/lib/validators";
import { getMailboxUpdateValues, selectMailboxForOrganization, selectMailboxForUser } from "./utils";

const deleteMailboxSchema = z.object({
	confirmAddress: z.string().optional(),
});

export const GET = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;
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
});

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const { id } = params;
	if (!user.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });
	const { data, errorResponse } = await parseJsonBody(request, updateMailboxSchema);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const [existing] = await selectMailboxForUser(db, user.organizationId, user.id, id, ["manager"]);

	if (!existing) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	const updateValues = getMailboxUpdateValues(data);
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
});

export const DELETE = withOrgAdmin<{ id: string }>(async ({ request, env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [mailbox] = await selectMailboxForOrganization(db, user.organizationId, id);

	if (!mailbox) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	const { data, errorResponse } = await parseJsonBody(request, deleteMailboxSchema);
	if (errorResponse) return errorResponse;

	const expectedAddress = `${mailbox.localPart}@${mailbox.hostname}`.toLowerCase();
	const confirmedAddress = (data.confirmAddress ?? "").trim().toLowerCase();
	if (confirmedAddress !== expectedAddress) {
		return NextResponse.json({ error: "Address confirmation does not match" }, { status: 400 });
	}

	await db.delete(mailboxes).where(eq(mailboxes.id, id));
	return NextResponse.json({ ok: true });
});
