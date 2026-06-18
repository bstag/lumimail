import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import type { BulkMessagePayload } from "./types";
import {
	getReadValueForBulkAction,
	getStatusForBulkAction,
	isAllowedBulkMessageAction,
} from "./utils";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const payload = (await request.json()) as BulkMessagePayload;
	const messageIds = payload.messageIds?.filter(Boolean) ?? [];
	if (messageIds.length === 0 || !isAllowedBulkMessageAction(payload.action)) {
		return NextResponse.json({ error: "Invalid bulk message action" }, { status: 400 });
	}

	const status = getStatusForBulkAction(payload.action);
	const read = getReadValueForBulkAction(payload.action);
	const values = {
		...(status ? { status } : {}),
		...(read !== null ? { read } : {}),
	};

	/* v8 ignore next 3 -- every allowed action yields a non-empty values object; guard is defensive */
	if (Object.keys(values).length === 0) {
		return NextResponse.json({ error: "No changes requested" }, { status: 400 });
	}

	const db = getDb(env);
	await db
		.update(messages)
		.set(values)
		.where(and(eq(messages.userId, user.id), inArray(messages.id, messageIds)));

	return NextResponse.json({ ok: true });
}
