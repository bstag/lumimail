import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { webhooks } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { newId } from "@/lib/ids";
import { webhookSchema } from "@/lib/validators";

export const GET = withUser(async ({ env, user }) => {
	const db = getDb(env);
	const rows = await db.select().from(webhooks).where(eq(webhooks.userId, user.id));
	return NextResponse.json({
		webhooks: rows.map((w) => ({ id: w.id, url: w.url, events: w.events, enabled: w.enabled })),
	});
});

export const POST = withUser(async ({ request, env, user }) => {
	const parsed = webhookSchema.safeParse(await request.json());
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const secret = newId("whsec");
	const db = getDb(env);
	const id = newId("wh");
	await db.insert(webhooks).values({
		id,
		userId: user.id,
		url: parsed.data.url,
		secret,
		events: JSON.stringify(parsed.data.events),
		enabled: true,
	});

	return NextResponse.json({ id, url: parsed.data.url, secret, events: parsed.data.events });
});
