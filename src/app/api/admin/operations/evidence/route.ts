import { cookies } from "next/headers";
import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { recordOperationalEvidence } from "@/lib/operational-evidence";
import { operationalEvidenceSchema } from "@/lib/validators";

export const POST = withOrgOwner(async ({ request, env, user }) => {
	const parsed = await parseJsonBody(request, operationalEvidenceSchema);
	if (parsed.errorResponse) return parsed.errorResponse;

	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	try {
		const result = await recordOperationalEvidence(env, {
			organizationId: user.organizationId,
			actorUserId: user.id,
			currentToken: bearerToken ?? cookieToken,
			category: parsed.data.category,
			outcome: parsed.data.outcome,
			passedChecks: parsed.data.passedChecks,
			totalChecks: parsed.data.totalChecks,
			observedAt: new Date(parsed.data.observedAt),
		});
		if (result.status === "recent-auth-required") return apiError("Recent authentication required", 403);
		if (result.status === "invalid") return apiError("Invalid evidence", 400);
		if (result.status === "conflict") return apiError("Evidence already exists with a different result", 409);
		return apiSuccess({ recorded: true, duplicate: result.status === "duplicate" }, result.status === "recorded" ? 201 : 200);
	} catch {
		console.error(JSON.stringify({ message: "operational evidence recording failed" }));
		return apiError("Evidence could not be recorded", 500);
	}
});
