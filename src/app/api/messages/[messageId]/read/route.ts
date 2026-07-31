import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { markMessageAsRead } from "@/lib/user";

export const POST = withUser<{ messageId: string }>(async ({ env, user, params }) => {
	const { messageId } = params;
	const success = await markMessageAsRead(env, user.id, user.organizationId, messageId);
	if (!success) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}

	return apiSuccess({ ok: true });
});
