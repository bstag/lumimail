import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { vacationResponders } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiSuccess, apiError } from "@/lib/api/response";
import { newId } from "@/lib/ids";

const vacationSchema = z.object({
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

	const db = getDb(env);
	const [responder] = await db
		.select()
		.from(vacationResponders)
		.where(eq(vacationResponders.userId, user.id))
		.limit(1);

	return apiSuccess({ responder: responder ?? null });
}

export async function PUT(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const parsed = vacationSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const db = getDb(env);
	const [existing] = await db
		.select({ id: vacationResponders.id })
		.from(vacationResponders)
		.where(eq(vacationResponders.userId, user.id))
		.limit(1);

	const values = {
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
		await db.update(vacationResponders).set(values).where(eq(vacationResponders.userId, user.id));
	} else {
		await db.insert(vacationResponders).values({ id: newId("vac"), userId: user.id, ...values });
	}

	return apiSuccess({ ok: true });
}
