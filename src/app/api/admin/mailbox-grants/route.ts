import { cookies } from "next/headers";
import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { grantMailboxAccessBulk } from "@/lib/bulk-mailbox-grants";
import { newId } from "@/lib/ids";
import { bulkMailboxGrantSchema } from "@/lib/validators";

export const POST = withOrgOwner(async ({ request, env, user }) => {
	const parsed = await parseJsonBody(request, bulkMailboxGrantSchema);
	if (parsed.errorResponse) return parsed.errorResponse;

	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	try {
		const result = await grantMailboxAccessBulk(env, {
			organizationId: user.organizationId,
			actorUserId: user.id,
			currentToken: bearerToken ?? cookieToken,
			targetUserId: parsed.data.targetUserId,
			mailboxIds: parsed.data.mailboxIds,
			role: parsed.data.role,
			requestId: newId("req"),
		});
		if (result.status === "recent-auth-required") return apiError("Recent authentication required", 403);
		if (result.status === "not-found") return apiError("Member or mailbox not found", 404);
		return apiSuccess({ createdCount: result.createdCount, requestId: result.requestId });
	} catch {
		console.error(JSON.stringify({ message: "bulk mailbox grant failed" }));
		return apiError("Bulk grant failed", 500);
	}
});
