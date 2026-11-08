import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { unsubscribeSender } from "@/lib/categorization/sender-actions";
import { senderActionSchema } from "@/lib/validators";

export const POST = withUser(async ({ env, user, request }) => {
	const parsed = senderActionSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Invalid sender", 400);
	return apiSuccess(await unsubscribeSender(env, user, parsed.data));
});
