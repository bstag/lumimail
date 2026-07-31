import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, parseJsonBody } from "@/lib/api/response";
import { updateMessageStatus } from "@/lib/user";
import { isAllowedMessageStatus } from "./utils";

// `status` stays unknown so an unsupported value keeps answering the
// historical bare `{ error: "Invalid message status" }` 400 below.
const statusPayloadSchema = z.object({ status: z.unknown().optional() });

export const POST = withUser<{ messageId: string }>(async ({ request, env, user, params }) => {
	const { messageId } = params;
	const { data: payload, errorResponse } = await parseJsonBody(request, statusPayloadSchema);
	if (errorResponse) return errorResponse;
	if (!isAllowedMessageStatus(payload.status)) {
		return NextResponse.json({ error: "Invalid message status" }, { status: 400 });
	}

	const success = await updateMessageStatus(env, user.id, user.organizationId, messageId, payload.status);
	if (!success) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}

	return apiSuccess({ ok: true });
});
