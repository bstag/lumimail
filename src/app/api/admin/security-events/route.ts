import { z } from "zod";
import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import {
	decodeSecurityEventCursor,
	readSecurityAuditHistory,
	SECURITY_EVENT_DEFAULT_LIMIT,
	SECURITY_EVENT_MAX_LIMIT,
} from "@/lib/security-audit-history";

const querySchema = z.object({
	limit: z.coerce.number().int().min(1).max(SECURITY_EVENT_MAX_LIMIT).default(SECURITY_EVENT_DEFAULT_LIMIT),
	cursor: z.string().min(1).optional(),
});

export const GET = withOrgOwner(async ({ request, env, user }) => {
	const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
	if (!parsed.success) return apiError("Invalid query", 400);

	const cursor = parsed.data.cursor ? decodeSecurityEventCursor(parsed.data.cursor) : null;
	if (parsed.data.cursor && !cursor) return apiError("Invalid query", 400);

	return apiSuccess(await readSecurityAuditHistory(env, user.organizationId, {
		limit: parsed.data.limit,
		cursor,
	}));
});
