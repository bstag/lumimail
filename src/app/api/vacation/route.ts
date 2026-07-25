import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { vacationResponders } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiSuccess, apiError } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import {
	getMailboxAccess,
	hasMailboxCapability,
	listAccessibleMailboxIds,
} from "@/lib/auth/mailbox-access";

const vacationSchema = z.object({
	mailboxId: z.string().min(1),
	enabled: z.boolean(),
	subject: z.string().min(1).max(200).optional(),
	body: z.string().min(1).max(5000).optional(),
	startDate: z.string().datetime().optional().nullable(),
	endDate: z.string().datetime().optional().nullable(),
	// Audience restrictions combine as OR; both false replies to everyone (F64).
	replyToContacts: z.boolean().optional(),
	replyToOrganization: z.boolean().optional(),
});

export async function GET(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

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
}

export async function PUT(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const parsed = vacationSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	if (!user.organizationId) return apiError("Mailbox not found", 404);

	const db = getDb(env);
	// A responder changes how the mailbox answers everyone who writes to it, so it
	// needs the manage capability rather than merely send. 404 rather than 403 so
	// the response cannot confirm a mailbox the caller may not see.
	const access = await getMailboxAccess(db, user.id, user.organizationId, parsed.data.mailboxId);
	if (!access || !hasMailboxCapability(access.role, "manage")) {
		return apiError("Mailbox not found", 404);
	}

	const [existing] = await db
		.select({ id: vacationResponders.id })
		.from(vacationResponders)
		.where(eq(vacationResponders.mailboxId, parsed.data.mailboxId))
		.limit(1);

	const values = {
		userId: user.id,
		enabled: parsed.data.enabled,
		subject: parsed.data.subject ?? "Out of office",
		body: parsed.data.body ?? "I am currently out of office and will reply when I return.",
		startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
		endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
		replyToContacts: parsed.data.replyToContacts ?? false,
		replyToOrganization: parsed.data.replyToOrganization ?? false,
		updatedAt: new Date(),
	};

	if (existing) {
		await db
			.update(vacationResponders)
			.set(values)
			.where(eq(vacationResponders.mailboxId, parsed.data.mailboxId));
	} else {
		await db.insert(vacationResponders).values({
			id: newId("vac"),
			mailboxId: parsed.data.mailboxId,
			...values,
		});
	}

	return apiSuccess({ ok: true });
}
