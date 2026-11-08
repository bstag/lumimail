import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { archiveSender } from "@/lib/categorization/sender-actions";
import { senderArchiveSchema } from "@/lib/validators";

export const POST = withUser(async ({ env, user, request }) => {
	const parsed = senderArchiveSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Invalid sender", 400);
	return apiSuccess(await archiveSender(env, user, parsed.data));
});
