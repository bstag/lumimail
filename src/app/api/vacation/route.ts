import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { vacationResponders } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { vacationResponderSchema } from "@/lib/validators";
import {
	getMailboxAccess,
	hasMailboxCapability,
	listAccessibleMailboxIds,
} from "@/lib/auth/mailbox-access";

export const GET = withUser(async ({ env, user }) => {
	// Mailbox access is organization-scoped, so a user without one manages nothing.
	if (!user.organizationId) return apiSuccess({ responders: [] });

	const db = getDb(env);
	// A responder belongs to a mailbox, so the caller sees one per mailbox they can
	// reach rather than a single setting whose scope is invisible (F65).
	const mailboxIds = await listAccessibleMailboxIds(db, user.id, user.organizationId, "manage");
	if (mailboxIds.length === 0) return apiSuccess({ responders: [] });

	const rows = await db
		.select()
		.from(vacationResponders)
		.where(inArray(vacationResponders.mailboxId, mailboxIds));

	return apiSuccess({ responders: rows });
});

export const PUT = withUser(async ({ request, env, user }) => {
	const { data, errorResponse } = await parseJsonBody(request, vacationResponderSchema);
	if (errorResponse) return errorResponse;

	if (!user.organizationId) return apiError("Mailbox not found", 404);

	const db = getDb(env);
	// A responder changes how the mailbox answers everyone who writes to it, so it
	// needs the manage capability rather than merely send. 404 rather than 403 so
	// the response cannot confirm a mailbox the caller may not see.
	const access = await getMailboxAccess(db, user.id, user.organizationId, data.mailboxId);
	if (!access || !hasMailboxCapability(access.role, "manage")) {
		return apiError("Mailbox not found", 404);
	}

	const [existing] = await db
		.select({ id: vacationResponders.id })
		.from(vacationResponders)
		.where(eq(vacationResponders.mailboxId, data.mailboxId))
		.limit(1);

	const values = {
		userId: user.id,
		enabled: data.enabled,
		subject: data.subject ?? "Out of office",
		body: data.body ?? "I am currently out of office and will reply when I return.",
		startDate: data.startDate ? new Date(data.startDate) : null,
		endDate: data.endDate ? new Date(data.endDate) : null,
		replyToContacts: data.replyToContacts ?? false,
		replyToOrganization: data.replyToOrganization ?? false,
		updatedAt: new Date(),
	};

	if (existing) {
		await db
			.update(vacationResponders)
			.set(values)
			.where(eq(vacationResponders.mailboxId, data.mailboxId));
	} else {
		await db.insert(vacationResponders).values({
			id: newId("vac"),
			mailboxId: data.mailboxId,
			...values,
		});
	}

	return apiSuccess({ ok: true });
});
